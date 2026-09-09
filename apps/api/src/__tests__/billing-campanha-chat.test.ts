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

const balances = new Map<string, { id: string; userId: string; availableMessages: number; plan: string | null; asaasSubscriptionId: string | null; asaasCustomerId: string | null; renewalDate: Date | null }>();
let nextId = 1;

function balanceFor(userId: string) {
  let b = balances.get(userId);
  if (!b) {
    b = { id: `bal_${nextId++}`, userId, availableMessages: 0, plan: null, asaasSubscriptionId: null, asaasCustomerId: null, renewalDate: null };
    balances.set(userId, b);
  }
  return b;
}

jest.mock('../lib/prisma', () => ({
  prisma: {
    subscription:               { findUnique: jest.fn().mockResolvedValue(null) },
    processedWebhook:           { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    user:                       { findUnique: jest.fn().mockResolvedValue({ email: 'x@x.com', name: 'Fulano' }) },
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
        if (data.availableMessages?.increment !== undefined) b.availableMessages += data.availableMessages.increment;
        for (const k of ['plan', 'asaasSubscriptionId', 'asaasCustomerId', 'renewalDate']) {
          if (k in data) (b as any)[k] = data[k];
        }
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
  beforeEach(() => { balances.clear(); nextId = 1; jest.clearAllMocks(); (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'x@x.com', name: 'Fulano' }); });

  it('GET /billing/campanha-packages lista pacotes e o plano mensal', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/campanha-packages' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.packages.some((p: any) => p.id === 'pkg_camp_1k')).toBe(true);
    expect(body.monthly.messages).toBeGreaterThan(0);
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

  it('webhook PAYMENT_CONFIRMED da assinatura mensal credita a cota e marca o plano', async () => {
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
    expect(b.availableMessages).toBe(2000);
    expect(b.plan).toBe('monthly');
    expect(b.renewalDate).not.toBeNull();
  });

  it('webhook SUBSCRIPTION_DELETED da assinatura de campanhas limpa só o CampanhaBalance (não mexe no plano core)', async () => {
    balances.set('u1', { id: 'bal_1', userId: 'u1', availableMessages: 500, plan: 'monthly', asaasSubscriptionId: 'sub_camp_1', asaasCustomerId: 'cus_1', renewalDate: new Date() });
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
    balances.set('u1', { id: 'bal_1', userId: 'u1', availableMessages: 0, plan: 'monthly', asaasSubscriptionId: 'sub_camp_1', asaasCustomerId: 'cus_1', renewalDate: new Date() });
    const token = app.jwt.sign({ sub: 'u1', email: 'x@x.com' });
    const res = await app.inject({
      method: 'POST', url: '/billing/campanha-subscribe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
