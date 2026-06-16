import { prisma } from './prisma';
import { logger } from './logger';

/* ─────────────────────────────────────────────────────────
   Programa de Afiliados — regras de comissão
   - onetime:   30% do 1º pagamento do indicado (uma única vez)
   - recurring:  5% de cada mensalidade nos primeiros 12 meses
   Atribuição é idempotente por (paymentId, affiliateId).
   ───────────────────────────────────────────────────────── */

export const COMMISSION = {
  ONETIME_RATE:   0.30,
  RECURRING_RATE: 0.05,
  RECURRING_MAX_MONTHS: 12,
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
 * Atribui a comissão de uma venda (mensalidade paga) ao afiliado que indicou o usuário.
 * Chamado pelo webhook do Asaas em pagamentos de assinatura confirmados.
 * Silencioso e idempotente — nunca derruba o fluxo de pagamento.
 */
export async function attributeAffiliateCommission(
  referredUserId: string,
  paymentId: string,
  saleAmount: number,
): Promise<void> {
  try {
    if (!saleAmount || saleAmount <= 0) return;

    const referral = await prisma.affiliateReferral.findUnique({
      where:   { referredUserId },
      include: { affiliate: true },
    });
    if (!referral || !referral.affiliate) return;

    const aff = referral.affiliate;
    if (aff.status !== 'approved') return; // só afiliados aprovados ganham comissão

    // Comissões já geradas para este par afiliado→indicado
    const prior = await prisma.affiliateCommission.count({
      where: { affiliateId: aff.id, referredUserId },
    });

    let commissionAmount: number;
    let monthIndex: number;

    if (aff.commissionType === 'onetime') {
      if (prior > 0) return; // comissão única já paga
      commissionAmount = round2(saleAmount * COMMISSION.ONETIME_RATE);
      monthIndex = 1;
    } else {
      // recurring
      if (prior >= COMMISSION.RECURRING_MAX_MONTHS) return; // limite de 12 meses atingido
      commissionAmount = round2(saleAmount * COMMISSION.RECURRING_RATE);
      monthIndex = prior + 1;
    }

    if (commissionAmount <= 0) return;

    await prisma.affiliateCommission.create({
      data: {
        affiliateId:    aff.id,
        referredUserId,
        paymentId,
        saleAmount,
        commissionAmount,
        commissionType: aff.commissionType,
        monthIndex,
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

    logger.info(`[Afiliado] Comissão atribuída: aff=${aff.id} user=${referredUserId} R$${commissionAmount} (${aff.commissionType} m${monthIndex})`);
  } catch (err: any) {
    // Violação de unique (paymentId, affiliateId) = pagamento duplicado → ignorar
    if (err?.code === 'P2002') return;
    logger.error(`[Afiliado] Falha ao atribuir comissão: ${err?.message}`);
  }
}
