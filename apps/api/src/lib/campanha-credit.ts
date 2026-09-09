import { prisma } from './prisma';
import { logger } from './logger';

/* ─────────────────────────────────────────────────────────
   Saldo de mensagens do módulo Campanhas — ledger próprio
   (CampanhaBalance + CampanhaBalanceTransaction), separado de
   CreditWallet/CreditTransaction (lib/credit.ts): aqui é saldo de MENSAGENS
   de campanha, não crédito em R$ de indicação.

   Política de preços (decisão de produto, 2026-09-09 — ver
   CAMPANHAS_ARQUITETURA.md §17): três fontes de saldo, cada uma com sua
   própria regra, somadas em `availableMessages` só pra leitura rápida —
   quem manda de verdade em cada débito são os campos abaixo.

   - `freeMessages`  — cota grátis mensal (30/mês), NÃO cumulativa: reseta
     pra 30 a cada mês (não soma sobre sobra), controlada por `freeResetAt`.
   - `paidMessages`  — saldo pago (pacotes pré-pagos avulsos), com validade
     em `paidExpiresAt` — estendida pra frente (nunca encolhe) a cada
     compra nova, mesmo padrão de extraMinutesExpiry() em routes/billing.ts.
   - `plan === 'monthly'` — assinatura Mensal Ilimitado: enquanto ativa,
     debita zero de qualquer pool (uso ilimitado), só registra a transação
     pra auditoria.
   ───────────────────────────────────────────────────────── */

export class InsufficientCampanhaBalanceError extends Error {
  constructor() { super('Saldo de mensagens insuficiente.'); this.name = 'InsufficientCampanhaBalanceError'; }
}

/** Cota grátis mensal — igual pra todo usuário do ZapScript, sem exceção. */
export const CAMPANHA_FREE_MESSAGES_PER_MONTH = 30;

type BalanceRow = {
  id: string;
  availableMessages: number;
  freeMessages: number;
  freeResetAt: Date | null;
  paidMessages: number;
  paidExpiresAt: Date | null;
  plan: string | null;
  renewalDate: Date | null;
  [key: string]: unknown;
};

/** 1º dia do mês seguinte a `from`, 00:00 UTC — próximo reset da cota grátis. */
function nextFreeReset(from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

/**
 * Garante que a cota grátis do mês corrente já foi concedida — se `freeResetAt`
 * é nulo (conta nova) ou já passou, reseta `freeMessages` para
 * CAMPANHA_FREE_MESSAGES_PER_MONTH (não incrementa: sobra do mês anterior não
 * acumula) e agenda o próximo reset. Idempotente dentro da mesma transação
 * (só reseta se `freeResetAt` estiver vencido). Deve ser chamada dentro de um
 * `prisma.$transaction` já aberto, com o balance travado pela própria leitura.
 */
async function ensureFreeQuota(tx: any, balance: BalanceRow): Promise<BalanceRow> {
  const now = new Date();
  if (balance.freeResetAt && balance.freeResetAt > now) return balance;

  const delta = CAMPANHA_FREE_MESSAGES_PER_MONTH - balance.freeMessages;
  const updated = await tx.campanhaBalance.update({
    where: { id: balance.id },
    data: {
      freeMessages:      CAMPANHA_FREE_MESSAGES_PER_MONTH,
      freeResetAt:       nextFreeReset(now),
      availableMessages: { increment: delta },
    },
  });
  if (delta !== 0) {
    await tx.campanhaBalanceTransaction.create({
      data: {
        balanceId:     balance.id,
        type:          'monthly_reset',
        amount:        delta,
        balanceAfter:  updated.availableMessages,
        referenceType: 'free_tier',
      },
    });
  }
  return updated as BalanceRow;
}

/** Busca o saldo do usuário, criando-o (zerado) se ainda não existir — já com a cota grátis do mês em dia. */
export async function getOrCreateCampanhaBalance(userId: string): Promise<BalanceRow> {
  return prisma.$transaction(async (tx) => {
    const balance = await tx.campanhaBalance.upsert({
      where:  { userId },
      update: {},
      create: { userId },
    });
    if (balance.plan === 'monthly') return balance as BalanceRow; // ilimitado — não precisa da cota grátis
    return ensureFreeQuota(tx, balance as BalanceRow);
  });
}

type CreditType = 'purchase' | 'refund';

/**
 * Credita mensagens PAGAS (compra de pacote avulso, ou estorno) e registra o
 * lançamento no livro-razão dentro de uma transação atômica. `validityDays`,
 * quando informado, estende `paidExpiresAt` pra frente (nunca encolhe) —
 * omitido em estornos sem validade nova, o estorno herda a validade vigente
 * (ou ganha 30 dias de carência se já não houver nenhuma). Idempotente do
 * ponto de vista do chamador — quem chama (webhook Asaas) já garante que só
 * roda uma vez por pagamento via ProcessedWebhook.
 */
export async function creditCampanhaMessages(
  userId: string,
  count: number,
  opts: { type?: CreditType; referenceType?: string; referenceId?: string; validityDays?: number } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) return { balanceAfter: (await getOrCreateCampanhaBalance(userId)).availableMessages };

  return prisma.$transaction(async (tx) => {
    const balance = await tx.campanhaBalance.upsert({ where: { userId }, update: {}, create: { userId } });
    const now = new Date();
    const currentExpiry = balance.paidExpiresAt && balance.paidExpiresAt > now ? balance.paidExpiresAt : null;
    const candidateExpiry = opts.validityDays
      ? new Date(now.getTime() + opts.validityDays * 24 * 60 * 60 * 1000)
      : (currentExpiry ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    const paidExpiresAt = currentExpiry && currentExpiry > candidateExpiry ? currentExpiry : candidateExpiry;

    const updated = await tx.campanhaBalance.update({
      where: { id: balance.id },
      data: {
        paidMessages:      { increment: count },
        paidExpiresAt,
        availableMessages: { increment: count },
      },
    });
    await tx.campanhaBalanceTransaction.create({
      data: {
        balanceId:     balance.id,
        type:          opts.type ?? 'purchase',
        amount:        count,
        balanceAfter:  updated.availableMessages,
        referenceType: opts.referenceType,
        referenceId:   opts.referenceId,
      },
    });
    logger.info(`[CampanhaBalance] ${opts.type ?? 'purchase'}: user=${userId} +${count} msgs (saldo=${updated.availableMessages})`);
    return { balanceAfter: updated.availableMessages };
  });
}

/**
 * Débito genérico do saldo: garante a cota grátis do mês, consome primeiro o
 * saldo grátis e só depois o saldo pago não-vencido (`paidExpiresAt` no
 * futuro) — nunca a assinatura Mensal Ilimitado, que é tratada à parte
 * (débito zero, sempre passa). Sem saldo suficiente, lança
 * InsufficientCampanhaBalanceError sem tocar em nada. Chamado ANTES de
 * criar/iniciar o disparo da campanha (nunca depois), para não vender
 * mensagens que já saíram sem cobrar.
 */
export async function debitCampanhaMessages(
  userId: string,
  count: number,
  opts: { referenceType?: string; referenceId?: string } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) throw new Error('Quantidade inválida.');

  return prisma.$transaction(async (tx) => {
    let balance: BalanceRow = await tx.campanhaBalance.upsert({ where: { userId }, update: {}, create: { userId } });

    // Mensal Ilimitado: sai antes de mexer na cota grátis — assinante nem precisa dela.
    if (balance.plan === 'monthly') {
      await tx.campanhaBalanceTransaction.create({
        data: {
          balanceId:     balance.id,
          type:          'debit_unlimited',
          amount:        0,
          balanceAfter:  balance.availableMessages,
          referenceType: opts.referenceType,
          referenceId:   opts.referenceId,
        },
      });
      logger.info(`[CampanhaBalance] debit_unlimited: user=${userId} ${count} msgs (plano Mensal Ilimitado)`);
      return { balanceAfter: balance.availableMessages };
    }

    balance = await ensureFreeQuota(tx, balance as BalanceRow);

    const now = new Date();
    const paidUsable = balance.paidExpiresAt && balance.paidExpiresAt > now ? balance.paidMessages : 0;
    if (balance.freeMessages + paidUsable < count) throw new InsufficientCampanhaBalanceError();

    const fromFree = Math.min(balance.freeMessages, count);
    const fromPaid = count - fromFree;

    const updated = await tx.campanhaBalance.update({
      where: { id: balance.id },
      data: {
        freeMessages:      { decrement: fromFree },
        paidMessages:      { decrement: fromPaid },
        availableMessages: { decrement: count },
      },
    });
    await tx.campanhaBalanceTransaction.create({
      data: {
        balanceId:     balance.id,
        type:          'debit',
        amount:        -count,
        balanceAfter:  updated.availableMessages,
        referenceType: opts.referenceType,
        referenceId:   opts.referenceId,
      },
    });
    logger.info(`[CampanhaBalance] debit: user=${userId} -${count} msgs (${fromFree} grátis + ${fromPaid} pagas, saldo=${updated.availableMessages})`);
    return { balanceAfter: updated.availableMessages };
  });
}

/** Estorno (campanha falhou após o saldo já ter sido debitado) — sempre volta pro pool pago. */
export async function refundCampanhaMessages(
  userId: string,
  count: number,
  opts: { referenceType?: string; referenceId?: string } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) return { balanceAfter: (await getOrCreateCampanhaBalance(userId)).availableMessages };
  return creditCampanhaMessages(userId, count, { type: 'refund', ...opts });
}
