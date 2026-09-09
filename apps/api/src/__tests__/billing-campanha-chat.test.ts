/**
 * Testes das rotas de billing do Chatbot Campanhas — pacotes avulsos e
 * assinatura mensal de mensagens (CampanhaBalance), isolados do resto de
 * billing.test.ts (mock de $transaction diferente: aqui é callback-style,
 * como usado por lib/campanha-credit.ts).
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.ASAAS_API_KEY  = 'test-key';

import Fastify from 'fastify';
import jwt from '@fastify/jwt';

type Balance = {
  id: string; userId: string; availableMessages: number;
  freeMessages: number; freeResetAt: Date | null;
  paidMessages: number; paidExpiresAt: Date | null;
  plan: string | null; asaasSubscriptionId: string | null; asaasCustomerId: string | null; renewalDate: Date | null;
};
const balances = new Map<string, Balance>();
let nextId = 1;

function balanceFor(userId: string): Balance {
  let b = balances.get(userId);
  if (!b) {
    b = {
      id: `bal_${nextId++}`, userId, availableMessages: 0,
      freeMessages: 0, freeResetAt: null,
      paidMessages: 0, paidExpiresAt: null,
      plan: null, asaasSubscriptionId: null, asaasCustomerId: null, renewalDate: null,
    };
    balances.set(userId, b);
  }
  return b;
}

function applyUpdate(b: Balance, data: any) {
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val && typeof val === 'object' && 'increment' in val) (b as any)[key] += val.increment;
    else if (val && typeof val === 'object' && 'decrement' in val) (b as any)[key] -= val.decrement;
    else (b as any)[key] = val;
  }
}

jest.mock('../lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert:     jest.fn().mockResolvedValue({}),
      update:     jest.fn().mockResolvedValue({}),
    },
    plan: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.name === 'free' ? { id: 'plan_free', name: 'free', label: 'Free' } : { id: `plan_${where.id}`, name: where.id, label: where.id }),
    },
    processedWebhook:           { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    user:                       { findUnique: jest.fn().mockResolvedValue({ email: 'x@x.com', name: 'Fulano', emailVerified: true }) },
    campanhaBalance: {
      upsert:      jest.fn(async ({ where, create, update }: any) => {
        const exists = balances.has(where.userId);
        const b = balanceFor(where.userId);
        if (exists) Object.assign(b, update);
        else Object.assign(b, create);
        return b;
      }),
      update:      jest.fn(async ({ where, data }: any) => {
        const b = [...balances.values()].find(x => x.id === where.id || x.userId === where.userId)!;
        applyUpdate(b, data);
        return b;
      }),
      findUnique:  jest.fn(async ({ where }: any) => balances.get(where.userId) ?? null),
    },
    campanhaBalanceTransaction: { create: jest.fn(async ({ data }: any) => data) },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const { prisma } = jest.requireMock('../lib/prisma') as any;
      return arg(prisma);
    }),
  },
}));

jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

global.fetch = jest.fn(async (url: any, opts: any) => {
  const u = String(url);
  if (u.endsWith('/customers') && opts?.method === 'POST') {
    return { json: async () => ({ id: 'cus_new' }) } as any;
  }
  if (u.endsWith('/payments') && opts?.method === 'POST') {
    return { json: async () => ({ id: 'pay_camp_1', status: 'PENDING' }) } as any;
  }
  if (u.includes('/pixQrCode')) {
    return { json: async () => ({ payload: '00020126...pix', encodedImage: 'base64img' }) } as any;
  }
  if (u.endsWith('/subscriptions') && opts?.method === 'POST') {
    return { json: async () => ({ id: 'sub_camp_1' }) } as any;
  }
  if (u.includes('/subscriptions/') && u.includes('/payments')) {
    return { json: async () => ({ data: [{ id: 'pay_camp_first' }] }) } as any;
  }
  return { json: async () => ({}) } as any;
}) as any;

import { prisma } from '../lib/prisma';
import { subscribeCorePlanViaPix } from '../routes/billing';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/billing'), { prefix: '/billing' });
  await app.ready();
  return app;
}

describe('Chatbot Campanhas — billing', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    balances.clear(); nextId = 1; jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'x@x.com', name: 'Fulano', emailVerified: true });
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('GET /billing/campanha-packages lista pacotes e o plano mensal', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/campanha-packages' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.packages.some((p: any) => p.id === 'pkg_camp_1k')).toBe(true);
    expect(body.monthly.unlimited).toBe(true);
    expect(body.freeMessagesPerMonth).toBeGreaterThan(0);
  });

  it('webhook PAYMENT_CONFIRMED credita pacote avulso de mensagens', async () => {
    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: { 'asaas-access-token': 'test-webhook-token' },
      payload: {
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_pkg_1', externalReference: 'u1|pkg_campanha_msgs|1000', customer: 'cus_1' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(balanceFor('u1').availableMessages).toBe(1000);
    expect(prisma.processedWebhook.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { paymentId: 'pay_pkg_1' } }));
  });

  it('webhook duplicado não credita duas vezes', async () => {
    (prisma.processedWebhook.findUnique as jest.Mock).mockResolvedValueOnce({ paymentId: 'pay_dup' });
    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: { 'asaas-access-token': 'test-webhook-token' },
      payload: { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_dup', externalReference: 'u1|pkg_campanha_msgs|1000' } },
    });
    expect(res.statusCode).toBe(200);
    expect(balanceFor('u1').availableMessages).toBe(0);
  });

  it('webhook PAYMENT_CONFIRMED da assinatura mensal ativa o plano Ilimitado (sem creditar mensagens)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: { 'asaas-access-token': 'test-webhook-token' },
      payload: {
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_monthly_1', externalReference: 'u1|campanha_monthly', customer: 'cus_1' },
      },
    });
    expect(res.statusCode).toBe(200);
    const b = balanceFor('u1');
    expect(b.availableMessages).toBe(0); // ilimitado não credita mensagens no pool
    expect(b.plan).toBe('monthly');
    expect(b.renewalDate).not.toBeNull();
  });

  it('webhook SUBSCRIPTION_DELETED da assinatura de campanhas limpa só o CampanhaBalance (não mexe no plano core)', async () => {
    balances.set('u1', {
      id: 'bal_1', userId: 'u1', availableMessages: 500,
      freeMessages: 0, freeResetAt: null, paidMessages: 500, paidExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      plan: 'monthly', asaasSubscriptionId: 'sub_camp_1', asaasCustomerId: 'cus_1', renewalDate: new Date(),
    });
    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: { 'asaas-access-token': 'test-webhook-token' },
      payload: { event: 'SUBSCRIPTION_DELETED', subscription: { externalReference: 'u1|campanha_monthly' } },
    });
    expect(res.statusCode).toBe(200);
    const b = balanceFor('u1');
    expect(b.plan).toBeNull();
    expect(b.asaasSubscriptionId).toBeNull();
    expect(b.availableMessages).toBe(500); // saldo já creditado não é mexido no cancelamento
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled(); // não tocou o fluxo do plano core
  });

  it('POST /billing/buy-campanha-messages retorna Pix (copia-e-cola + QR) para um pacote válido', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'x@x.com' });
    const res = await app.inject({
      method: 'POST', url: '/billing/buy-campanha-messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: 'pkg_camp_1k' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.messages).toBe(1000);
    expect(body.copyPaste).toBeTruthy();
    expect(body.qrCodeUrl).toContain('data:image/png;base64');
  });

  it('POST /billing/buy-campanha-messages rejeita pacote inválido', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'x@x.com' });
    const res = await app.inject({
      method: 'POST', url: '/billing/buy-campanha-messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: 'pkg_inexistente' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /billing/campanha-subscribe cria a assinatura mensal e retorna o Pix da 1ª cobrança', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'x@x.com' });
    const res = await app.inject({
      method: 'POST', url: '/billing/campanha-subscribe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('pending_pix');
    expect(body.subscriptionId).toBe('sub_camp_1');
  });

  it('POST /billing/campanha-subscribe rejeita quando já existe assinatura ativa', async () => {
    balances.set('u1', {
      id: 'bal_1', userId: 'u1', availableMessages: 0,
      freeMessages: 0, freeResetAt: null, paidMessages: 0, paidExpiresAt: null,
      plan: 'monthly', asaasSubscriptionId: 'sub_camp_1', asaasCustomerId: 'cus_1', renewalDate: new Date(),
    });
    const token = app.jwt.sign({ sub: 'u1', email: 'x@x.com' });
    const res = await app.inject({
      method: 'POST', url: '/billing/campanha-subscribe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('subscribeCorePlanViaPix (lead novo — assina Profissional/Empresas via Pix)', () => {
    it('cria a assinatura e devolve o Pix quando o usuário está no free', async () => {
      const result = await subscribeCorePlanViaPix('u1', 'profissional');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.subscriptionId).toBe('sub_camp_1');
        expect(result.data.copyPaste).toBeTruthy();
        expect(result.data.amount).toBe(49); // PLAN_PRICES.profissional
      }
      expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { asaasSubscriptionId: 'sub_camp_1' } }));
    });

    it('rejeita plano inválido', async () => {
      const result = await subscribeCorePlanViaPix('u1', 'inexistente' as any);
      expect(result.ok).toBe(false);
    });

    it('rejeita quando o e-mail não está verificado', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ email: 'x@x.com', name: 'Fulano', emailVerified: false });
      const result = await subscribeCorePlanViaPix('u1', 'profissional');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    });

    it('rejeita quando já existe assinatura paga ativa', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active', planId: 'profissional' });
      const result = await subscribeCorePlanViaPix('u1', 'empresas');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/já tem uma assinatura ativa/);
    });

    it('permite assinar quando a assinatura existente é do plano free', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active', planId: 'free' });
      const result = await subscribeCorePlanViaPix('u1', 'profissional');
      expect(result.ok).toBe(true);
    });
  });
});
