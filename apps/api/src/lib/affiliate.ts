import { prisma } from './prisma';
import { logger } from './logger';
import { sendEmail } from './mailer';
import { getEffectiveCommissionRates, getActiveCampaign } from './affiliateConfig';

/* ─────────────────────────────────────────────────────────
   Programa de Afiliados — regras de comissão (modelo recorrente)
   - 30% em cada pagamento do indicado nos primeiros 12 meses de assinatura.
   - Bônus: se o indicado foi o cliente novo nº51+ conquistado pelo afiliado
     no mês da conversão, a taxa desse indicado sobe para 40% (30%+10%)
     enquanto durar a janela de 12 meses. Travado em AffiliateReferral.bonusTier
     no momento da conversão (não é recalculado depois).
   - Após 12 meses: 5% residual, vitalício, sem bônus.
   - Cancelamento até 30 dias após a conversão: zera as comissões pendentes
     desse indicado (clawback). Depois de 30 dias: nada é revertido — o
     afiliado mantém o que já foi gerado, só para de acumular no futuro.
   - Atribuição por pagamento é idempotente por (paymentId, affiliateId), mas
     — diferente do modelo antigo — múltiplas comissões por indicado ao longo
     do tempo são esperadas (uma por pagamento confirmado via webhook).
   - As taxas base/bônus/residual acima são apenas o default (env ou fixo).
     O admin pode sobrescrevê-las sem redeploy via AffiliateConfig (chave
     "rates" — ver lib/affiliateConfig.ts). Prioridade da taxa "cheia" (janela
     dos 12 meses): campanha sazonal ativa > taxa personalizada do afiliado
     (Affiliate.customRate) > bônus/base. A residual pós-12-meses é sempre a
     global — nunca afetada por campanha ou taxa personalizada.
   ───────────────────────────────────────────────────────── */

function envRate(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const COMMISSION = {
  BASE_RATE:     envRate(process.env.COMMISSION_BASE, 0.30),     // 30% — janela dos 12 meses
  BONUS_RATE:    envRate(process.env.COMMISSION_BONUS, 0.40),    // 40% — janela dos 12 meses, cliente nº51+ do mês
  RESIDUAL_RATE: envRate(process.env.COMMISSION_RESIDUAL, 0.05), // 5% — após 12 meses, vitalício
  RECURRING_MONTHS:     12, // duração da taxa cheia (30%/40%), em meses de assinatura
  BONUS_THRESHOLD:      50, // clientes novos/mês do afiliado a partir dos quais os seguintes ativam o bônus
  CANCEL_CLAWBACK_DAYS: 30, // cancelamento até aqui (desde a conversão) zera comissões pendentes
  PAYOUT_HOLD_DAYS:     30, // D+30 até o saldo virar disponível para saque
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gera um código curto e legível para divulgação do afiliado. */
export function genAffiliateCode(): string {
  // 8 chars base36 maiúsculos (sem ambiguidade visual excessiva)
  return Math.random().toString(36).slice(2, 6).toUpperCase()
       + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * Atribui a comissão de um pagamento ao afiliado que indicou o usuário.
 * Chamado pelo webhook do Asaas a cada pagamento confirmado (inclusive
 * renovações) — silencioso e idempotente por (paymentId, affiliateId).
 */
export async function attributeAffiliateCommission(
  referredUserId: string,
  paymentId: string,
  saleAmount: number,
  isYearly = false,
): Promise<void> {
  try {
    if (!saleAmount || saleAmount <= 0) return;

    const referral = await prisma.affiliateReferral.findUnique({
      where:   { referredUserId },
      include: { affiliate: true },
    });
    if (!referral || !referral.affiliate) return;

    const aff = referral.affiliate;
    if (aff.status !== 'approved') return;

    const prior = await prisma.affiliateCommission.count({
      where: { affiliateId: aff.id, referredUserId },
    });
    const isFirstPayment = prior === 0;
    const monthIndex = prior + 1;

    // Conversão (1º pagamento): define o marco de "há quanto tempo é
    // assinante" (usado para saber se ainda está na janela de 12 meses) e
    // trava se este indicado conta como cliente novo nº51+ do mês (bônus).
    let convertedAt = referral.convertedAt;
    let bonusTier = referral.bonusTier;
    if (isFirstPayment) {
      convertedAt = new Date();
      const monthStart = new Date(convertedAt.getFullYear(), convertedAt.getMonth(), 1);
      const monthEnd   = new Date(convertedAt.getFullYear(), convertedAt.getMonth() + 1, 1);
      const conversionsThisMonth = await prisma.affiliateReferral.count({
        where: {
          affiliateId: aff.id,
          status:      'converted',
          convertedAt: { gte: monthStart, lt: monthEnd },
        },
      });
      bonusTier = conversionsThisMonth >= COMMISSION.BONUS_THRESHOLD;

      await prisma.affiliateReferral.update({
        where: { id: referral.id },
        data:  { status: 'converted', convertedAt, bonusTier },
      });
    }

    // Janela dos 12 meses de taxa cheia contada por tempo decorrido desde a
    // conversão (não pelo nº de pagamentos) — trata mensal e anual de forma
    // consistente (ex.: a 2ª parcela de um plano anual já cobre o ano
    // seguinte e cai fora da janela).
    const daysSinceConversion = convertedAt ? (Date.now() - convertedAt.getTime()) / DAY_MS : 0;
    const withinRecurringWindow = isFirstPayment || daysSinceConversion <= COMMISSION.RECURRING_MONTHS * 30.44;

    const [rates, campaign] = await Promise.all([getEffectiveCommissionRates(), getActiveCampaign()]);
    const rate = !withinRecurringWindow
      ? rates.residual
      : (campaign?.rate ?? aff.customRate ?? (bonusTier ? rates.bonus : rates.base));
    const commissionType = isYearly ? 'annual' : 'monthly';
    const commissionAmount = round2(saleAmount * rate);
    if (commissionAmount <= 0) return;

    await prisma.affiliateCommission.create({
      data: {
        affiliateId: aff.id,
        referredUserId,
        paymentId,
        saleAmount,
        commissionAmount,
        commissionType,
        monthIndex,
        status: 'pending',
      },
    });

    const rateSource = withinRecurringWindow
      ? (campaign ? ` [campanha: ${campaign.name}]` : aff.customRate != null ? ' [taxa personalizada]' : '')
      : '';
    logger.info(`[Afiliado] Comissão atribuída: aff=${aff.id} user=${referredUserId} R$${commissionAmount} (${Math.round(rate * 100)}%, pagamento ${monthIndex})${rateSource}`);

    // Notificar afiliado por e-mail (best-effort) — só na 1ª comissão do
    // indicado, para não gerar 1 e-mail por mês por cliente recorrente.
    if (isFirstPayment) {
      const affUser = await prisma.user.findUnique({ where: { id: aff.userId }, select: { email: true, name: true } });
      if (affUser?.email) {
        const APP_URL = process.env.APP_URL || 'https://zapscript.me';
        const firstName = affUser.name?.split(' ')[0] || 'parceiro(a)';
        const amtFmt = commissionAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        sendEmail(
          affUser.email,
          `💸 Você ganhou ${amtFmt} — um indicado assinou pelo seu link!`,
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:12px">💸 Nova comissão gerada!</div>
            <p style="color:#a7f3d0;line-height:1.7">Olá, ${firstName}! Um dos seus indicados acabou de pagar a assinatura do ZapScript.</p>
            <p style="color:#a7f3d0;line-height:1.7">Comissão gerada: <strong style="color:#10b981;font-size:20px">${amtFmt}</strong></p>
            <p style="color:#a7f3d0;line-height:1.7">Essa comissão se repete a cada mensalidade paga por ele nos próximos 12 meses.</p>
            <p style="color:#6b7280;font-size:13px">Saldo liberado para saque 30 dias após cada comissão gerada, sem valor mínimo.</p>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/afiliado" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver extrato →</a>
            </div>
          </div>`,
        ).catch(err => logger.error(`[Afiliado] Falha ao enviar e-mail de comissão: ${err?.message}`));
      }
    }
  } catch (err: any) {
    // Violação de unique (paymentId, affiliateId) = pagamento duplicado → ignorar
    if (err?.code === 'P2002') return;
    logger.error(`[Afiliado] Falha ao atribuir comissão: ${err?.message}`);
  }
}

/**
 * Clawback de cancelamento: se o indicado cancelar até 30 dias após a
 * conversão, zera (cancela) as comissões pendentes geradas por ele. Depois
 * desse prazo, nada é revertido — o afiliado mantém o que já foi gerado e
 * apenas deixa de acumular novas comissões desse indicado.
 * Chamado tanto por POST /billing/cancel quanto pelo webhook
 * SUBSCRIPTION_DELETED do Asaas — silencioso, nunca lança.
 */
export async function clawbackAffiliateCommissionOnCancel(referredUserId: string): Promise<void> {
  try {
    const referral = await prisma.affiliateReferral.findUnique({
      where:  { referredUserId },
      select: { id: true, affiliateId: true, convertedAt: true },
    });
    if (!referral?.convertedAt) return;

    const daysSinceConversion = (Date.now() - referral.convertedAt.getTime()) / DAY_MS;
    if (daysSinceConversion > COMMISSION.CANCEL_CLAWBACK_DAYS) return;

    const { count } = await prisma.affiliateCommission.updateMany({
      where: { affiliateId: referral.affiliateId, referredUserId, status: 'pending' },
      data:  { status: 'canceled' },
    });
    if (count > 0) {
      logger.info(`[Afiliado] Clawback de cancelamento: ${Math.round(daysSinceConversion)}d após conversão, ${count} comissão(ões) pendente(s) zerada(s) — aff=${referral.affiliateId} user=${referredUserId}`);
    }
  } catch (err: any) {
    logger.error(`[Afiliado] Falha ao aplicar clawback de cancelamento: ${err?.message}`);
  }
}
