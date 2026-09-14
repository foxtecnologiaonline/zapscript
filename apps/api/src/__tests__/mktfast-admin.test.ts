/**
 * Testes de integração das rotas /mktfast/* (MKT-Fast — missões de divulgação).
 * Ver MKTFAST_ESCOPO.md.
 */
import Fastify from 'fastify';

// mktfast-admin.ts importa normalizePhone de routes/modules/campanhas.ts, que
// carrega services/encryption.ts no topo — precisa de uma chave válida (32 bytes
// hex) só pra passar do module-load, mesmo sem usar criptografia neste teste.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

jest.mock('../lib/prisma', () => ({
  prisma: {
    mission: {
      create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(), updateMany: jest.fn(),
    },
    missionExecution: {
      createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(), count: jest.fn().mockResolvedValue(0),
    },
    whatsappNumber: { findUnique: jest.fn() },
  },
}));

// totp.ts lê redis de services/queue — mockado pra não tentar conexão real.
// mktfastQueue.addBulk é usado por POST /:id/start.
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1), exists: jest.fn().mockResolvedValue(0) },
  mktfastQueue: { addBulk: jest.fn().mockResolvedValue([]) },
}));

import { prisma } from '../lib/prisma';
import { mktfastQueue } from '../services/queue';

const VALID_TOKEN = 'test-admin-token';
const numeroConectado = { id: 'wn1', status: 'connected', zapiInstanceId: 'zs-abc123' };

async function buildApp() {
  process.env.ADMIN_TOKEN = VALID_TOKEN;
  delete process.env.ADMIN_TOTP_SECRET;
  const app = Fastify({ logger: false });
  await app.register(import('../routes/mktfast-admin'), { prefix: '/mktfast' });
  await app.ready();
  return app;
}

function auth() {
  return { 'x-admin-token': VALID_TOKEN };
}

describe('POST /mktfast/missions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem token válido', async () => {
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions', headers: { 'x-admin-token': 'invalid' }, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 400 sem title/objective/createdBy', async () => {
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 se o canal "whatsapp" não tem content.targets', async () => {
    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions', headers: auth(),
      payload: { title: 'Missão', objective: 'Divulgar', createdBy: 'growth@zapscript.me', whatsappNumberId: 'wn1', content: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/targets/);
  });

  it('retorna 409 se o número informado não está conectado', async () => {
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'wn1', status: 'disconnected', zapiInstanceId: null });
    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions', headers: auth(),
      payload: {
        title: 'Missão', objective: 'Divulgar', createdBy: 'growth@zapscript.me', whatsappNumberId: 'wn1',
        content: { text: 'oi', targets: ['34999998888'] },
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('cria a missão e materializa execuções pros dois canais (whatsapp + human_share)', async () => {
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValue(numeroConectado);
    (prisma.mission.create as jest.Mock).mockResolvedValueOnce({ id: 'm1', status: 'draft' });

    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions', headers: auth(),
      payload: {
        title: 'Divulgar ZapScript.me', objective: 'Trazer testers', createdBy: 'growth@zapscript.me',
        channels: ['whatsapp', 'human_share'], whatsappNumberId: 'wn1',
        content: { text: 'mensagem', targets: ['34999998888'], humanBriefing: 'poste no story', humanTargets: ['34999997777'] },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.targetsCreated).toBe(1);
    expect(body.humanTargetsCreated).toBe(1);
    expect(prisma.missionExecution.createMany).toHaveBeenCalledWith({
      data: [
        { missionId: 'm1', channel: 'whatsapp', executor: 'bot', targetRef: '5534999998888' },
        { missionId: 'm1', channel: 'human_share', executor: 'human', targetRef: '5534999997777' },
      ],
      skipDuplicates: true,
    });
  });

  it('NÃO cria execução whatsapp se o canal "whatsapp" não foi declarado (mesmo com content.targets preenchido)', async () => {
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce(numeroConectado);
    (prisma.mission.create as jest.Mock).mockResolvedValueOnce({ id: 'm2', status: 'draft' });

    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions', headers: auth(),
      payload: {
        title: 'Só convocação', objective: 'Testar isolamento de canal', createdBy: 'growth@zapscript.me',
        channels: ['human_share'], whatsappNumberId: 'wn1',
        // targets deixado por engano (ex.: copiado de outra missão) — não deve gerar envio direto
        content: { humanBriefing: 'poste no story', humanTargets: ['34999997777'], targets: ['34999998888'] },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.targetsCreated).toBe(0);
    expect(body.humanTargetsCreated).toBe(1);
    expect(prisma.missionExecution.createMany).toHaveBeenCalledWith({
      data: [{ missionId: 'm2', channel: 'human_share', executor: 'human', targetRef: '5534999997777' }],
      skipDuplicates: true,
    });
  });

  it('retorna 400 pra canal sem adapter', async () => {
    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions', headers: auth(),
      payload: { title: 'Missão', objective: 'Divulgar', createdBy: 'growth@zapscript.me', channels: ['instagram_feed'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/instagram_feed/);
  });
});

describe('POST /mktfast/missions/:id/start', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se a missão não existe', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/start', headers: auth() });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 409 se a missão já está running/completed/canceled', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'm1', status: 'running', channels: ['whatsapp'] });
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/start', headers: auth() });
    expect(res.statusCode).toBe(409);
  });

  it('reclama a missão, enfileira as execuções pendentes e retorna started+queued', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'm1', status: 'draft', channels: ['whatsapp'], whatsappNumber: numeroConectado,
    });
    (prisma.mission.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.missionExecution.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'e1' }, { id: 'e2' }]);

    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/start', headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ started: true, queued: 2 });
    expect(mktfastQueue.addBulk).toHaveBeenCalledWith([
      { name: 'send', data: { missionId: 'm1', executionId: 'e1' }, opts: { jobId: 'm1:e1' } },
      { name: 'send', data: { missionId: 'm1', executionId: 'e2' }, opts: { jobId: 'm1:e2' } },
    ]);
  });

  it('marca a missão como completed direto se não há execuções pendentes', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'm1', status: 'draft', channels: ['whatsapp'], whatsappNumber: numeroConectado,
    });
    (prisma.mission.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.missionExecution.findMany as jest.Mock).mockResolvedValueOnce([]);

    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/start', headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ started: true, queued: 0 });
    expect(prisma.mission.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'm1', status: 'running' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });
});

describe('Fase 1 — proof/approve/reject', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('POST .../proof exige proofUrl', async () => {
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/executions/e1/proof', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('POST .../proof registra a prova quando a execução está pending/awaiting_proof', async () => {
    (prisma.missionExecution.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    const res = await app.inject({
      method: 'POST', url: '/mktfast/missions/m1/executions/e1/proof', headers: auth(),
      payload: { proofUrl: 'https://instagram.com/stories/x' },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.missionExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', missionId: 'm1', executor: 'human', status: { in: ['pending', 'awaiting_proof'] } },
      data: { status: 'proof_submitted', proofUrl: 'https://instagram.com/stories/x' },
    });
  });

  it('POST .../approve aprova com reachCount default 1 e tenta completar a missão', async () => {
    (prisma.missionExecution.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.missionExecution.count as jest.Mock).mockResolvedValueOnce(0);

    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/executions/e1/approve', headers: auth(), payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ approved: true, reachCount: 1 });
    expect(prisma.missionExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', missionId: 'm1', status: 'proof_submitted' },
      data: { status: 'approved', reachCount: 1, errorReason: null },
    });
    expect(prisma.mission.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'running' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });

  it('POST .../reject retorna 409 se não há prova pendente', async () => {
    (prisma.missionExecution.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    const res = await app.inject({ method: 'POST', url: '/mktfast/missions/m1/executions/e1/reject', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(409);
  });
});
