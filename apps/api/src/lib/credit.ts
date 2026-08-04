import { prisma } from './prisma';
import { logger } from './logger';
import { sendEmail } from './mailer';

/* ─────────────────────────────────────────────────────────
   Carteira de Crédito — Regulamento v4 (ver REGULAMENTO_AFILIADOS.md)
   - Toda conta já tem carteira automaticamente — sem aplicação, sem aprovação
     (Art. 2º). Reaproveita User.refCode/referredBy como link único de
     atribuição (mesmo mecanismo do programa de indicação simples).
   - Taxa única de 20% sobre cada pagamento do indicado, sem tier, sem bônus,
     sem residual (Art. 3º).
   - Crédito nasce como PendingCredit na confirmação do pagamento e só vira
     saldo (CreditTransaction) 30 dias depois — se o pagamento do indicado for
     cancelado/reembolsado antes disso, o crédito simplesmente nunca é gerado
     (Art. 4º); não há estorno de saldo já lançado.
   - Coexiste, durante a migração, com o programa antigo (Affiliate/
     AffiliateCommission em lib/affiliate.ts) — a descontinuação do modelo
     antigo é uma etapa futura (Fase 4 do plano de migração).
   ───────────────────────────────────────────────────────── */

function envRate(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CREDIT = {
  RATE:            envRate(process.env.CREDIT_RATE, 0.20), // 20% — Art. 3º
  RELEASE_DAYS:    30, // Art. 4º — dias após a confirmação do pagamento do indicado
  MIN_CASHOUT:     50, // Art. 5º(c) — valor mínimo de saque em dinheiro
  EXPIRY_MONTHS:   12, // Art. 6º — validade do crédito não utilizado
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Busca a carteira do usuário, criando-a se ainda não existir (Art. 2º — automática). */
export async function getOrCreateWallet(userId: string) {
  return prisma.creditWallet.upsert({
    where:  { userId },
    update: {},
    create: { userId },
  });
}

/**
 * Registra o crédito em trânsito de um pagamento do indicado, atribuído a
 * quem o indicou (User.referredBy → refCode). Chamado pelo webhook do Asaas
 * a cada pagamento confirmado de assinatura — silencioso e idempotente por
 * paymentId. O crédito só libera 30 dias depois (ver releaseDuePendingCredits).
 */
export async function recordReferralCredit(
  referredUserId: string,
  paymentId: string,
  saleAmount: number,
): Promise<void> {
  try {
    if (!saleAmount || saleAmount <= 0) return;

    const paidUser = await prisma.user.findUnique({
      where:  { id: referredUserId },
      select: { referredBy: true },
    });
    if (!paidUser?.referredBy) return;

    const indicador = await prisma.user.findUnique({
      where:  { refCode: paidUser.referredBy },
      select: { id: true },
    });
    // Art. 7º — vedação de autoindicação: indicador não pode ser o próprio indicado.
    if (!indicador || indicador.id === referredUserId) return;

    const wallet = await getOrCreateWallet(indicador.id);
    const amount = round2(saleAmount * CREDIT.RATE);
    if (amount <= 0) return;

    await prisma.pendingCredit.upsert({
      where:  { paymentId },
      update: {},
      create: {
        walletId:       wallet.id,
        referredUserId,
        paymentId,
        amount,
        releaseAt: new Date(Date.now() + CREDIT.RELEASE_DAYS * DAY_MS),
      },
    });

    logger.info(`[Crédito] Pendente registrado: wallet=${wallet.id} user=${referredUserId} R$${amount} (libera em ${CREDIT.RELEASE_DAYS}d)`);
  } catch (err: any) {
    if (err?.code === 'P2002') return; // paymentId duplicado → ignorar
    logger.error(`[Crédito] Falha ao registrar crédito pendente: ${err?.message}`);
  }
}

/**
 * Cancela os créditos ainda pendentes (não liberados) gerados por um
 * indicado — chamado quando ele cancela/tem a assinatura removida. Como o
 * crédito só é gerado de fato na liberação (Art. 4º), cancelar o pendente
 * equivale a "o crédito nunca chega a nascer"; não há estorno de saldo já
 * lançado, pois esse já passou pelo pendente e não seria mais alcançado aqui.
 */
export async function clawbackPendingCreditsOnCancel(referredUserId: string): Promise<void> {
  try {
    const { count } = await prisma.pendingCredit.updateMany({
      where: { referredUserId, status: 'pending' },
      data:  { status: 'canceled' },
    });
    if (count > 0) {
      logger.info(`[Crédito] Cancelamento do indicado: ${count} crédito(s) pendente(s) cancelado(s) — user=${referredUserId}`);
    }
  } catch (err: any) {
    logger.error(`[Crédito] Falha ao cancelar créditos pendentes: ${err?.message}`);
  }
}

/**
 * Libera os créditos pendentes cujos 30 dias já se passaram (Art. 4º): soma
 * ao saldo da carteira e registra o lançamento no livro-razão. Chamada
 * periodicamente pelo worker (cron). Idempotente — cada PendingCredit só é
 * processado uma vez (status pending → released).
 */
export async function releaseDuePendingCredits(): Promise<{ released: number; totalAmount: number }> {
  const due = await prisma.pendingCredit.findMany({
    where: { status: 'pending', releaseAt: { lte: new Date() } },
    take:  200, // lote por execução — o cron roda com frequência, não precisa de tudo de uma vez
  });

  let totalAmount = 0;
  const succeeded: { walletId: string; amount: number }[] = [];

  for (const credit of due) {
    try {
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.creditWallet.update({
          where: { id: credit.walletId },
          data:  { balance: { increment: credit.amount } },
        });
        await tx.creditTransaction.create({
          data: {
            walletId:      wallet.id,
            type:          'earn_referral',
            amount:        credit.amount,
            balanceAfter:  wallet.balance,
            referenceType: 'payment',
            referenceId:   credit.paymentId,
          },
        });
        await tx.pendingCredit.update({
          where: { id: credit.id },
          data:  { status: 'released' },
        });
      });
      succeeded.push({ walletId: credit.walletId, amount: credit.amount });
      totalAmount = round2(totalAmount + credit.amount);
    } catch (err: any) {
      logger.error(`[Crédito] Falha ao liberar crédito pendente ${credit.id}: ${err?.message}`);
    }
  }

  if (succeeded.length > 0) {
    logger.info(`[Crédito] Liberação D+30: ${succeeded.length} crédito(s) liberado(s), R$${totalAmount} no total`);
    notifyReleasedCredits(succeeded).catch(() => null);
  }

  return { released: succeeded.length, totalAmount };
}

/** Notifica por e-mail quem teve crédito liberado (best-effort, não bloqueia a liberação). */
async function notifyReleasedCredits(credits: { walletId: string; amount: number }[]): Promise<void> {
  const byWallet = new Map<string, number>();
  for (const c of credits) byWallet.set(c.walletId, round2((byWallet.get(c.walletId) ?? 0) + c.amount));

  for (const [walletId, amount] of byWallet) {
    const wallet = await prisma.creditWallet.findUnique({
      where:  { id: walletId },
      select: { userId: true, balance: true },
    });
    if (!wallet) continue;
    const user = await prisma.user.findUnique({ where: { id: wallet.userId }, select: { email: true, name: true } });
    if (!user?.email) continue;

    const firstName = user.name?.split(' ')[0] || 'tudo bem';
    const amtFmt = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const balFmt = wallet.balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    sendEmail(
      user.email,
      `💰 ${amtFmt} liberados na sua carteira ZapScript`,
      `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
        <div style="font-size:22px;font-weight:bold;margin-bottom:12px">💰 Crédito liberado!</div>
        <p style="color:#a7f3d0;line-height:1.7">Olá, ${firstName}! O crédito de uma indicação sua acabou de ficar disponível.</p>
        <p style="color:#a7f3d0;line-height:1.7">Liberado agora: <strong style="color:#10b981;font-size:20px">${amtFmt}</strong></p>
        <p style="color:#a7f3d0;line-height:1.7">Saldo atual: <strong>${balFmt}</strong></p>
        <p style="color:#6b7280;font-size:13px">Use o saldo para abater sua próxima fatura, comprar créditos avulsos ou sacar via Pix (mínimo R$${CREDIT.MIN_CASHOUT}).</p>
      </div>`,
    ).catch(err => logger.error(`[Crédito] Falha ao enviar e-mail de liberação: ${err?.message}`));
  }
}
