/**
 * Testes do módulo Tarefas (tier Empresas) — foco no gate de entitlement
 * (compartilhado de time, via teamScope) e na validação de responsável
 * (só o dono ou um membro ATIVO do MESMO time pode ser atribuído).
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

jest.mock('../lib/prisma', () => ({
  prisma: {
    task:       { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    teamMember: { findUnique: jest.fn() },
    team:       { findUnique: jest.fn() },
    entitlement: { findMany: jest.fn() },
  },
}));

jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

import { prisma } from '../lib/prisma';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/modules/tarefas'), { prefix: '/tarefas' });
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'owner1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

/** Sem time (dono solo) — resolveTeamScope cai no caso padrão (ownerId=self, role=owner). */
function mockSoloOwner() {
  (prisma.teamMember.findUnique as jest.Mock).mockResolvedValueOnce(null);
}
function mockHasTarefas() {
  (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([{ productKey: 'tarefas' }]);
}

describe('Módulo Tarefas', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('402 quando o dono não tem o módulo tarefas (não é Empresas)', async () => {
    mockSoloOwner();
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]); // sem 'tarefas'

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/tarefas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(402);
  });

  it('cria tarefa sem responsável (dono agindo sozinho)', async () => {
    mockSoloOwner();
    mockHasTarefas();
    (prisma.task.create as jest.Mock).mockResolvedValueOnce({ id: 't1', title: 'Ligar pro cliente' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/tarefas',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Ligar pro cliente' },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'owner1', title: 'Ligar pro cliente' }),
    }));
  });

  it('retorna 400 ao atribuir pra alguém que não é membro do time do dono', async () => {
    mockSoloOwner();
    mockHasTarefas();
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'active', team: { ownerId: 'outro-dono' } });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/tarefas',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Tarefa', assignedToId: 'cestranho0000000000000001' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/membro ativo/i);
  });

  it('cria tarefa atribuída a um membro ativo do MESMO time', async () => {
    mockSoloOwner();
    mockHasTarefas();
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'active',
      team: { ownerId: 'owner1' },
      user: { id: 'cmembro00000000000000001', name: 'Membro', phone: '5511999999999' },
    });
    (prisma.task.create as jest.Mock).mockResolvedValueOnce({ id: 't2', title: 'Follow-up', assignedToId: 'cmembro00000000000000001' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/tarefas',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Follow-up', assignedToId: 'cmembro00000000000000001' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('marcar como done grava completedAt', async () => {
    mockSoloOwner();
    mockHasTarefas();
    (prisma.task.findFirst as jest.Mock).mockResolvedValueOnce({ id: 't1', userId: 'owner1', status: 'pending' });
    (prisma.task.update as jest.Mock).mockResolvedValueOnce({ id: 't1', status: 'done' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'PATCH', url: '/tarefas/t1',
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'done', completedAt: expect.any(Date) }),
    }));
  });

  it('404 ao tentar editar tarefa de outro dono', async () => {
    mockSoloOwner();
    mockHasTarefas();
    (prisma.task.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'PATCH', url: '/tarefas/t-de-outro',
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });
});
