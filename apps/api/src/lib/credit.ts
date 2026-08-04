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

export class InsufficientBalanceError extends Error {
  constructor() { super('Saldo insuficiente.'); this.name = 'InsufficientBalanceError'; }
}

/**
 * Débito genérico da carteira (Art. 5º — os 3 trilhos de uso): valida saldo,
 * decrementa e registra o lançamento no livro-razão dentro de uma transação
 * atômica. `amount` é sempre positivo aqui; o lançamento em si é gravado
 * negativo (débito).
 */
async function debitWallet(
  userId: string,
  amount: number,
  type: 'redeem_invoice' | 'redeem_addon' | 'redeem_cashout',
  opts: { referenceType?: string; referenceId?: string; note?: string } = {},
): Promise<{ walletId: string; balanceAfter: number }> {
  if (!amount || amount <= 0) throw new Error('Valor inválido.');
  const amt = round2(amount);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.upsert({ where: { userId }, update: {}, create: { userId } });
    if (wallet.balance < amt) throw new InsufficientBalanceError();

    const updated = await tx.creditWallet.update({
      where: { id: wallet.id },
      data:  { balance: { decrement: amt } },
    });
    await tx.creditTransaction.create({
      data: {
        walletId:      wallet.id,
        type,
        amount:        -amt,
        balanceAfter:  updated.balance,
        referenceType: opts.referenceType,
        referenceId:   opts.referenceId,
        note:          opts.note,
      },
    });
    return { walletId: wallet.id, balanceAfter: updated.balance };
  });
}

/**
 * Trilho (a) — Art. 5º-a: abater fatura. O débito é imediato e automático;
 * a aplicação do desconto na próxima cobrança do Asaas é feita manualmente
 * pela equipe financeira (mesmo padrão operacional do saque em dinheiro) —
 * evita mexer na assinatura recorrente do Asaas sem teste prévio em produção.
 * Notifica o suporte por e-mail para dar seguimento.
 */
export async function redeemForInvoice(userId: string, amount: number): Promise<{ balanceAfter: number }> {
  const { balanceAfter } = await debitWallet(userId, amount, 'redeem_invoice', {
    note: 'Abatimento solicitado — aplicar desconto na próxima fatura (processo manual).',
  });
  logger.info(`[Crédito] Abatimento de fatura solicitado: user=${userId} R$${amount}`);
  notifyOpsRedemption(userId, amount, 'abater a próxima fatura').catch(() => null);
  return { balanceAfter };
}

/**
 * Trilho (b) — Art. 5º-b: comprar créditos avulsos. 100% automático — sem
 * interação com o Asaas, converte o saldo em minutos extras pelo mesmo
 * câmbio do pacote avulso mais vantajoso (ver MINUTE_PACKAGES em
 * routes/billing.ts: R$19/100min = R$0,19/min). A concessão em si (chamada a
 * creditExtraMinutes) é feita pela rota, que já importa routes/billing.ts —
 * mantém este arquivo livre de dependência circular.
 */
export const ADDON_MINUTE_PRICE_BRL = 0.19; // mesmo câmbio do pacote pkg_100 (melhor valor)

export async function redeemForAddon(userId: string, amount: number): Promise<{ balanceAfter: number; minutes: number }> {
  const { balanceAfter } = await debitWallet(userId, amount, 'redeem_addon', {
    referenceType: 'product',
    note: 'Convertido em minutos avulsos.',
  });
  const minutes = Math.floor((amount / ADDON_MINUTE_PRICE_BRL) * 100) / 100;
  logger.info(`[Crédito] Resgate em avulso: user=${userId} R$${amount} → ${minutes}min`);
  return { balanceAfter, minutes };
}

/**
 * Trilho (c) — Art. 5º-c: sacar em dinheiro. Débito imediato + registro de
 * uma solicitação de saque (WalletPayout); o pagamento via Pix em si é
 * manual pelo admin, mesmo padrão já usado no programa antigo de afiliados.
 */
export async function redeemForCashout(
  userId: string,
  amount: number,
  pixKey: string,
  pixKeyType: string,
): Promise<{ balanceAfter: number; payoutId: string }> {
  if (amount < CREDIT.MIN_CASHOUT) {
    throw new Error(`Valor mínimo de saque: R$${CREDIT.MIN_CASHOUT}.`);
  }
  const wallet = await getOrCreateWallet(userId);
  const { balanceAfter } = await debitWallet(userId, amount, 'redeem_cashout', {
    note: 'Solicitação de saque via Pix.',
  });
  const payout = await prisma.walletPayout.create({
    data: { walletId: wallet.id, amount, pixKey, pixKeyType },
  });
  logger.info(`[Crédito] Saque solicitado: user=${userId} R$${amount} payout=${payout.id}`);
  notifyOpsRedemption(userId, amount, 'sacar em dinheiro (Pix)').catch(() => null);
  return { balanceAfter, payoutId: payout.id };
}

/** Avisa o suporte/financeiro por e-mail quando um resgate precisa de ação manual. */
async function notifyOpsRedemption(userId: string, amount: number, acao: string): Promise<void> {
  const opsEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM?.replace(/.*<(.+)>/, '$1');
  if (!opsEmail) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  const amtFmt = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  sendEmail(
    opsEmail,
    `Resgate de carteira: ${user?.name || user?.email || userId} — ${amtFmt}`,
    `<p>Usuário ${user?.name || ''} (${user?.email}) solicitou ${acao}: <strong>${amtFmt}</strong>.</p>`,
  ).catch(() => null);
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
