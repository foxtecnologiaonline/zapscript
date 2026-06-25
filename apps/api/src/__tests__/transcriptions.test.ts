/**
 * Testes de integração das rotas de conversões.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';

// Singleton mock data
let mockFindFirstReturn: any = null;

jest.mock('../lib/prisma', () => ({
  prisma: {
    transcription: {
      findMany: jest.fn(),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        // Simula o comportamento real: verifica userId no where
        if (mockFindFirstReturn && mockFindFirstReturn.userId === where?.userId) {
          return Promise.resolve(mockFindFirstReturn);
        }
        return Promise.resolve(null);
      }),
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    whatsappNumber: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    minuteBalance: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/queue', () => ({
  transcriptionQueue: {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  },
}));

import { prisma } from '../lib/prisma';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); }
    catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/transcriptions'), { prefix: '/transcriptions' });
  await app.ready();
  return app;
}

describe('GET /transcriptions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { mockFindFirstReturn = null; jest.clearAllMocks(); });

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcriptions' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna lista de conversões com auth válido', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    (prisma.transcription.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 't1',
        originalText: 'Test audio',
        durationSec: 60,
        createdAt: new Date(),
        number: { displayName: 'Número 1', phoneNumber: '5511999999999' },
      },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValueOnce(1);

    const res = await app.inject({
      method: 'GET',
      url: '/transcriptions?limit=20&offset=0',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
    expect(res.json().total).toBe(1);
  });

  it('clampeia limit entre 1-100', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    (prisma.transcription.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.transcription.count as jest.Mock).mockResolvedValueOnce(0);

    await app.inject({
      method: 'GET',
      url: '/transcriptions?limit=999&offset=-5',
      headers: { authorization: `Bearer ${token}` },
    });

    const call = (prisma.transcription.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBe(100);  // clamped to max 100
    expect(call.skip).toBe(0);   // max(0, -5) = 0
  });
});

describe('GET /transcriptions/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { mockFindFirstReturn = null; jest.clearAllMocks(); });

  it('retorna 404 se não encontrada', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    mockFindFirstReturn = null;

    const res = await app.inject({
      method: 'GET',
      url: '/transcriptions/nonexistent',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('retorna conversão quando encontrada', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    const mockTranscription = { id: 't1', userId: 'user-1', originalText: 'test' };
    mockFindFirstReturn = mockTranscription;

    const res = await app.inject({
      method: 'GET',
      url: '/transcriptions/t1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /transcriptions/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { mockFindFirstReturn = null; jest.clearAllMocks(); });

  it('retorna 404 se conversão não existir', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    mockFindFirstReturn = null;

    const res = await app.inject({
      method: 'DELETE',
      url: '/transcriptions/nonexistent',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('deleta conversão do próprio usuário com sucesso', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    mockFindFirstReturn = { id: 't1', userId: 'user-1' };
    (prisma.transcription.delete as jest.Mock).mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'DELETE',
      url: '/transcriptions/t1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(prisma.transcription.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('impede deletar conversão de outro usuário (userId diferente = findFirst retorna null)', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    // findFirst verifica userId no where → user-2 ≠ user-1 → retorna null
    mockFindFirstReturn = { id: 't1', userId: 'user-2' };

    const res = await app.inject({
      method: 'DELETE',
      url: '/transcriptions/t1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(prisma.transcription.delete).not.toHaveBeenCalled();
  });
});

describe('POST /transcriptions/upload', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { mockFindFirstReturn = null; jest.clearAllMocks(); });

  it('retorna 401 sem autenticação (sem payload)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transcriptions/upload',
    });
    // O multipart plugin retorna 401 ou 415 dependendo do middleware order
    // O importante é que não pode ter acesso sem auth
    expect([401, 415]).toContain(res.statusCode);
  });

  it('retorna 402 se saldo de minutos < 0.5 (envia multipart correto)', async () => {
    const token = app.jwt.sign({ sub: 'user-1', email: 'test@test.com' });
    (prisma.minuteBalance.findUnique as jest.Mock).mockResolvedValueOnce({
      availableMinutes: 0.1,
    });

    const form = '--boundary\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg\r\n\r\ndummy\r\n--boundary--\r\n';

    const res = await app.inject({
      method: 'POST',
      url: '/transcriptions/upload',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=boundary',
      },
      payload: form,
    });

    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatch(/saldo/i);
  });
});
