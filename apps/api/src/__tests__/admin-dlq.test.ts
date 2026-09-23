process.env.ADMIN_TOKEN = 'token-de-teste-dlq';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

import Fastify from 'fastify';
import adminDlqRoutes from '../routes/admin-dlq';
import { prisma } from '../lib/prisma';

const add = jest.fn();
jest.mock('../services/queue', () => {
  const q = { add: (...a: any[]) => add(...a) };
  return {
    transcriptionQueue: q, campanhasQueue: q, mktfastQueue: q, atendeQueue: q,
    legendaQueue: q, copilotoQueue: q, zapscreveQueue: q, voiceCommandQueue: q,
    redis: {},
  };
});
// TOTP desligado nos testes — o foco aqui é a lógica do DLQ, não o 2FA
jest.mock('../lib/totp', () => ({ checkAdminTotp: jest.fn().mockResolvedValue('ok') }));

const AUTH = { 'x-admin-token': 'token-de-teste-dlq' };
let app: any;

beforeAll(async () => {
  app = Fastify();
  await app.register(adminDlqRoutes);
  await app.ready();
});
afterAll(async () => { await app?.close(); });
beforeEach(async () => { add.mockReset(); await prisma.failedJob.deleteMany({ where: { queue: { startsWith: 'test-' } } }); });
afterAll(async () => { await prisma.failedJob.deleteMany({ where: { queue: { startsWith: 'test-' } } }); });

const seed = (over: any = {}) => prisma.failedJob.create({
  data: {
    queue: 'test-transcriptions', jobName: 'transcribe-evolution', bullJobId: `b-${Math.random()}`,
    userId: 'u1', payload: { userId: 'u1', storageKey: 'k' }, errorMessage: 'falhou', attempts: 4, ...over,
  },
});

test('exige token de admin', async () => {
  const r = await app.inject({ method: 'GET', url: '/' });
  expect(r.statusCode).toBe(401);
});

test('lista com total e contagem de pendentes por fila', async () => {
  await seed(); await seed({ replayedAt: new Date() });
  const r = await app.inject({ method: 'GET', url: '/?queue=test-transcriptions', headers: AUTH });
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(body.total).toBe(2);
  expect(body.pendentesPorFila['test-transcriptions']).toBe(1);  // só o não-replayado
});

test('pending=true filtra os já replayados', async () => {
  await seed(); await seed({ replayedAt: new Date() });
  const body = (await app.inject({ method: 'GET', url: '/?queue=test-transcriptions&pending=true', headers: AUTH })).json();
  expect(body.total).toBe(1);
});

test('limit é limitado a 200 mesmo se pedirem mais', async () => {
  const body = (await app.inject({ method: 'GET', url: '/?limit=999999', headers: AUTH })).json();
  expect(body.limit).toBe(200);
});

test('replay de fila desconhecida responde 400', async () => {
  const j = await seed({ queue: 'test-fila-inexistente' });
  const r = await app.inject({ method: 'POST', url: `/${j.id}/replay`, headers: AUTH });
  expect(r.statusCode).toBe(400);
  expect(add).not.toHaveBeenCalled();
});

test('replay de payload truncado exige force e responde 409 sem ele', async () => {
  const j = await seed({ queue: 'transcriptions', payloadTrimmed: true });
  const r = await app.inject({ method: 'POST', url: `/${j.id}/replay`, headers: AUTH });
  expect(r.statusCode).toBe(409);
  expect(add).not.toHaveBeenCalled();
  await prisma.failedJob.delete({ where: { id: j.id } });
});

test('replay reenfileira com jobId novo e incrementa replayCount', async () => {
  const j = await seed({ queue: 'transcriptions' });
  const r = await app.inject({ method: 'POST', url: `/${j.id}/replay`, headers: AUTH });
  expect(r.statusCode).toBe(200);
  expect(add).toHaveBeenCalledTimes(1);

  const [name, payload, opts] = add.mock.calls[0];
  expect(name).toBe('transcribe-evolution');
  expect(payload).toEqual({ userId: 'u1', storageKey: 'k' });
  // jobId novo: reusar o original faria o BullMQ ignorar o add em silêncio
  expect(opts.jobId).toBe(`replay-${j.id}-1`);

  const after = await prisma.failedJob.findUnique({ where: { id: j.id } });
  expect(after!.replayCount).toBe(1);
  expect(after!.replayedAt).not.toBeNull();
  await prisma.failedJob.delete({ where: { id: j.id } });
});

test('404 ao replayar id inexistente', async () => {
  const r = await app.inject({ method: 'POST', url: '/nao-existe/replay', headers: AUTH });
  expect(r.statusCode).toBe(404);
});
