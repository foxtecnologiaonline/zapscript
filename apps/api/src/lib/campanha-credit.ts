import { prisma } from './prisma';
import { logger } from './logger';

/* ─────────────────────────────────────────────────────────
   Saldo de mensagens do Chatbot Campanhas — ledger próprio
   (CampanhaBalance + CampanhaBalanceTransaction), separado de
   CreditWallet/CreditTransaction (lib/credit.ts): aqui é saldo de MENSAGENS
   de campanha, não crédito em R$ de indicação. Mesmo formato de
   debitWallet()/creditExtraMinutes() (lib/credit.ts, routes/billing.ts).
   ───────────────────────────────────────────────────────── */

export class InsufficientCampanhaBalanceError extends Error {
  constructor() { super('Saldo de mensagens insuficiente.'); this.name = 'InsufficientCampanhaBalanceError'; }
}

/** Busca o saldo do usuário, criando-o (zerado) se ainda não existir. */
export async function getOrCreateCampanhaBalance(userId: string) {
  return prisma.campanhaBalance.upsert({
    where:  { userId },
    update: {},
    create: { userId },
  });
}

type CreditType = 'purchase' | 'monthly_reset' | 'refund';

async function adjustBalance(
  userId: string,
  delta: number,
  type: CreditType | 'debit',
  opts: { referenceType?: string; referenceId?: string },
): Promise<{ balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    const balance = await tx.campanhaBalance.upsert({
      where: { userId }, update: {}, create: { userId },
    });
    if (delta < 0 && balance.availableMessages < -delta) throw new InsufficientCampanhaBalanceError();

    const updated = await tx.campanhaBalance.update({
      where: { id: balance.id },
      data:  { availableMessages: { increment: delta } },
    });
    await tx.campanhaBalanceTransaction.create({
      data: {
        balanceId:     balance.id,
        type,
        amount:        delta,
        balanceAfter:  updated.availableMessages,
        referenceType: opts.referenceType,
        referenceId:   opts.referenceId,
      },
    });
    logger.info(`[CampanhaBalance] ${type}: user=${userId} ${delta > 0 ? '+' : ''}${delta} msgs (saldo=${updated.availableMessages})`);
    return { balanceAfter: updated.availableMessages };
  });
}

/**
 * Credita mensagens (compra de pacote avulso ou renovação mensal) e registra
 * o lançamento no livro-razão dentro de uma transação atômica. Idempotente do
 * ponto de vista do chamador — quem chama (webhook Asaas) já garante que só
 * roda uma vez por pagamento via ProcessedWebhook.
 */
export async function creditCampanhaMessages(
  userId: string,
  count: number,
  opts: { type?: 'purchase' | 'monthly_reset'; referenceType?: string; referenceId?: string } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) return { balanceAfter: (await getOrCreateCampanhaBalance(userId)).availableMessages };
  return adjustBalance(userId, count, opts.type ?? 'purchase', opts);
}

/**
 * Débito genérico do saldo: valida saldo, decrementa e registra o
 * lançamento — tudo em uma transação atômica. Chamado ANTES de criar/iniciar
 * o disparo da campanha (nunca depois), para não vender mensagens que já
 * saíram sem cobrar.
 */
export async function debitCampanhaMessages(
  userId: string,
  count: number,
  opts: { referenceType?: string; referenceId?: string } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) throw new Error('Quantidade inválida.');
  return adjustBalance(userId, -count, 'debit', opts);
}

/** Estorno (campanha falhou após o saldo já ter sido debitado). */
export async function refundCampanhaMessages(
  userId: string,
  count: number,
  opts: { referenceType?: string; referenceId?: string } = {},
): Promise<{ balanceAfter: number }> {
  if (!count || count <= 0) return { balanceAfter: (await getOrCreateCampanhaBalance(userId)).availableMessages };
  return adjustBalance(userId, count, 'refund', opts);
}
