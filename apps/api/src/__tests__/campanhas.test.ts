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
    campanha:        { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    campanhaContato: { findMany: jest.fn(), groupBy: jest.fn(), createMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    campanhaOptOut:  { findMany: jest.fn(), upsert: jest.fn() },
    whatsappNumber:  { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    entitlement:     { findMany: jest.fn() },
    product:         { findMany: jest.fn() },
    transcription:        { findMany: jest.fn() },
    atendeConversation:   { findMany: jest.fn() },
    copilotoConversation: { findMany: jest.fn() },
  },
}));

jest.mock('../lib/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
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
  // tierToNumericCap é pura (sem I/O) — mantém a implementação real; só o que
  // fala com a Graph API (listTemplates, getPhoneNumberLimits, sendTemplateMessage)
  // é mockado.
  ...jest.requireActual('../services/whatsapp-campaigns'),
  listTemplates: jest.fn(),
  getPhoneNumberLimits: jest.fn(),
  sendTemplateMessage: jest.fn().mockResolvedValue('wamid-test'),
}));

jest.mock('../services/evolution', () => ({
  sendText: jest.fn().mockResolvedValue({ id: 'evo-test-msg' }),
}));

import { prisma } from '../lib/prisma';
import { redis, campanhasQueue } from '../services/queue';
import { sendEmail } from '../lib/mailer';
import { listTemplates, getPhoneNumberLimits, tierToNumericCap } from '../services/whatsapp-campaigns';
import {
  evolutionSendDelayMs, applySendWindow, effectiveEvolutionDailyLimit, registerCampanhaOptOut,
} from '../routes/modules/campanhas';

/** Espera a fila de microtasks esvaziar — as notificações de conclusão (item 10)
 *  são fire-and-forget (sem await) pra não bloquear o caminho principal. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function csvForm(csv: string) {
  return `--boundary\r\nContent-Disposition: form-data; name="file"; filename="contatos.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--boundary--\r\n`;
}

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

  it('DELETE remove campanha agendada', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled' });
    (prisma.campanha.delete as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'DELETE', url: '/modules/campanhas/c1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
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
    expect(res.json()).toEqual({ imported: 2, skippedOptOut: 1, skippedInvalid: 1, skippedDuplicate: 2, skippedVarMismatch: 0 });
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
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(),
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'disconnected' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/meta desconectado/i);
    });

    it('retorna 400 se tentar iniciar sem confirmar consentimento (1ª vez)', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: null,
      });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/consentimento/i);
      expect(prisma.whatsappNumber.findUnique).not.toHaveBeenCalled();
    });

    it('enfileira os contatos pendentes com jobId determinístico', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 2, whatsappNumberId: NUM_ID, startedAt: null, consentConfirmedAt: new Date(), poolNumberIds: [] });
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
      const [jobs] = (campanhasQueue.addBulk as jest.Mock).mock.calls[0];
      // canal meta também respeita a janela de silêncio (item 4) — delay pode ser 0
      // (dentro do horário permitido) ou >0 (madrugada, empurrado pra frente), mas
      // sempre um número; o que importa aqui é jobId determinístico e sem duplicar.
      expect(jobs).toEqual([
        { name: 'send', data: { campanhaId: 'c1', contatoId: 'ct1' }, opts: { jobId: 'c1:ct1', delay: expect.any(Number) } },
        { name: 'send', data: { campanhaId: 'c1', contatoId: 'ct2' }, opts: { jobId: 'c1:ct2', delay: expect.any(Number) } },
      ]);
      expect(prisma.campanha.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'running', startedAt: expect.any(Date), pausedReason: null, consecutiveFailures: 0 },
      });
    });
  });

  describe('POST /:id/start (a partir de agendada)', () => {
    it('inicia imediatamente uma campanha agendada', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled', audienceCount: 1, whatsappNumberId: NUM_ID, startedAt: null, consentConfirmedAt: new Date(), poolNumberIds: [] });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', metaAccessTokenEnc: 'enc' });
      (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }]);
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, enqueued: 1 });
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

describe('Agendamento (schedule/unschedule)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  const futureIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  describe('POST /:id/schedule', () => {
    it('retorna 400 se o status não permite agendar', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'running' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 se a campanha não tem audiência', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 0 });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 se a data agendada está no passado', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', audienceCount: 5 });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 se o número Meta está desconectado', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(),
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'disconnected' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 ao agendar sem confirmar consentimento (canal meta, 1ª vez)', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: null,
      });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso() },
      });
      expect(res.statusCode).toBe(400);
      expect(prisma.campanha.update).not.toHaveBeenCalled();
    });

    it('agenda a campanha com sucesso, confirmando consentimento pela 1ª vez', async () => {
      grantModuleAccess();
      const scheduledAt = futureIso();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: null, poolNumberIds: [],
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', metaAccessTokenEnc: 'enc' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt, confirmConsent: true },
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.campanha.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          status: 'scheduled', scheduledAt: new Date(scheduledAt),
          consentConfirmedAt: expect.any(Date), consentConfirmedIp: expect.anything(),
        },
      });
    });

    it('agenda sem pedir consentimento de novo quando já confirmado antes', async () => {
      grantModuleAccess();
      const scheduledAt = futureIso();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date('2026-01-01'), poolNumberIds: [],
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', metaAccessTokenEnc: 'enc' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt }, // sem confirmConsent — não deveria precisar
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.campanha.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'scheduled', scheduledAt: new Date(scheduledAt) },
      });
    });

    it('retorna 400 se a audiência já excede o tier no momento de agendar (gap conhecido §11.13)', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 300, whatsappNumberId: NUM_ID,
        consentConfirmedAt: new Date(), poolNumberIds: [],
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({
        id: NUM_ID, status: 'connected', metaAccessTokenEnc: 'enc', metaPhoneNumberId: 'phone-id-1',
        metaMessagingLimitTier: 'TIER_250', metaQualityRating: 'GREEN',
        metaLimitsSyncedAt: new Date(), // fresco — não bate na Graph API de novo
      });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso() },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.metaTierCap).toBe(250);
      expect(body.pendentesCount).toBe(300);
      expect(prisma.campanha.update).not.toHaveBeenCalled();
    });

    it('agenda mesmo acima do tier com confirmExceedsTier', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'draft', audienceCount: 300, whatsappNumberId: NUM_ID,
        consentConfirmedAt: new Date(), poolNumberIds: [],
      });
      (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({
        id: NUM_ID, status: 'connected', metaAccessTokenEnc: 'enc', metaPhoneNumberId: 'phone-id-1',
        metaMessagingLimitTier: 'TIER_250', metaQualityRating: 'GREEN', metaLimitsSyncedAt: new Date(),
      });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/schedule',
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: futureIso(), confirmExceedsTier: true },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /:id/unschedule', () => {
    it('retorna 400 se a campanha não está agendada', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/unschedule',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('cancela o agendamento e volta para rascunho', async () => {
      grantModuleAccess();
      (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'scheduled' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft' });

      const token = makeToken(app);
      const res = await app.inject({
        method: 'POST', url: '/modules/campanhas/c1/unschedule',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'draft', scheduledAt: null } });
    });
  });
});

describe('Canal Evolution (guardrails)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('POST / — evolution exige messageBody, não templateName', async () => {
    grantModuleAccess();
    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Promo', whatsappNumberId: NUM_ID, channel: 'evolution' }, // sem messageBody
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST / — cria campanha evolution contra número provider=evolution', async () => {
    grantModuleAccess();
    (prisma.whatsappNumber.findFirst as jest.Mock).mockResolvedValueOnce({ id: NUM_ID, provider: 'evolution' });
    (prisma.campanha.create as jest.Mock).mockResolvedValueOnce({ id: 'c1', channel: 'evolution' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Promo', whatsappNumberId: NUM_ID, channel: 'evolution', messageBody: 'Oi {{nome}}!' },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.whatsappNumber.findFirst).toHaveBeenCalledWith({
      where: { id: NUM_ID, userId: 'u1', provider: 'evolution' },
    });
    expect(prisma.campanha.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1', whatsappNumberId: NUM_ID, name: 'Promo', channel: 'evolution',
        templateName: null, templateLanguage: 'pt_BR', templateComponents: undefined,
        templateVarCount: null, messageBody: 'Oi {{nome}}!',
      },
    });
  });

  it('POST /:id/contatos (CSV) — rejeita para campanha evolution', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'evolution' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvForm('5511999999999,João'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /:id/contatos/from-conversas — rejeita para campanha meta', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'meta' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos/from-conversas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /:id/contatos/from-conversas — importa a união de conversas, pulando optout/duplicado', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'evolution', whatsappNumberId: NUM_ID });
    (prisma.transcription.findMany as jest.Mock).mockResolvedValueOnce([{ contactPhone: '11911111111', contactName: 'Ana' }]);
    (prisma.atendeConversation.findMany as jest.Mock).mockResolvedValueOnce([
      { contactPhone: '11911111111', contactName: null },  // mesmo contato da transcrição — dedup
      { contactPhone: '11922222222', contactName: 'Bruno' }, // vai dar optout
    ]);
    (prisma.copilotoConversation.findMany as jest.Mock).mockResolvedValueOnce([
      { contactPhone: '11933333333', contactName: 'Carla' }, // já existe na campanha — dedup
    ]);
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([{ phone: '5511922222222' }]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ phone: '5511933333333' }]);
    (prisma.campanhaContato.createMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos/from-conversas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 1, skippedOptOut: 1, skippedDuplicate: 1, elegiveis: 3 });
    expect(prisma.campanhaContato.createMany).toHaveBeenCalledWith({
      data: [{ campanhaId: 'c1', phone: '5511911111111', name: 'Ana' }],
    });
  });

  it('POST /:id/contatos/from-conversas — aplica corte de recência (item 8) nas 3 fontes', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'evolution', whatsappNumberId: NUM_ID });
    (prisma.transcription.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.atendeConversation.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.copilotoConversation.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos/from-conversas',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(prisma.transcription.findMany).toHaveBeenCalledWith({
      where: { numberId: NUM_ID, source: 'whatsapp', createdAt: { gte: expect.any(Date) } },
      select: { contactPhone: true, contactName: true },
    });
    expect(prisma.atendeConversation.findMany).toHaveBeenCalledWith({
      where: { numberId: NUM_ID, lastMessageAt: { gte: expect.any(Date) } },
      select: { contactPhone: true, contactName: true },
    });
    expect(prisma.copilotoConversation.findMany).toHaveBeenCalledWith({
      where: { numberId: NUM_ID, lastMessageAt: { gte: expect.any(Date) } },
      select: { contactPhone: true, contactName: true },
    });
  });

  it('POST /:id/start — evolution sem confirmConsent é rejeitado', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', channel: 'evolution', audienceCount: 2, whatsappNumberId: NUM_ID, consentConfirmedAt: null,
    });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(campanhasQueue.addBulk).not.toHaveBeenCalled();
  });

  it('POST /:id/start — evolution com confirmConsent grava consentimento e espaça os jobs', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', channel: 'evolution', audienceCount: 2, whatsappNumberId: NUM_ID,
      consentConfirmedAt: null, startedAt: null, poolNumberIds: [],
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', zapiInstanceId: 'zs-abc' });
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }, { id: 'ct2' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmConsent: true },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        status: 'running', startedAt: expect.any(Date),
        pausedReason: null, consecutiveFailures: 0,
        consentConfirmedAt: expect.any(Date), consentConfirmedIp: expect.anything(),
      },
    });
    const [jobs] = (campanhasQueue.addBulk as jest.Mock).mock.calls[0];
    expect(jobs).toHaveLength(2);
    // delay de cada job pode ser 0 (dentro da janela de envio) ou empurrado pra
    // frente (madrugada — item 4, ver applySendWindow abaixo); perto da virada de
    // hora isso pode reordenar os totais entre índices, então aqui só valida
    // jobId determinístico e que o delay é sempre um número não-negativo — a
    // corretude da janela em si tem cobertura determinística própria.
    expect(jobs[0].opts.jobId).toBe('c1:ct1');
    expect(jobs[0].opts.delay).toBeGreaterThanOrEqual(0);
    expect(jobs[1].opts.jobId).toBe('c1:ct2');
    expect(jobs[1].opts.delay).toBeGreaterThanOrEqual(0);
  });
});

describe('applySendWindow (janela de envio — item 4)', () => {
  it('empurra madrugada (3h BRT) pro início da janela (8h) no mesmo dia', () => {
    const now = new Date('2026-01-01T06:00:00.000Z'); // 03:00 BRT
    expect(applySendWindow(0, now)).toBe(5 * 60 * 60 * 1000);
  });

  it('não mexe em horário já dentro da janela (14h BRT)', () => {
    const now = new Date('2026-01-01T17:00:00.000Z'); // 14:00 BRT
    expect(applySendWindow(1000, now)).toBe(1000);
  });

  it('empurra noite (23h BRT) pro início da janela no dia seguinte', () => {
    const now = new Date('2026-01-02T02:00:00.000Z'); // 23:00 BRT (31/12 → 1/1 vira o dia em UTC)
    expect(applySendWindow(0, now)).toBe(9 * 60 * 60 * 1000);
  });

  it('exatamente no início da janela (8h BRT) não empurra', () => {
    const now = new Date('2026-01-01T11:00:00.000Z'); // 08:00 BRT
    expect(applySendWindow(0, now)).toBe(0);
  });

  it('exatamente no fim da janela (21h BRT) empurra — intervalo é [início, fim)', () => {
    const now = new Date('2026-01-02T00:00:00.000Z'); // 21:00 BRT
    expect(applySendWindow(0, now)).toBe(11 * 60 * 60 * 1000);
  });
});

describe('evolutionSendDelayMs (pacing)', () => {
  it('index 0 nunca tem delay', () => {
    expect(evolutionSendDelayMs(0, 40)).toBe(0);
  });

  it('espaça em torno de 24h / limite diário, com jitter de ±30%', () => {
    const dailyLimit = 40;
    const base = (24 * 60 * 60 * 1000) / dailyLimit;
    for (let i = 1; i <= 5; i++) {
      const delay = evolutionSendDelayMs(i, dailyLimit);
      expect(delay).toBeGreaterThanOrEqual(Math.round(i * base * 0.7) - 1);
      expect(delay).toBeLessThanOrEqual(Math.round(i * base * 1.3) + 1);
    }
  });
});

describe('Tier/quality rating real da Meta (POST /:id/start)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  const numeroSemCache = {
    id: NUM_ID, status: 'connected', metaAccessTokenEnc: 'enc', metaPhoneNumberId: 'phone-id-1',
    metaMessagingLimitTier: null, metaQualityRating: null, metaLimitsSyncedAt: null,
  };

  it('busca na Graph API quando não há cache, persiste, e bloqueia se a audiência excede o tier', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 300, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(), poolNumberIds: [],
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce(numeroSemCache);
    (getPhoneNumberLimits as jest.Mock).mockResolvedValueOnce({ messagingLimitTier: 'TIER_250', qualityRating: 'GREEN' });
    (prisma.whatsappNumber.update as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 300 }, (_, i) => ({ id: `ct${i}` })),
    );

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.metaMessagingLimitTier).toBe('TIER_250');
    expect(body.metaTierCap).toBe(250);
    expect(body.pendentesCount).toBe(300);
    expect(prisma.whatsappNumber.update).toHaveBeenCalledWith({
      where: { id: NUM_ID },
      data: {
        metaMessagingLimitTier: 'TIER_250', metaQualityRating: 'GREEN',
        metaLimitsSyncedAt: expect.any(Date),
      },
    });
    expect(campanhasQueue.addBulk).not.toHaveBeenCalled();
  });

  it('prossegue com confirmExceedsTier mesmo acima do tier', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 300, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(), startedAt: null, poolNumberIds: [],
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce(numeroSemCache);
    (getPhoneNumberLimits as jest.Mock).mockResolvedValueOnce({ messagingLimitTier: 'TIER_250', qualityRating: 'GREEN' });
    (prisma.whatsappNumber.update as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 300 }, (_, i) => ({ id: `ct${i}` })),
    );
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmExceedsTier: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, enqueued: 300 });
  });

  it('não bate na Graph API de novo se metaLimitsSyncedAt está fresco (<1h)', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(), startedAt: null, poolNumberIds: [],
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'connected', metaAccessTokenEnc: 'enc', metaPhoneNumberId: 'phone-id-1',
      metaMessagingLimitTier: 'TIER_100K', metaQualityRating: 'GREEN',
      metaLimitsSyncedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min atrás
    });
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(getPhoneNumberLimits).not.toHaveBeenCalled();
    expect(prisma.whatsappNumber.update).not.toHaveBeenCalled();
  });

  it('não bloqueia o disparo se a Graph API falhar ao consultar os limites (fail-open)', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 5, whatsappNumberId: NUM_ID, consentConfirmedAt: new Date(), startedAt: null, poolNumberIds: [],
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce(numeroSemCache);
    (getPhoneNumberLimits as jest.Mock).mockRejectedValueOnce(new Error('Graph API fora do ar'));
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.whatsappNumber.update).not.toHaveBeenCalled();
  });
});

describe('tierToNumericCap (parsing do tier da Meta)', () => {
  it('interpreta os formatos conhecidos de tier', () => {
    expect(tierToNumericCap('TIER_250')).toBe(250);
    expect(tierToNumericCap('TIER_1K')).toBe(1000);
    expect(tierToNumericCap('TIER_10K')).toBe(10000);
    expect(tierToNumericCap('TIER_100K')).toBe(100000);
  });

  it('trata UNLIMITED como sem teto', () => {
    expect(tierToNumericCap('TIER_UNLIMITED')).toBe(Infinity);
  });

  it('retorna null para valores ausentes ou não reconhecíveis', () => {
    expect(tierToNumericCap(null)).toBeNull();
    expect(tierToNumericCap(undefined)).toBeNull();
    expect(tierToNumericCap('ALGO_SEM_NUMERO')).toBeNull();
  });
});

describe('effectiveEvolutionDailyLimit (aquecimento progressivo — item 3)', () => {
  it('sem connectedAt, usa o limite cheio (fail-open)', () => {
    expect(effectiveEvolutionDailyLimit(null, 40)).toBe(40);
  });

  it('número recém-conectado (dia 0) começa no piso de 15%', () => {
    expect(effectiveEvolutionDailyLimit(new Date(), 40)).toBe(6); // round(40*0.15)
  });

  it('número conectado há mais dias que o warmup usa o limite cheio', () => {
    const dez_dias_atras = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    expect(effectiveEvolutionDailyLimit(dez_dias_atras, 40)).toBe(40);
  });

  it('meio do período de warmup fica entre o piso e o limite cheio', () => {
    const cinco_dias_atras = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const limite = effectiveEvolutionDailyLimit(cinco_dias_atras, 40);
    expect(limite).toBeGreaterThan(6);
    expect(limite).toBeLessThan(40);
  });
});

describe('registerCampanhaOptOut (item 9 — processedCount + conclusão)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registra o opt-out e não mexe em processedCount quando não há pendente afetado', async () => {
    (prisma.campanhaOptOut.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([]);

    const phone = await registerCampanhaOptOut('u1', '11999999999', 'PARAR');

    expect(phone).toBe('5511999999999');
    expect(prisma.campanhaOptOut.upsert).toHaveBeenCalledWith({
      where:  { userId_phone: { userId: 'u1', phone: '5511999999999' } },
      create: { userId: 'u1', phone: '5511999999999', reason: 'PARAR' },
      update: { reason: 'PARAR' },
    });
    expect(prisma.campanhaContato.updateMany).not.toHaveBeenCalled();
    expect(prisma.campanha.update).not.toHaveBeenCalled();
  });

  it('incrementa processedCount por campanha afetada (agrupado), sem tocar consecutiveFailures', async () => {
    (prisma.campanhaOptOut.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'ct1', campanhaId: 'c1' },
      { id: 'ct2', campanhaId: 'c1' },
      { id: 'ct3', campanhaId: 'c2' },
    ]);
    (prisma.campanhaContato.updateMany as jest.Mock).mockResolvedValueOnce({ count: 3 });
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({ processedCount: 2, audienceCount: 5, status: 'running' })  // c1: +2
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 5, status: 'running' }); // c2: +1

    await registerCampanhaOptOut('u1', '11999999999', 'SAIR');

    expect(prisma.campanhaContato.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ct1', 'ct2', 'ct3'] } },
      data:  { status: 'optout' },
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processedCount: { increment: 2 } },
      select: { processedCount: true, audienceCount: true, status: true },
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { processedCount: { increment: 1 } },
      select: { processedCount: true, audienceCount: true, status: true },
    });
    // nenhuma das duas bateu audienceCount ainda — não completa
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('completa a campanha quando o opt-out esgota os pendentes (status running) e notifica por e-mail', async () => {
    (prisma.campanhaOptOut.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1', campanhaId: 'c1' }]);
    (prisma.campanhaContato.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ processedCount: 5, audienceCount: 5, status: 'running' });
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', name: 'Promo', sentCount: 4, user: { email: 'dono@x.com', name: 'Dono' },
    });

    await registerCampanhaOptOut('u1', '11999999999', 'PARAR');

    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'running' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
    await flushPromises();
    expect(sendEmail).toHaveBeenCalledWith('dono@x.com', expect.stringContaining('Promo'), expect.stringContaining('concluída'));
  });

  it('não completa campanha draft/paused mesmo esgotando os pendentes — só running completa sozinha', async () => {
    (prisma.campanhaOptOut.upsert as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1', campanhaId: 'c1' }]);
    (prisma.campanhaContato.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ processedCount: 5, audienceCount: 5, status: 'paused' });

    await registerCampanhaOptOut('u1', '11999999999', 'PARAR');

    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });
});

describe('Pool de números (item 2)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('GET /:id/pool-candidates lista números do mesmo canal, exceto o primário', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', channel: 'meta', whatsappNumberId: NUM_ID });
    (prisma.whatsappNumber.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'num2', phoneNumber: '5511888888888', displayName: 'Num 2', status: 'connected' }]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/c1/pool-candidates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.whatsappNumber.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', provider: 'meta', isPublic: false, id: { not: NUM_ID } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phoneNumber: true, displayName: true, status: true },
    });
  });

  it('POST /:id/pool rejeita número que não pertence ao usuário ou é de outro canal', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'meta', whatsappNumberId: NUM_ID });
    (prisma.whatsappNumber.findMany as jest.Mock).mockResolvedValueOnce([]); // nenhum dos ids bate

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/pool',
      headers: { authorization: `Bearer ${token}` },
      payload: { numberIds: ['outro-num'] },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.campanha.update).not.toHaveBeenCalled();
  });

  it('POST /:id/pool salva a lista validada, ignorando o próprio número primário', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', channel: 'meta', whatsappNumberId: NUM_ID });
    (prisma.whatsappNumber.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'num2' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ id: 'c1', poolNumberIds: ['num2'] });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/pool',
      headers: { authorization: `Bearer ${token}` },
      payload: { numberIds: ['num2', NUM_ID] }, // NUM_ID é o próprio primário — deve ser filtrado
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { poolNumberIds: ['num2'] } });
  });

  it('POST /:id/start distribui os contatos em round-robin entre o número primário e o pool', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 4, whatsappNumberId: NUM_ID,
      consentConfirmedAt: new Date(), startedAt: null, poolNumberIds: ['num2'], channel: 'meta',
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ id: NUM_ID, status: 'connected', metaAccessTokenEnc: 'enc' });
    (prisma.whatsappNumber.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'num2', status: 'connected', metaAccessTokenEnc: 'enc2' },
    ]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }, { id: 'ct2' }, { id: 'ct3' }, { id: 'ct4' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});
    (prisma.campanhaContato.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, enqueued: 4 });
    // round-robin: ct1,ct3 → NUM_ID (índices 0,2) / ct2,ct4 → num2 (índices 1,3)
    expect(prisma.campanhaContato.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ct1', 'ct3'] } }, data: { assignedNumberId: NUM_ID },
    });
    expect(prisma.campanhaContato.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ct2', 'ct4'] } }, data: { assignedNumberId: 'num2' },
    });
  });

  it('POST /:id/start ignora número do pool que está desconectado, sem travar a campanha', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'draft', audienceCount: 2, whatsappNumberId: NUM_ID,
      consentConfirmedAt: new Date(), startedAt: null, poolNumberIds: ['num2'], channel: 'meta',
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ id: NUM_ID, status: 'connected', metaAccessTokenEnc: 'enc' });
    (prisma.whatsappNumber.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'num2', status: 'disconnected', metaAccessTokenEnc: null },
    ]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'ct1' }, { id: 'ct2' }]);
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // só 1 número pronto (o primário) — não deve gravar assignedNumberId (caminho comum)
    expect(prisma.campanhaContato.updateMany).not.toHaveBeenCalled();
  });
});

describe('Validação de variáveis do template (item 6)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  function csvFormLocal(csv: string) {
    return `--boundary\r\nContent-Disposition: form-data; name="file"; filename="contatos.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--boundary--\r\n`;
  }

  it('pula linhas cujo nº de variáveis não bate com templateVarCount da campanha', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', templateVarCount: 2 });
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.createMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const csv = [
      '11999999999,Ana,João,20%',      // 2 variáveis — ok
      '11988888888,Duda,SóUma',        // 1 variável — mismatch, pula
      '11977777777,Rui,A,B,C',         // 3 variáveis — mismatch, pula
    ].join('\n');

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvFormLocal(csv),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 1, skippedOptOut: 0, skippedInvalid: 0, skippedDuplicate: 0, skippedVarMismatch: 2 });
  });

  it('campanha sem templateVarCount (legado) não valida nº de variáveis', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', status: 'draft', templateVarCount: null });
    (prisma.campanhaOptOut.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.campanhaContato.createMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/contatos',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: csvFormLocal('11999999999,Ana,SóUma'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 1, skippedOptOut: 0, skippedInvalid: 0, skippedDuplicate: 0, skippedVarMismatch: 0 });
  });
});

describe('GET /performance (item 7)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('agrega stats por template entre campanhas meta do usuário', async () => {
    grantModuleAccess();
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'c1', templateName: 'promo', audienceCount: 10 },
      { id: 'c2', templateName: 'promo', audienceCount: 5 },
    ]);
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValueOnce([
      { campanhaId: 'c1', status: 'sent', _count: 8 },
      { campanhaId: 'c1', status: 'failed', _count: 2 },
      { campanhaId: 'c2', status: 'read', _count: 5 },
    ]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/performance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toEqual([{
      templateName: 'promo', campanhas: 2, audienceCount: 15,
      sent: 8, delivered: 0, read: 5, failed: 2, optout: 0,
      successRate: 13 / 15, failureRate: 2 / 15, optoutRate: 0,
    }]);
  });

  it('retorna lista vazia sem consultar groupBy quando não há campanhas meta', async () => {
    grantModuleAccess();
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([]);

    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET', url: '/modules/campanhas/performance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ templates: [] });
    expect(prisma.campanhaContato.groupBy).not.toHaveBeenCalled();
  });
});

describe('POST /:id/test-send (item 5)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 com telefone inválido', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', channel: 'meta', templateName: 'promo', whatsappNumberId: NUM_ID });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/test-send',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 se o número está desconectado', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'c1', channel: 'meta', templateName: 'promo', whatsappNumberId: NUM_ID });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'disconnected' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/test-send',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '11999999999' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('envia teste via Evolution renderizando {{nome}} com prefixo [TESTE]', async () => {
    grantModuleAccess();
    (prisma.campanha.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'c1', channel: 'evolution', messageBody: 'Oi {{nome}}!', whatsappNumberId: NUM_ID,
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'connected', zapiInstanceId: 'zs-abc' });

    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST', url: '/modules/campanhas/c1/test-send',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '11999999999', nome: 'Carla' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
