/**
 * Testes de compliance LGPD — rotas de privacidade.
 * Verifica Art. 18 (exclusão), Art. 20 (exportação), consentimento e documentos legais.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// ── Mocks ──────────────────────────────────────────────────────────

const mockTxUser          = { update:     jest.fn().mockResolvedValue({}) };
const mockTxTranscription = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
const mockTxSupportTicket = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
const mockTxAuditLog      = { create:     jest.fn().mockResolvedValue({}) };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user:          { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    transcription: {
      findMany:  jest.fn().mockResolvedValue([]),
      updateMany:jest.fn(),
      count:     jest.fn().mockResolvedValue(0),
    },
    supportTicket: {
      findMany:  jest.fn().mockResolvedValue([]),
      updateMany:jest.fn(),
      count:     jest.fn().mockResolvedValue(0),
    },
    whatsappNumber: { findMany: jest.fn().mockResolvedValue([]) },
    subscription:   { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    minuteBalance:  { findUnique: jest.fn().mockResolvedValue(null) },
    auditLog:       { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    privacyPolicy:  { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      user:          mockTxUser,
      transcription: mockTxTranscription,
      supportTicket: mockTxSupportTicket,
      auditLog:      mockTxAuditLog,
    })),
  },
}));

// Mock Supabase
const mockDeleteUser = jest.fn().mockResolvedValue({ error: null });
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { admin: { deleteUser: mockDeleteUser } },
  })),
}));

import { prisma } from '../lib/prisma';

// ── App builder ────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); }
    catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/privacy'), { prefix: '/privacy' });
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'user-lgpd') {
  return app.jwt.sign({ sub: userId, email: 'lgpd@test.com' });
}

// ── DELETE /privacy/account ────────────────────────────────────────
describe('DELETE /privacy/account — LGPD Art. 18 (right to deletion)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/privacy/account' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 202 e inicia soft delete com anonimização', async () => {
    const token = makeToken(app);
    const res = await app.inject({
      method: 'DELETE',
      url: '/privacy/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('deletion_scheduled');
    expect(body.dataRetention).toBe('30 days');
  });

  it('executa transação atômica de anonimização', async () => {
    const token = makeToken(app);
    await app.inject({
      method: 'DELETE',
      url: '/privacy/account',
      headers: { authorization: `Bearer ${token}` },
    });

    // $transaction deve ter sido chamado
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Dentro da transação: user update com campos LGPD
    expect(mockTxUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          pseudonymizedAt: expect.any(Date),
          name: 'Usuário deletado',
        }),
      })
    );
    // Conversões anonimizadas
    expect(mockTxTranscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ originalText: '[ANONIMIZADO]' }),
      })
    );
    // Audit trail registrado
    expect(mockTxAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'user.deleted' }),
      })
    );
  });

  it('chama Supabase deleteUser para remover autenticação', async () => {
    const token = makeToken(app);
    await app.inject({
      method: 'DELETE',
      url: '/privacy/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mockDeleteUser).toHaveBeenCalledWith('user-lgpd');
  });
});

// ── GET /privacy/export ────────────────────────────────────────────
describe('GET /privacy/export — LGPD Art. 20 (right to data portability)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/privacy/export' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna JSON com todos os dados do usuário', async () => {
    const token = makeToken(app);
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-lgpd',
      email: 'lgpd@test.com',
      name: 'Usuário LGPD',
      document: '123.456.789-00',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/privacy/export',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('exportedAt');
    expect(body).toHaveProperty('expiresAt');
    expect(body).toHaveProperty('user');
    expect(body).toHaveProperty('transcriptions');
    expect(body).toHaveProperty('whatsappNumbers');
    expect(body.user.email).toBe('lgpd@test.com');
    expect(body.user.id).toBe('user-lgpd');
  });

  it('exportação tem prazo de expiração de 7 dias', async () => {
    const token = makeToken(app);
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-lgpd', email: 'lgpd@test.com', name: 'Test',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET', url: '/privacy/export',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    const exported = new Date(body.exportedAt).getTime();
    const expires  = new Date(body.expiresAt).getTime();
    const diffDays = (expires - exported) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });
});

// ── POST /privacy/accept-terms ─────────────────────────────────────
describe('POST /privacy/accept-terms — consentimento LGPD', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/privacy/accept-terms' });
    expect(res.statusCode).toBe(401);
  });

  it('registra consentimento e salva timestamp', async () => {
    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/accept-terms',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { policyVersion: '1.0', termsVersion: '1.0' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body).toHaveProperty('acceptedAt');
  });

  it('salva privacyPolicyAcceptedAt e termsAcceptedAt no banco', async () => {
    const token = makeToken(app);
    await app.inject({
      method: 'POST',
      url: '/privacy/accept-terms',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { policyVersion: '1.0', termsVersion: '1.0' },
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          privacyPolicyAcceptedAt: expect.any(Date),
          termsAcceptedAt: expect.any(Date),
        }),
      })
    );
  });

  it('registra audit trail com versão aceita', async () => {
    const token = makeToken(app);
    await app.inject({
      method: 'POST',
      url: '/privacy/accept-terms',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { policyVersion: '2.0', termsVersion: '2.0' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'user.terms_accepted',
          changes: expect.objectContaining({ policyVersion: '2.0', termsVersion: '2.0' }),
        }),
      })
    );
  });
});

// ── GET /privacy/legal/privacy-policy ─────────────────────────────
describe('GET /privacy/legal/privacy-policy — documento público', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se nenhuma política cadastrada', async () => {
    (prisma.privacyPolicy.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/privacy/legal/privacy-policy' });
    expect(res.statusCode).toBe(404);
  });

  it('retorna política com version e content', async () => {
    (prisma.privacyPolicy.findFirst as jest.Mock).mockResolvedValueOnce({
      version: '1.0',
      content: 'Esta política rege o uso dos seus dados...',
      createdAt: new Date('2026-05-01'),
    });

    const res = await app.inject({ method: 'GET', url: '/privacy/legal/privacy-policy' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe('1.0');
    expect(body.content).toContain('dados');
    expect(body).toHaveProperty('effectiveFrom');
  });

  it('aceita query param ?version=1.0', async () => {
    (prisma.privacyPolicy.findFirst as jest.Mock).mockResolvedValueOnce({
      version: '1.0',
      content: 'Conteúdo v1.0',
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/privacy/legal/privacy-policy?version=1.0',
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.privacyPolicy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: '1.0' } })
    );
  });
});

// ── GET /privacy/legal/terms-of-service ───────────────────────────
describe('GET /privacy/legal/terms-of-service — documento público', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('retorna termos de serviço sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/privacy/legal/terms-of-service' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('content');
    expect(body).toHaveProperty('effectiveFrom');
    expect(body.content).toContain('ZapScript');
  });
});
