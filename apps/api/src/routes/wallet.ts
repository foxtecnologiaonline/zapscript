import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getOrCreateWallet, CREDIT } from '../lib/credit';

/* ─────────────────────────────────────────────────────────
   Carteira de Crédito — Regulamento v4 (REGULAMENTO_AFILIADOS.md)
   Rotas self-service (JWT). Fase 1 do plano de migração: só leitura
   (saldo + extrato + créditos em trânsito). Os 3 trilhos de uso do saldo
   (Art. 5º: abater fatura, comprar avulso, sacar em dinheiro) são a Fase 2/3,
   ainda não implementados.
   ───────────────────────────────────────────────────────── */

export default async function walletRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /wallet/rates — taxa e regras efetivas, público (sem auth) ───────
  app.get('/rates', async () => ({
    rate:          CREDIT.RATE,
    releaseDays:   CREDIT.RELEASE_DAYS,
    minCashout:    CREDIT.MIN_CASHOUT,
    expiryMonths:  CREDIT.EXPIRY_MONTHS,
  }));

  // ── GET /wallet/me — saldo, créditos em trânsito e extrato do usuário ────
  app.get('/me', auth, async (req: any) => {
    const userId = req.user.sub;
    const wallet = await getOrCreateWallet(userId);

    const [pending, transactions] = await Promise.all([
      prisma.pendingCredit.aggregate({
        where: { walletId: wallet.id, status: 'pending' },
        _sum:  { amount: true },
        _count: true,
      }),
      prisma.creditTransaction.findMany({
        where:   { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take:    100,
      }),
    ]);

    return {
      balance:      wallet.balance,
      pendingAmount: pending._sum.amount ?? 0,
      pendingCount:  pending._count,
      minCashout:    CREDIT.MIN_CASHOUT,
      transactions,
    };
  });
}
