/**
 * Testes de integração das rotas de autenticação.
 * Mockamos Supabase e Prisma para evitar dependências externas.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// ── Mocks ─────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    user:         { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    subscription: { create: jest.fn() },
    minuteBalance:{ create: jest.fn() },
    plan:         { findUnique: jest.fn() },
    auditLog:     { create: jest.fn() },
    // login e cadastro passaram a emitir refresh token rotativo
    // (lib/refreshToken.ts) — sem este mock as duas rotas dão 500.
    refreshToken: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $transaction: jest.fn(async (fn: any) => fn({
      user:            { create: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', createdAt: new Date() }) },
      subscription:    { create: jest.fn() },
      minuteBalance:   { create: jest.fn(), update: jest.fn() },
      testerInvite:    { update: jest.fn() },
      affiliateReferral: { create: jest.fn() },
      // POST /auth/register cria o número WhatsApp do próprio usuário dentro da
      // mesma transação (ver routes/auth.ts) — sem esse mock, `numberId` nunca é
      // setado e o teste de cadastro bem-sucedido cai no catch de rollback.
      whatsappNumber:  { create: jest.fn().mockResolvedValue({ id: 'num-1' }) },
    })),
  },
}));

// Mock Supabase com singleton para garantir mesmo objeto
const mockSupabaseClient = {
  auth: {
    admin: {
      createUser:     jest.fn(),
      generateLink:   jest.fn().mockResolvedValue({ data: {} }),
      updateUserById: jest.fn().mockResolvedValue({ error: null }),
      // Rollback de conta órfã se a transação Prisma falhar (ver routes/auth.ts) —
      // sem mock, uma falha de transação vira TypeError não tratado em vez do 500
      // esperado.
      deleteUser:     jest.fn().mockResolvedValue({ error: null }),
    },
    signInWithPassword: jest.fn(),
    getUser:           jest.fn(),
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}) }),
}));

// Onboarding pós-cadastro (provisionamento de número + pairing code) faz
// chamadas HTTP reais à Evolution API — mockar pra manter o teste hermético
// e determinístico (sem depender de rede).
jest.mock('../services/number-provisioning', () => ({
  provisionInstance:  jest.fn().mockResolvedValue({ ok: true }),
  requestPairingCode: jest.fn().mockResolvedValue({ ok: true, code: '123-456' }),
  requestPairingCodeWithRetry: jest.fn().mockResolvedValue({ ok: true, code: '123-456' }),
  buildWebhookUrl:    jest.fn().mockReturnValue('https://api.zapscript.me/webhook'),
}));
jest.mock('../services/onboarding-whatsapp', () => ({
  startFromSiteSignup: jest.fn().mockResolvedValue(undefined),
}));

// ── Setup ──────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';

const supabaseMock = mockSupabaseClient;

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/auth'), { prefix: '/auth' });
  await app.ready();
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 se email estiver faltando', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { password: '12345678' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email/i);
  });

  it('retorna 400 se password estiver faltando', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'x@x.com' } });
    expect(res.statusCode).toBe(400);
  });

  const CONSENTS = { cbTos: true, cbContrato: true, cbLgpd: true };
  // registerSchema exige phone (DDD + número, 10-11 dígitos) — ver lib/validation.ts.
  const VALID_PHONE = '11987654321';

  it('retorna 400 se consentimentos LGPD não forem aceitos', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'x@x.com', password: '12345678', phone: VALID_PHONE },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/aceite/i);
  });

  it('retorna 400 se e-mail já estiver cadastrado', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'dup@dup.com', password: '12345678', phone: VALID_PHONE, ...CONSENTS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cadastrado/i);
  });

  it('retorna 201 em cadastro bem-sucedido', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.plan.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'plan1', minutesPerMonth: 10 });
    supabaseMock.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'u-new' } },
      error: null,
    });

    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'new@new.com', password: 'strongpass', phone: VALID_PHONE, ...CONSENTS },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().emailVerified).toBe(false);
    // sessão longa agora vem do refresh token, não de um JWT de 30d
    expect(res.json()).toHaveProperty('refreshToken');
    expect(res.json()).toHaveProperty('refreshTokenExpiresAt');
  });
});

describe('POST /auth/login', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 se credenciais forem inválidas', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid credentials' },
    });
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'x@x.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('permite login mesmo com e-mail não verificado (Opção A — verificação só é exigida no checkout)', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@x.com', email_confirmed_at: null } },
      error: null,
    });
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'x@x.com', password: 'pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('token');
  });

  it('retorna token em login bem-sucedido', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@x.com', email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    (prisma.user.update as jest.Mock).mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'x@x.com', password: 'pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('token');
    expect(res.json()).toHaveProperty('refreshToken');
  });
});

describe('POST /auth/forgot-password', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('retorna 400 se email não for enviado', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('sempre retorna 200 mesmo para e-mail inexistente (evita enumeração)', async () => {
    supabaseMock.auth.admin.generateLink.mockResolvedValueOnce({ data: {} });
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password',
      payload: { email: 'nonexistent@x.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/instruções/i);
  });
});

describe('POST /auth/reset-password', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { (prisma.refreshToken.updateMany as jest.Mock).mockClear(); });

  test('redefinir senha ENCERRA todas as sessões abertas', async () => {
    // O motivo canônico de redefinir senha é suspeita de invasão. Sem revogar,
    // o refresh token que o invasor já tenha continuaria valendo 30 dias —
    // exatamente o que a troca de senha deveria cortar.
    mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'u-reset' } }, error: null,
    });
    mockSupabaseClient.auth.admin.updateUserById.mockResolvedValueOnce({ error: null });

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { access_token: 'tok', new_password: 'novasenha123' },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u-reset', revokedAt: null }),
      }),
    );
  });

  test('senha NÃO alterada (erro do provider) não revoga sessão nenhuma', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'u-reset' } }, error: null,
    });
    mockSupabaseClient.auth.admin.updateUserById.mockResolvedValueOnce({ error: { message: 'falhou' } });

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { access_token: 'tok', new_password: 'novasenha123' },
    });

    expect(res.statusCode).toBe(400);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
