/**
 * Testes do gate de módulos — foco em requireAnyModule (OR), usado pelo
 * ZapScript ZapScreve pra liberar acesso a quem já tem Atende OU Copiloto,
 * sem módulo/gate próprio no catálogo (ver ESCOPO_ZAPSCREVE.md §1/§10).
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

jest.mock('../lib/prisma', () => ({
  prisma: {
    entitlement: { findMany: jest.fn() },
    product:     { findMany: jest.fn() },
  },
}));

// Redis mockado — evita conexão real (lazyConnect + retry infinito travaria o teste)
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

import { prisma } from '../lib/prisma';
import { requireAnyModule } from '../lib/moduleGate';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  app.get('/protegido', {
    preHandler: [(app as any).authenticate, requireAnyModule(['atende', 'copiloto'])],
  }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'u1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

function mockOwnedModules(keys: string[]) {
  (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce(
    keys.map((productKey) => ({ productKey })),
  );
}

describe('requireAnyModule', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejeita sem token de autenticação', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/protegido' });
    expect(res.statusCode).toBe(401);
  });

  it('rejeita com 402 quando o usuário não tem nenhum dos módulos', async () => {
    const app = await buildApp();
    mockOwnedModules([]);
    const res = await app.inject({
      method: 'GET', url: '/protegido',
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().moduleRequired).toBe('atende');
  });

  it('libera quando o usuário só tem o primeiro módulo (atende)', async () => {
    const app = await buildApp();
    mockOwnedModules(['atende']);
    const res = await app.inject({
      method: 'GET', url: '/protegido',
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('libera quando o usuário só tem o segundo módulo (copiloto)', async () => {
    const app = await buildApp();
    mockOwnedModules(['copiloto']);
    const res = await app.inject({
      method: 'GET', url: '/protegido',
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('libera quando o usuário tem os dois módulos', async () => {
    const app = await buildApp();
    mockOwnedModules(['atende', 'copiloto']);
    const res = await app.inject({
      method: 'GET', url: '/protegido',
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('não libera com um módulo não relacionado (ex.: crm)', async () => {
    const app = await buildApp();
    mockOwnedModules(['crm']);
    const res = await app.inject({
      method: 'GET', url: '/protegido',
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });
    expect(res.statusCode).toBe(402);
  });
});
