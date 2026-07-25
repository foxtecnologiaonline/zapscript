/**
 * Testes da rota de histórico/auditoria do Comando de Voz Universal.
 * Cobre: autenticação obrigatória, escopo por usuário e limite de paginação.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

jest.mock('../lib/prisma', () => ({
  prisma: {
    voiceCommand: { findMany: jest.fn() },
  },
}));

import { prisma } from '../lib/prisma';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/voice-commands'), { prefix: '/voice-commands' });
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'u1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

let app: Awaited<ReturnType<typeof buildApp>>;
let authHeader: { authorization: string };

beforeAll(async () => {
  app = await buildApp();
  authHeader = { authorization: `Bearer ${makeToken(app, 'u1')}` };
});
afterAll(async () => { await app.close(); });
beforeEach(() => jest.clearAllMocks());

describe('GET /voice-commands', () => {
  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/voice-commands' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna o histórico do usuário autenticado, mais recente primeiro', async () => {
    (prisma.voiceCommand.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'vc2', intent: 'crm_query', status: 'executed', rawText: 'quantos leads', resultSummary: '📊 ...', confidence: 88, createdAt: new Date() },
      { id: 'vc1', intent: 'crm_create_lead', status: 'executed', rawText: 'cria um lead', resultSummary: '✅ ...', confidence: 92, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: 'GET', url: '/voice-commands', headers: authHeader });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(prisma.voiceCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }));
  });

  it('limita o parâmetro limit a no máximo 100', async () => {
    (prisma.voiceCommand.findMany as jest.Mock).mockResolvedValueOnce([]);

    await app.inject({ method: 'GET', url: '/voice-commands?limit=9999', headers: authHeader });

    expect(prisma.voiceCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('limit inválido cai no default 50', async () => {
    (prisma.voiceCommand.findMany as jest.Mock).mockResolvedValueOnce([]);

    await app.inject({ method: 'GET', url: '/voice-commands?limit=abc', headers: authHeader });

    expect(prisma.voiceCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});
