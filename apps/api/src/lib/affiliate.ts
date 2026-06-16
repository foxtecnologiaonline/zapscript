import { prisma } from './prisma';
import { logger } from './logger';
import { sendEmail } from './mailer';

/* ─────────────────────────────────────────────────────────
   Programa de Afiliados — regras de comissão
   - onetime:   30% do 1º pagamento do indicado (uma única vez)
   - recurring:  5% de cada mensalidade nos primeiros 12 meses
   Atribuição é idempotente por (paymentId, affiliateId).
   ───────────────────────────────────────────────────────── */

export const COMMISSION = {
  MONTHLY_RATE: 0.50, // 50% do 1º pagamento de plano mensal
  YEARLY_RATE:  0.20, // 20% do 1º pagamento de plano anual
  PAYOUT_DAYS:  [10, 25], // dias de pagamento (informativo para UI)
} as const;

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
 * Atribui a comissão de uma venda ao afiliado que indicou o usuário.
 * Regras: 50% do 1º pagamento mensal OU 20% do 1º pagamento anual (ambos únicos).
 * Chamado pelo webhook do Asaas. Silencioso e idempotente.
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

    // Comissão é única por indicado (independente do ciclo)
    const prior = await prisma.affiliateCommission.count({
      where: { affiliateId: aff.id, referredUserId },
    });
    if (prior > 0) return;

    const rate           = isYearly ? COMMISSION.YEARLY_RATE : COMMISSION.MONTHLY_RATE;
    const commissionType = isYearly ? 'annual' : 'monthly';
    const commissionAmount = round2(saleAmount * rate);
    if (commissionAmount <= 0) return;

    await prisma.affiliateCommission.create({
      data: {
        affiliateId:    aff.id,
        referredUserId,
        paymentId,
        saleAmount,
        commissionAmount,
        commissionType,
        monthIndex:     1,
        status:         'pending',
      },
    });

    // Marcar referral como convertido (primeira venda)
    if (referral.status !== 'converted') {
      await prisma.affiliateReferral.update({
        where: { id: referral.id },
        data:  { status: 'converted', convertedAt: new Date() },
      });
    }

    logger.info(`[Afiliado] Comissão atribuída: aff=${aff.id} user=${referredUserId} R$${commissionAmount} (${commissionType})`);

    // Notificar afiliado por e-mail (best-effort)
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
          <p style="color:#6b7280;font-size:13px">Pagamentos via Pix até o dia 15 do mês seguinte (mínimo R$50,00 acumulado).</p>
          <div style="margin:24px 0;text-align:center">
            <a href="${APP_URL}/dashboard/afiliado" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver extrato →</a>
          </div>
        </div>`,
      ).catch(err => logger.error(`[Afiliado] Falha ao enviar e-mail de comissão: ${err?.message}`));
    }
  } catch (err: any) {
    // Violação de unique (paymentId, affiliateId) = pagamento duplicado → ignorar
    if (err?.code === 'P2002') return;
    logger.error(`[Afiliado] Falha ao atribuir comissão: ${err?.message}`);
  }
}
