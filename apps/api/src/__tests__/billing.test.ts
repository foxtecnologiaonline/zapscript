/**
 * Testes das rotas de billing — foco no webhook e no cancel.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    subscription:     { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    minuteBalance:    { update: jest.fn(), upsert: jest.fn() },
    plan:             { findUnique: jest.fn() },
    user:             { findUnique: jest.fn() },
    entitlement:      { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    product:          { findUnique: jest.fn(), findMany: jest.fn() },
    processedWebhook: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction:     jest.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));

// Redis mockado — evita conexão real (lazyConnect + retry infinito travaria o teste)
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
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

  const validHeaders = { 'asaas-access-token': 'test-webhook-token' };

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
    // subInDb (rota) + existingSub (dentro de activatePlan) — duas chamadas em sequência
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

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

// ── Module Subscribe Tests ───────────────────────────────────────────
const baseUser = {
  id: 'u1', email: 'x@x.com', name: 'Test User',
  emailVerified: true, document: '12345678900', phone: '11999999999',
};
const productAtende = {
  key: 'atende', name: 'Atende', status: 'live', dependsOn: [] as string[], priceMonthly: 29.90,
};

describe('POST /billing/modules/:key/subscribe', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    process.env.ASAAS_API_KEY = 'test-key';
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 se o módulo já está ativo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/já tem/i);
  });

  it('retorna 400 se falta módulo dependente', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
      key: 'atende-qualidade', name: 'Atende Qualidade', status: 'live', dependsOn: ['atende'], priceMonthly: 19.90,
    });
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]); // nenhum módulo possuído

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende-qualidade/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().moduleRequired).toBe('atende');
  });

  it('ativa módulo na hora quando pago no cartão', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)   // sub (rota)
      .mockResolvedValueOnce(null);  // sub (computeAggregateValue — sem plano pago)
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]); // sem outros módulos pagos
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-free' });
    (prisma.subscription.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.entitlement.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.processedWebhook.upsert as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [] }) })                       // busca customer (não existe)
      .mockResolvedValueOnce({ json: async () => ({ id: 'cus_1' }) })                     // cria customer
      .mockResolvedValueOnce({ json: async () => ({ id: 'pay_1', status: 'CONFIRMED' }) }) // cobrança aprovada
      .mockResolvedValueOnce({ json: async () => ({ id: 'sub_new' }) });                  // nova assinatura agregada

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        paymentMethod: 'credit_card',
        card: { holderName: 'Test User', number: '4111111111111111', expiryMonth: '12', expiryYear: '30', ccv: '123' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({ status: 'active', moduleKey: 'atende', newTotal: 29.9 }));
    expect(prisma.entitlement.upsert).toHaveBeenCalled();
  });

  it('retorna pending_pix quando pago via PIX', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-free' });
    (prisma.entitlement.upsert as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'cus_1' }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'pay_pix_1', status: 'PENDING' }) })
      .mockResolvedValueOnce({ json: async () => ({ payload: 'copiaecola123', encodedImage: 'aW1n' }) });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending_pix');
    expect(res.json().qrCode).toBe('copiaecola123');
    expect(prisma.entitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'pending' }) })
    );
  });
});

// ── Module Cancel Tests ──────────────────────────────────────────────
describe('POST /billing/modules/:key/cancel', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    process.env.ASAAS_API_KEY = 'test-key';
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 se o módulo não está ativo', async () => {
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/cancel',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/não tem/i);
  });

  it('cancela módulo e encerra assinatura quando não sobra nada a cobrar', async () => {
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active', source: 'paid' });
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce({ asaasSubscriptionId: 'sub_old', asaasCustomerId: 'cus_1' }) // rota
      .mockResolvedValueOnce(null); // computeAggregateValue — sem plano pago
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([{ productKey: 'atende' }]);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([{ priceMonthly: 29.90 }]);
    (prisma.subscription.update as jest.Mock).mockResolvedValueOnce({});
    (prisma.entitlement.update as jest.Mock).mockResolvedValueOnce({});
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true }); // DELETE assinatura

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/cancel',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ canceled: true, moduleKey: 'atende', newTotal: 0 });
    expect(prisma.subscription.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { asaasSubscriptionId: null } });
  });

  it('cancela módulo e reemite assinatura com valor reduzido', async () => {
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active', source: 'paid' });
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce({ asaasSubscriptionId: 'sub_old', asaasCustomerId: 'cus_1', paymentMethod: 'pix' }) // rota
      .mockResolvedValueOnce({ plan: { name: 'pro', priceBrl: 39.90 } }); // computeAggregateValue — plano pro ativo
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(productAtende);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([{ productKey: 'atende' }]);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([{ priceMonthly: 29.90 }]);
    (prisma.subscription.update as jest.Mock).mockResolvedValueOnce({});
    (prisma.entitlement.update as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ id: 'sub_new' }) }) // nova assinatura agregada
      .mockResolvedValueOnce({ ok: true });                              // DELETE assinatura antiga

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/modules/atende/cancel',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ canceled: true, moduleKey: 'atende', newTotal: 39.9 });
    expect(prisma.subscription.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { asaasSubscriptionId: 'sub_new' } });
  });
});

// ── Combo Preview Tests ──────────────────────────────────────────────
describe('GET /billing/combo/preview', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna available=false quando já tem o core pago e todos os módulos', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({ plan: { name: 'pro' } });
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/billing/combo/preview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, reason: 'complete' });
  });

  it('retorna prévia com desconto quando há módulos disponíveis', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/billing/combo/preview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      available:     true,
      corePlanName:  'pro',
      corePlanLabel: 'Pro',
      modules:       [{ key: 'atende', name: 'Atende', priceMonthly: 29.9 }],
      discountPct:   0.2,
      rawTotal:      66.9,
      newTotal:      53.52,
    });
  });
});

// ── Combo Subscribe Tests ─────────────────────────────────────────────
describe('POST /billing/combo/subscribe', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    process.env.ASAAS_API_KEY = 'test-key';
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 quando o combo já está completo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({ plan: { name: 'pro' } });
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/combo completo/i);
  });

  it('retorna 403 quando o e-mail não está verificado', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseUser, emailVerified: false });
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('retorna 400 quando falta CPF/CNPJ', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseUser, document: null });
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DOCUMENT_REQUIRED');
  });

  it('ativa o Combo na hora quando pago no cartão (sem desconto duplicado)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)   // top-level (Promise.all)
      .mockResolvedValueOnce(null)   // computeAggregateValue
      .mockResolvedValueOnce(null);  // activatePlan (select currentPeriodEnd)
    (prisma.product.findMany as jest.Mock)
      .mockResolvedValueOnce([productAtende])   // resolveComboModules (rota)
      .mockResolvedValueOnce([productAtende]);  // resolveComboModules (dentro de activateCombo)
    (prisma.entitlement.findMany as jest.Mock)
      .mockResolvedValueOnce([])   // resolveComboModules (rota)
      .mockResolvedValueOnce([])   // computeAggregateValue
      .mockResolvedValueOnce([]);  // resolveComboModules (dentro de activateCombo)
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-pro', priceBrl: 37, minutesPerMonth: 999999 });
    (prisma.subscription.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.minuteBalance.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.entitlement.upsert as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [{ id: 'cus_1' }] }) })            // getOrCreateCustomer (já existe)
      .mockResolvedValueOnce({ json: async () => ({ id: 'pay_1', status: 'CONFIRMED' }) })   // cobrança aprovada
      .mockResolvedValueOnce({ json: async () => ({ id: 'sub_new' }) });                     // reissueAggregateSubscription

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        paymentMethod: 'credit_card',
        card: { holderName: 'Test User', number: '4111111111111111', expiryMonth: '12', expiryYear: '30', ccv: '123' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      status: 'active', corePlanName: 'pro', newTotal: 53.52, discountPct: 0.2, modulesActivated: ['atende'],
    }));
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ comboDiscountPct: 0.2 }),
    }));
    expect(prisma.entitlement.upsert).toHaveBeenCalled();
  });

  it('retorna 402 quando o cartão é recusado', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [{ id: 'cus_1' }] }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'pay_declined', status: 'PENDING', errors: [{ description: 'Cartão recusado pela operadora.' }] }) });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        paymentMethod: 'credit_card',
        card: { holderName: 'Test User', number: '4111111111111111', expiryMonth: '12', expiryYear: '30', ccv: '123' },
      },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().status).toBe('declined');
    expect(res.json().error).toMatch(/recusado/i);
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('retorna pending_pix e ativa módulos como pendentes quando pago via PIX', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.entitlement.upsert as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [{ id: 'cus_1' }] }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'pay_pix_1', status: 'PENDING' }) })
      .mockResolvedValueOnce({ json: async () => ({ payload: 'comboPix123', encodedImage: 'aW1n' }) });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending_pix');
    expect(res.json().qrCode).toBe('comboPix123');
    expect(res.json().modulesPending).toEqual(['atende']);
    expect(prisma.entitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'pending' }) })
    );
  });

  it('ativa o Combo sem custo adicional quando o ciclo atual já está no fim', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const subShape = {
      plan: { name: 'pro', priceBrl: 37 },
      currentPeriodEnd: yesterday,
      asaasSubscriptionId: 'sub_old',
      asaasCustomerId: 'cus_1',
      paymentMethod: 'pix',
    };
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(subShape)                          // top-level
      .mockResolvedValueOnce(subShape)                          // computeAggregateValue
      .mockResolvedValueOnce({ currentPeriodEnd: yesterday });  // activatePlan (select)
    (prisma.product.findMany as jest.Mock)
      .mockResolvedValueOnce([productAtende])
      .mockResolvedValueOnce([productAtende]);
    (prisma.entitlement.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan-pro', priceBrl: 37, minutesPerMonth: 999999 });
    (prisma.subscription.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.minuteBalance.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.entitlement.upsert as jest.Mock).mockResolvedValueOnce({});

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ data: [{ id: 'cus_1' }] }) })  // getOrCreateCustomer
      .mockResolvedValueOnce({ json: async () => ({ id: 'sub_new' }) })           // reissue: cria nova assinatura
      .mockResolvedValueOnce({ ok: true });                                       // reissue: apaga a antiga

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/combo/subscribe',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      status: 'active', corePlanName: 'pro', newTotal: 53.52, discountPct: 0.2,
      modulesActivated: ['atende'], message: 'Combo ativado sem custo adicional.',
    }));
  });
});
