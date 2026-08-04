import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import {
  getOrCreateWallet, CREDIT, ADDON_MINUTE_PRICE_BRL,
  redeemForInvoice, redeemForAddon, redeemForCashout, InsufficientBalanceError,
} from '../lib/credit';
import { creditExtraMinutes } from './billing';

/* ─────────────────────────────────────────────────────────
   Carteira de Crédito — Regulamento v4 (REGULAMENTO_AFILIADOS.md)
   Rotas self-service (JWT): saldo/extrato + os 3 trilhos de uso do saldo
   (Art. 5º: abater fatura, comprar avulso, sacar em dinheiro).
   ───────────────────────────────────────────────────────── */

const VALID_PIX_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'];

export default async function walletRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /wallet/rates — taxa e regras efetivas, público (sem auth) ───────
  app.get('/rates', async () => ({
    rate:              CREDIT.RATE,
    releaseDays:       CREDIT.RELEASE_DAYS,
    minCashout:        CREDIT.MIN_CASHOUT,
    expiryMonths:      CREDIT.EXPIRY_MONTHS,
    addonMinutePrice:  ADDON_MINUTE_PRICE_BRL,
  }));

  // ── GET /wallet/me — saldo, créditos em trânsito e extrato do usuário ────
  app.get('/me', auth, async (req: any) => {
    const userId = req.user.sub;
    const wallet = await getOrCreateWallet(userId);

    const [pending, transactions, payouts] = await Promise.all([
      prisma.pendingCredit.aggregate({
        where:  { walletId: wallet.id, status: 'pending' },
        _sum:   { amount: true },
        _count: true,
      }),
      prisma.creditTransaction.findMany({
        where:   { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take:    100,
      }),
      prisma.walletPayout.findMany({
        where:   { walletId: wallet.id },
        orderBy: { requestedAt: 'desc' },
        take:    20,
      }),
    ]);

    return {
      balance:       wallet.balance,
      pendingAmount: pending._sum.amount ?? 0,
      pendingCount:  pending._count,
      minCashout:    CREDIT.MIN_CASHOUT,
      pixKey:        wallet.pixKey,
      pixKeyType:    wallet.pixKeyType,
      payoutName:    wallet.payoutName,
      refCode:       (await prisma.user.findUnique({ where: { id: userId }, select: { refCode: true } }))?.refCode,
      transactions,
      payouts,
    };
  });

  // ── PUT /wallet/me — atualizar dados de Pix (usados no saque) ────────────
  app.put('/me', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { pixKey, pixKeyType, payoutName } = (req.body || {}) as any;
    if (pixKeyType && !VALID_PIX_TYPES.includes(pixKeyType)) {
      return reply.code(400).send({ error: 'Tipo de chave Pix inválido.' });
    }
    const wallet = await getOrCreateWallet(userId);
    const updated = await prisma.creditWallet.update({
      where: { id: wallet.id },
      data:  {
        pixKey:     pixKey?.trim() || wallet.pixKey,
        pixKeyType: pixKeyType || wallet.pixKeyType,
        payoutName: payoutName?.trim() || wallet.payoutName,
      },
    });
    return { pixKey: updated.pixKey, pixKeyType: updated.pixKeyType, payoutName: updated.payoutName };
  });

  // ── POST /wallet/redeem/invoice — Art. 5º-a: abater a próxima fatura ─────
  app.post(
    '/redeem/invoice',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const amount = Number((req.body as any)?.amount);
      if (!amount || amount <= 0) return reply.code(400).send({ error: 'Informe um valor válido.' });
      try {
        const { balanceAfter } = await redeemForInvoice(userId, amount);
        return { balance: balanceAfter, message: 'Solicitado — o desconto será aplicado na sua próxima fatura.' };
      } catch (err: any) {
        if (err instanceof InsufficientBalanceError) return reply.code(400).send({ error: err.message });
        req.log.error({ err }, '[Wallet] Falha em redeem/invoice');
        return reply.code(500).send({ error: 'Erro ao processar o resgate.' });
      }
    },
  );

  // ── POST /wallet/redeem/addon — Art. 5º-b: comprar créditos avulsos ──────
  app.post(
    '/redeem/addon',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const amount = Number((req.body as any)?.amount);
      if (!amount || amount <= 0) return reply.code(400).send({ error: 'Informe um valor válido.' });
      try {
        const { balanceAfter, minutes } = await redeemForAddon(userId, amount);
        await creditExtraMinutes(userId, minutes);
        return { balance: balanceAfter, minutesGranted: minutes };
      } catch (err: any) {
        if (err instanceof InsufficientBalanceError) return reply.code(400).send({ error: err.message });
        req.log.error({ err }, '[Wallet] Falha em redeem/addon');
        return reply.code(500).send({ error: 'Erro ao processar o resgate.' });
      }
    },
  );

  // ── POST /wallet/redeem/cashout — Art. 5º-c: sacar em dinheiro (Pix) ─────
  app.post(
    '/redeem/cashout',
    { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const amount = Number((req.body as any)?.amount);
      const { pixKey: bodyPixKey, pixKeyType: bodyPixKeyType } = (req.body || {}) as any;
      if (!amount || amount <= 0) return reply.code(400).send({ error: 'Informe um valor válido.' });

      const wallet = await getOrCreateWallet(userId);
      const pixKey     = bodyPixKey || wallet.pixKey;
      const pixKeyType = bodyPixKeyType || wallet.pixKeyType;
      if (!pixKey || !pixKeyType) {
        return reply.code(400).send({ error: 'Cadastre sua chave Pix antes de solicitar o saque.' });
      }
      if (bodyPixKey && bodyPixKeyType) {
        await prisma.creditWallet.update({ where: { id: wallet.id }, data: { pixKey, pixKeyType } }).catch(() => null);
      }

      try {
        const { balanceAfter, payoutId } = await redeemForCashout(userId, amount, pixKey, pixKeyType);
        return { balance: balanceAfter, payoutId, message: 'Saque solicitado — pagamento via Pix processado manualmente pela equipe.' };
      } catch (err: any) {
        if (err instanceof InsufficientBalanceError || /mínimo/.test(err?.message || '')) {
          return reply.code(400).send({ error: err.message });
        }
        req.log.error({ err }, '[Wallet] Falha em redeem/cashout');
        return reply.code(500).send({ error: 'Erro ao processar o saque.' });
      }
    },
  );
}
