/**
 * Testes de integração das rotas /modules/campanhas/* — gate de módulo,
 * CRUD de campanhas, upload de contatos (CSV) e ciclo start/pause/cancel.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha:        { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    campanhaContato: { findMany: jest.fn(), groupBy: jest.fn(), createMany: jest.fn(), count: jest.fn() },
    campanhaOptOut:  { findMany: jest.fn() },
    whatsappNumber:  { findFirst: jest.fn(), findUnique: jest.fn() },
    entitlement:     { findMany: jest.fn() },
    product:         { findMany: jest.fn() },
  },
}));

// Redis mockado — moduleGate lê o cache de entitlements daqui (evita conexão real)
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
  campanhasQueue: { addBulk: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../services/encryption', () => ({
  decryptStr: jest.fn().mockReturnValue('decrypted-token'),
}));

jest.mock('../services/whatsapp-campaigns', () => ({
  listTemplates: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { redis, campanhasQueue } from '../services/queue';
import { listTemplates } from '../services/whatsapp-campaigns';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/modules/campanhas'), { prefix: '/modules/campanhas' });
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'u1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

/** Libera o gate de módulo simulando cache Redis já populado com ['campanhas']. */
function grantModuleAccess() {
  (redis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(['campanhas']));
}

const NUM_ID = 'ckv8z4x9q0000qzrmn831p0e';

describe('Gate de módulo (requireModule)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/campanhas' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 402 quando o usuário não contratou o módulo', async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]); // nenhum módulo ativo

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().moduleRequired).toBe('campanhas');
  });
});

describe('GET /modules/campanhas', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('lista campanhas do usuário com stats agrupadas por status', async () => {
    grantModuleAccess();
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'c1', name: 'Promo Verão', status: 'running', templateName: 'promo', audienceCount: 10, sentCount: 4, createdAt: new Date() },
    ]);
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValueOnce([
      { campanhaId: 'c1', status: 'sent', _count: 4 },
      { campanhaId: 'c1', status: 'pending', _count: 6 },
    ]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().campanhas[0].stats).toEqual({ sent: 4, pending: 6 });
  });

  it('retorna lista vazia sem consultar groupBy quando não há campanhas', async () => {
    grantModuleAccess();
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ campanhas: [] });
    expect(prisma.campanhaContato.groupBy).not.toHaveBeenCalled();
  });
});

describe('GET /modules/campanhas/templates', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 quando não há número Meta conectado', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/templates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna só os templates APPROVED do WABA conectado', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'num1', metaAccessTokenEnc: 'enc', metaWabaId: 'waba1',
    });
    (listTemplates as jest.Mock).mockResolvedValueOnce([
      { id: 't1', name: 'promo', status: 'APPROVED' },
      { id: 't2', name: 'rascunho', status: 'PENDING' },
    ]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/templates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toEqual([{ id: 't1', name: 'promo', status: 'APPROVED' }]);
  });

  it('retorna 502 quando a Graph API falha', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'num1', metaAccessTokenEnc: 'enc', metaWabaId: 'waba1',
    });
    (listTemplates as jest.Mock).mockRejectedValueOnce(new Error('Falha ao listar templates da Meta: timeout'));

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/templates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(502);
  });
});

describe('POST /modules/campanhas', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 em payload inválido (nome curto)', async () => {
    grantModuleAccess();
    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'a', whatsappNumberId: NUM_ID, templateName: 'promo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando o número não pertence ao usuário ou não é Meta', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Promo Verão', whatsappNumberId: NUM_ID, templateName: 'promo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/número meta/i);
  });

  it('cria campanha em rascunho', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce({ id: NUM_ID, provider: 'meta' });
    (prisma.campanha.create as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Promo Verão', whatsappNumberId: NUM_ID, templateName: 'promo' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().campanha.status).toBe('draft');
  });
});

describe('GET/DELETE /modules/campanhas/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('GET retorna 404 se a campanha não existe ou não pertence ao usuário', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/c1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE retorna 400 se a campanha não está em rascunho', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'running' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'DELETE', url: '/modules/campanhas/c1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.campanha.delete).not.toHaveBeenCalled();
  });

  it('DELETE remove campanha em rascunho', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });
    (prisma.campanha.delete as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'DELETE', url: '/modules/campanhas/c1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.campanha.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});

describe('POST /modules/campanhas/:id/contatos (upload CSV)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  function csvForm(csv: string) {
    return `--boundary\r\nContent-Disposition: form-data; name="file"; filename="contatos.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--boundary--\r\n`;
  }

  it('retorna 404 se a campanha não existe', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvForm('5511999999999,João'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 se a campanha não está em rascunho', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'running' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvForm('5511999999999,João'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('importa contatos válidos, pulando optout/inválido/duplicado', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([{ phone: '5511911111111' }]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ phone: '5511922222222' }]);
    (prisma.campanhaContato.createMany as jest.Mock).mockResolvedValueOnce({ count: 2 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const csv = [
      'telefone,nome',
      '11999999999,Ana',        // válido, novo → importado
      '11911111111,Bruno',      // optout → pulado
      '11922222222,Carla',      // já existe na campanha → pulado
      '11999999999,Ana Dup',    // duplicado dentro do próprio CSV → pulado
      'abc,Inválido',           // telefone inválido → pulado
      '11988888888,Duda',       // válido, novo → importado
    ].join('\n');

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvForm(csv),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, skippedOptOut: 1, skippedInvalid: 1, skippedDuplicate: 2 });
    expect(prisma.campanhaContato.createMany).toHaveBeenCalledWith({
      data: [
        { campanhaId: 'c1', phone: '5511999999999', name: 'Ana', variables: undefined },
        { campanhaId: 'c1', phone: '5511988888888', name: 'Duda', variables: undefined },
      ],
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { audienceCount: { increment: 2 } } });
  });

  it('retorna 400 quando nenhum contato válido é encontrado', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvForm('telefone,nome\nabc,Inválido'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(0);
    expect(prisma.campanhaContato.createMany).not.toHaveBeenCalled();
  });
});

describe('Ciclo start/pause/cancel', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  describe('POST /:id/start', () => {
    it('retorna 400 se o status não permite iniciar', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'completed' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 se a campanha não tem audiência', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 0 });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 se o número Meta está desconectado', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'disconnected' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('enfileira os contatos pendentes com jobId determinístico', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 2, whatsappNumberId: NUM_ID, startedAt: null });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', metaAccessTokenEnc: 'enc' });
      (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }, { id: 'ct2' }]);
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, enqueued: 2 });
      expect(campanhasQueue.addBulk).toHaveBeenCalledWith([
        { name: 'send', data: { campanhaId: 'c1', contatoId: 'ct1' }, opts: { jobId: 'c1:ct1' } },
        { name: 'send', data: { campanhaId: 'c1', contatoId: 'ct2' }, opts: { jobId: 'c1:ct2' } },
      ]);
      expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'running', startedAt: expect.any(Date) } });
    });
  });

  describe('POST /:id/pause', () => {
    it('só permite pausar campanha em execução', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/pause',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('pausa campanha em execução', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'running' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/pause',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'paused' } });
    });
  });

  describe('POST /:id/cancel', () => {
    it('retorna 400 se a campanha já está finalizada', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'completed' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/cancel',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('cancela campanha em execução', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'running' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/cancel',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'canceled', completedAt: expect.any(Date) } });
    });
  });
});
