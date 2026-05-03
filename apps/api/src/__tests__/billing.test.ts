/**
 * Testes das rotas de billing — foco no webhook e no cancel.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    subscription:     { findUnique: jest.fn(), update: jest.fn() },
    minuteBalance:    { update: jest.fn() },
    plan:             { findUnique: jest.fn() },
    processedWebhook: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction:     jest.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));

// Mock de fetch global (usado para chamadas ao Asaas)
global.fetch = jest.fn();

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

function makeToken(app: any, userId = 'u1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

// ── Webhook Tests ──────────────────────────────────────────────────
describe('POST /billing/webhook', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  const validHeaders = { 'asaas-webhook-token': 'test-webhook-token' };

  beforeAll(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-token';
  });

  it('retorna 401 sem token de webhook', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/webhook', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('processa PAYMENT_CONFIRMED e atualiza plano', async () => {
    (prisma.processedWebhook.findUnique as jest.Mock).mockResolvedValueOnce(null); // não duplicado
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-pro', minutesPerMonth: 200 });
    (prisma.processedWebhook.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: validHeaders,
      payload: {
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay-001',
          externalReference: 'u1|pro',
          subscription: { id: 'sub-001', externalReference: 'u1|pro' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(prisma.plan.findUnique).toHaveBeenCalledWith({ where: { name: 'pro' } });
  });

  it('ignora webhook PAYMENT_CONFIRMED duplicado', async () => {
    (prisma.processedWebhook.findUnique as jest.Mock).mockResolvedValueOnce({ paymentId: 'pay-dup' });

    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: validHeaders,
      payload: {
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay-dup', externalReference: 'u1|pro' },
      },
    });
    expect(res.statusCode).toBe(200);
    // Plano NÃO deve ser buscado pois é duplicata
    expect(prisma.plan.findUnique).not.toHaveBeenCalled();
  });

  it('processa SUBSCRIPTION_DELETED e faz downgrade para free', async () => {
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-free', minutesPerMonth: 10 });
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: validHeaders,
      payload: {
        event: 'SUBSCRIPTION_DELETED',
        subscription: { externalReference: 'u1|pro' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.plan.findUnique).toHaveBeenCalledWith({ where: { name: 'free' } });
  });
});

// ── Cancel Tests ───────────────────────────────────────────────────
describe('POST /billing/cancel', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    process.env.ASAAS_API_KEY = 'test-key';
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 se usuário já está no plano free', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({
      plan: { name: 'free' },
      asaasSubscriptionId: null,
    });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cancelar|free|ativa/i);
  });

  it('cancela assinatura paga e faz downgrade para free', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({
      plan: { name: 'pro' },
      asaasSubscriptionId: 'sub-123',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true }); // DELETE Asaas
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-free', minutesPerMonth: 10 });
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().canceled).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
