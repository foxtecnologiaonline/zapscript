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
    $transaction: jest.fn(async (fn: any) => fn({
      user:         { create: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', createdAt: new Date() }) },
      subscription: { create: jest.fn() },
      minuteBalance:{ create: jest.fn() },
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

  it('retorna 400 se consentimentos LGPD não forem aceitos', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'x@x.com', password: '12345678' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/aceite/i);
  });

  it('retorna 400 se e-mail já estiver cadastrado', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'dup@dup.com', password: '12345678', ...CONSENTS },
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
      payload: { email: 'new@new.com', password: 'strongpass', ...CONSENTS },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().emailVerified).toBe(false);
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
