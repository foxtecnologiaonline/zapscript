/**
 * API pública de escrita e log de mensagens — itens 1, 3, 5 e 6 do escopo
 * ZapScript × Twilio, de ponta a ponta pela rota.
 *
 * Decisão de desenho que estes testes travam: a rota ACEITA e enfileira (202
 * queued), não envia na requisição. Quem envia é o worker (fila messages-out),
 * então o retry fica com o BullMQ e o ciclo de vida vira evento de webhook —
 * o mesmo contrato que quem vem do Twilio espera.
 */
import Fastify from 'fastify';

jest.mock('../lib/prisma', () => ({
  prisma: {
    apiKey:            { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    whatsappNumber:    { findFirst: jest.fn(), findMany: jest.fn() },
    campanhaOptOut:    { findUnique: jest.fn() },
    messageLog:        { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    idempotencyRecord: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock('../services/queue', () => ({
  redis:            { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() },
  messagesOutQueue: { add: jest.fn().mockResolvedValue({}) },
  webhooksQueue:    { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../services/encryption', () => ({
  encryptStr: jest.fn((v: string) => v),
  decryptStr: jest.fn(() => 'token-meta'),
}));

// A emissão de evento é testada em events.test.ts; aqui ela só não deve estorvar.
jest.mock('../services/events', () => ({
  emitEvent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/meta-templates', () => ({
  findTemplateByName: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { messagesOutQueue } from '../services/queue';
import { findTemplateByName } from '../services/meta-templates';

const db = prisma as any;
const KEY = 'zsk_live_abcdef';

async function build() {
  const app = Fastify();
  await app.register(import('../routes/publicApi'), { prefix: '/public/v1' });
  await app.ready();
  return app;
}

/** Chave de API válida com os escopos pedidos. */
function comEscopos(...scopes: string[]) {
  db.apiKey.findUnique.mockResolvedValue({
    id: 'key-1', userId: 'u1', scopes, revokedAt: null, name: 'Zapier', keyPrefix: 'zsk_live_abc',
  });
}

const numeroEvolution = {
  id: 'num-evo', userId: 'u1', provider: 'evolution', status: 'connected',
  phoneNumber: '5511988887777', zapiInstanceId: 'zs-num-evo',
};
const numeroMeta = {
  id: 'num-meta', userId: 'u1', provider: 'meta', status: 'connected',
  phoneNumber: '5511977776666', metaAccessTokenEnc: 'enc', metaWabaId: 'waba-1', metaPhoneNumberId: 'pni-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  comEscopos('messages:write', 'messages:read');
  db.campanhaOptOut.findUnique.mockResolvedValue(null);
  db.whatsappNumber.findMany.mockResolvedValue([numeroEvolution]);
  db.whatsappNumber.findFirst.mockResolvedValue(numeroEvolution);
  db.idempotencyRecord.create.mockResolvedValue({ id: 'idem-1' });
  db.idempotencyRecord.update.mockResolvedValue({});
  // Precisa resolver: o caminho de falha transitória encadeia .catch() no delete.
  db.idempotencyRecord.delete.mockResolvedValue({});
  db.messageLog.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 'msg-1', queuedAt: new Date('2026-10-02T10:00:00Z'), attempts: 0, ...data }));
  db.messageLog.update.mockResolvedValue({
    id: 'msg-1', userId: 'u1', status: 'failed', queuedAt: new Date('2026-10-02T10:00:00Z'),
  });
});

describe('autenticação e escopos (item 6: erro programável)', () => {
  it('sem chave → 401 auth.key_missing no envelope público', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/public/v1/messages', payload: { to: '5511999999999', text: 'oi' } });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('auth.key_missing');
    expect(body.error.docUrl).toContain('auth.key_missing');
    expect(body.error.retryable).toBe(false);
    await app.close();
  });

  it('chave revogada → 401 auth.key_invalid', async () => {
    db.apiKey.findUnique.mockResolvedValue({ id: 'k', userId: 'u1', scopes: ['messages:write'], revokedAt: new Date() });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('auth.key_invalid');
    await app.close();
  });

  it('chave de LEITURA não envia — escopos separados de propósito', async () => {
    comEscopos('messages:read');
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('auth.scope_missing');
    expect(body.error.details).toMatchObject({ missing: 'messages:write' });
    expect(messagesOutQueue.add).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /messages — aceite', () => {
  it('aceita texto com 202 queued e enfileira o envio', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '+55 (11) 99999-9999', text: 'Olá!' },
    });

    expect(res.statusCode).toBe(202);
    const { data } = res.json();
    expect(data).toMatchObject({ id: 'msg-1', status: 'queued', to: '5511999999999', type: 'text' });

    // jobId = id do log: reenfileiramento não vira segundo envio.
    expect(messagesOutQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ messageLogId: 'msg-1', numberId: 'num-evo', to: '5511999999999', type: 'text', text: 'Olá!' }),
      { jobId: 'msg-1' },
    );
    await app.close();
  });

  it('normaliza o telefone — "+55 (11) 9..." e "5511 9..." são a mesma coisa', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.json().data.to).toBe('5511999999999');
    await app.close();
  });

  it('recusa telefone curto com request.invalid', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '999', text: 'oi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('request.invalid');
    await app.close();
  });

  it('type=text sem text é recusado antes de qualquer I/O', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('text');
    expect(db.messageLog.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('destinatário em opt-out é recusado — nunca enfileira', async () => {
    db.campanhaOptOut.findUnique.mockResolvedValueOnce({ phone: '5511999999999', reason: 'PARAR', createdAt: new Date() });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('message.recipient_opted_out');
    expect(messagesOutQueue.add).not.toHaveBeenCalled();
    await app.close();
  });

  it('sem número conectado → number.not_found', async () => {
    db.whatsappNumber.findMany.mockResolvedValueOnce([]);
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('number.not_found');
    await app.close();
  });

  it('com DOIS números e sem numberId, recusa em vez de adivinhar o remetente', async () => {
    // Enviar do número errado é um erro que o cliente não desfaz: a mensagem
    // já chegou com outro remetente.
    db.whatsappNumber.findMany.mockResolvedValueOnce([
      { ...numeroEvolution, id: 'n1', status: 'connected' },
      { ...numeroEvolution, id: 'n2', status: 'connected' },
    ]);
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('request.invalid');
    expect(body.error.message).toContain('numberId');
    expect(body.error.details.numbers).toHaveLength(2);
    await app.close();
  });

  it('numberId inexistente nesta conta → number.not_found', async () => {
    db.whatsappNumber.findFirst.mockResolvedValueOnce(null);
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY }, payload: { to: '5511999999999', text: 'oi', numberId: 'de-outro-cliente' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('number.not_found');
    await app.close();
  });

  it('template em número Evolution → message.type_unsupported (template é da Cloud API)', async () => {
    // Só findFirst é consultado (o payload traz numberId) — enfileirar um
    // `findMany` aqui vazaria para o teste seguinte: clearAllMocks não descarta
    // mockResolvedValueOnce pendente.
    db.whatsappNumber.findFirst.mockResolvedValueOnce(numeroEvolution);
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '5511999999999', type: 'template', numberId: 'num-evo', template: { name: 'promo' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('message.type_unsupported');
    await app.close();
  });
});

describe('POST /messages — template validado contra a Meta (itens 4 e 8)', () => {
  beforeEach(() => {
    db.whatsappNumber.findMany.mockResolvedValue([numeroMeta]);
    db.whatsappNumber.findFirst.mockResolvedValue(numeroMeta);
  });

  it('template inexistente no WABA → template.not_found, sem enfileirar', async () => {
    (findTemplateByName as jest.Mock).mockResolvedValueOnce(null);
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '5511999999999', type: 'template', template: { name: 'nao_existe' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('template.not_found');
    expect(messagesOutQueue.add).not.toHaveBeenCalled();
    await app.close();
  });

  it('variáveis em número errado → template.param_mismatch ANTES do envio', async () => {
    (findTemplateByName as jest.Mock).mockResolvedValueOnce({
      name: 'promo', status: 'APPROVED', language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Olá {{1}}, pedido {{2}}' }],
    });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '5511999999999', type: 'template', template: { name: 'promo', variables: ['só uma'] } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('template.param_mismatch');
    expect(body.error.details).toEqual({ expected: 2, received: 1 });
    await app.close();
  });

  it('template com header de imagem sem template.header → header_media_required', async () => {
    (findTemplateByName as jest.Mock).mockResolvedValueOnce({
      name: 'promo_img', status: 'APPROVED', language: 'pt_BR',
      components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Confira' }],
    });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '5511999999999', type: 'template', template: { name: 'promo_img' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('template.header_media_required');
    await app.close();
  });

  it('template com header de imagem E a mídia informada é aceito (item 8)', async () => {
    (findTemplateByName as jest.Mock).mockResolvedValueOnce({
      name: 'promo_img', status: 'APPROVED', language: 'pt_BR',
      components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Confira' }],
    });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: {
        to: '5511999999999', type: 'template',
        template: { name: 'promo_img', header: { type: 'image', link: 'https://cdn.x.com/a.jpg' } },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ status: 'queued', type: 'template', templateName: 'promo_img' });
    expect(messagesOutQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        template: expect.objectContaining({ header: { type: 'image', link: 'https://cdn.x.com/a.jpg' } }),
      }),
      { jobId: 'msg-1' },
    );
    await app.close();
  });

  it('template pausado na Meta → template.not_approved', async () => {
    (findTemplateByName as jest.Mock).mockResolvedValueOnce({
      name: 'promo', status: 'PAUSED', language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Confira' }],
    });
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY },
      payload: { to: '5511999999999', type: 'template', template: { name: 'promo' } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('template.not_approved');
    await app.close();
  });
});

describe('POST /messages — idempotência (item 3)', () => {
  it('replay devolve a resposta gravada, sem enfileirar de novo', async () => {
    db.idempotencyRecord.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.idempotencyRecord.findUnique.mockResolvedValueOnce({
      id: 'idem-1', status: 'completed', statusCode: 202,
      responseBody: { data: { id: 'msg-ja-enviada', status: 'queued' } },
      // Hash do MESMO corpo canonicalizado que a rota vai calcular.
      requestHash: require('../lib/idempotency').hashPayload('POST /public/v1/messages', {
        to: '5511999999999', type: 'text', text: 'oi',
      }),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY, 'idempotency-key': 'chave-do-cliente-1' },
      payload: { to: '5511999999999', text: 'oi' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.headers['x-idempotent-replay']).toBe('true');
    expect(res.json().data.id).toBe('msg-ja-enviada');
    // O ponto do item 3: a mensagem NÃO sai duas vezes.
    expect(messagesOutQueue.add).not.toHaveBeenCalled();
    await app.close();
  });

  it('mesma chave com corpo diferente → 422 request_mismatch', async () => {
    db.idempotencyRecord.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.idempotencyRecord.findUnique.mockResolvedValueOnce({
      id: 'idem-1', status: 'completed', statusCode: 202, responseBody: {},
      requestHash: 'hash-de-outro-corpo',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY, 'idempotency-key': 'chave-reusada-1' },
      payload: { to: '5511999999999', text: 'outra coisa' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('idempotency.request_mismatch');
    await app.close();
  });

  it('chave inválida (curta) → 400 key_invalid', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY, 'idempotency-key': 'abc' },
      payload: { to: '5511999999999', text: 'oi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('idempotency.key_invalid');
    await app.close();
  });

  it('fila indisponível: marca falha, devolve erro retryable e libera a chave', async () => {
    (messagesOutQueue.add as jest.Mock).mockRejectedValueOnce(new Error('redis fora'));
    const app = await build();
    const res = await app.inject({
      method: 'POST', url: '/public/v1/messages',
      headers: { 'x-api-key': KEY, 'idempotency-key': 'chave-fila-fora-1' },
      payload: { to: '5511999999999', text: 'oi' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe('provider.unavailable');
    expect(body.error.retryable).toBe(true);
    // Chave liberada: senão o cliente não conseguiria reenviar o que nunca saiu.
    expect(db.idempotencyRecord.delete).toHaveBeenCalled();
    await app.close();
  });
});

describe('GET /messages — log (item 5)', () => {
  const linha = (over: any = {}) => ({
    id: 'msg-1', userId: 'u1', direction: 'outbound', channel: 'meta', source: 'api',
    status: 'delivered', toPhone: '5511999999999', fromPhone: '5511977776666', type: 'text',
    body: 'oi', templateName: null, templateLanguage: null, mediaUrl: null, numberId: 'num-meta',
    providerMessageId: 'wamid.1', errorCode: null, errorMessage: null, attempts: 1,
    idempotencyKey: 'chave-1',
    queuedAt: new Date('2026-10-02T10:00:00Z'), sentAt: new Date('2026-10-02T10:00:01Z'),
    deliveredAt: new Date('2026-10-02T10:00:05Z'), readAt: null, failedAt: null,
    ...over,
  });

  it('lista no formato público, sem vazar campo interno', async () => {
    db.messageLog.findMany.mockResolvedValueOnce([linha()]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages', headers: { 'x-api-key': KEY } });

    expect(res.statusCode).toBe(200);
    const { data, hasMore, nextCursor } = res.json();
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
    expect(data[0]).toMatchObject({ id: 'msg-1', status: 'delivered', to: '5511999999999', error: null });
    // Internos não saem no contrato público.
    expect(data[0]).not.toHaveProperty('attempts');
    expect(data[0]).not.toHaveProperty('idempotencyKey');
    expect(data[0]).not.toHaveProperty('userId');
    await app.close();
  });

  it('erro vem como objeto com o CÓDIGO do catálogo', async () => {
    db.messageLog.findMany.mockResolvedValueOnce([
      linha({ status: 'failed', errorCode: 'message.outside_window', errorMessage: 'Re-engagement message' }),
    ]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages', headers: { 'x-api-key': KEY } });
    expect(res.json().data[0].error).toEqual({
      code: 'message.outside_window', message: 'Re-engagement message',
    });
    await app.close();
  });

  it('pagina por cursor: pede limit+1 e devolve nextCursor', async () => {
    db.messageLog.findMany.mockResolvedValueOnce([linha({ id: 'a' }), linha({ id: 'b' }), linha({ id: 'c' })]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages?limit=2', headers: { 'x-api-key': KEY } });

    const body = res.json();
    expect(db.messageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(body.data).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('b');
    await app.close();
  });

  it('filtra por status, direção e destinatário', async () => {
    db.messageLog.findMany.mockResolvedValueOnce([]);
    const app = await build();
    await app.inject({
      method: 'GET',
      url: '/public/v1/messages?status=failed&direction=outbound&to=%2B55+11+99999-9999',
      headers: { 'x-api-key': KEY },
    });
    expect(db.messageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', status: 'failed', direction: 'outbound', toPhone: '5511999999999' },
    }));
    await app.close();
  });

  it('status inválido é recusado com a lista do que vale', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages?status=enviadinha', headers: { 'x-api-key': KEY } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.allowed).toContain('delivered');
    await app.close();
  });

  it('data mal formada é recusada', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages?since=ontem', headers: { 'x-api-key': KEY } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('ISO 8601');
    await app.close();
  });

  it('GET /:id de outra conta → message.not_found (nunca 403 com existência vazada)', async () => {
    db.messageLog.findFirst.mockResolvedValueOnce(null);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/messages/de-outro', headers: { 'x-api-key': KEY } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('message.not_found');
    // A consulta é SEMPRE escopada por userId.
    expect(db.messageLog.findFirst).toHaveBeenCalledWith({ where: { id: 'de-outro', userId: 'u1' } });
    await app.close();
  });
});

describe('GET /me', () => {
  it('devolve escopos da chave e os números (o numberId que o cliente precisa)', async () => {
    comEscopos('messages:write');
    db.whatsappNumber.findMany.mockResolvedValueOnce([
      { id: 'num-meta', phoneNumber: '5511977776666', displayName: 'Comercial', status: 'connected', provider: 'meta' },
      { id: 'num-p',    phoneNumber: 'pending',       displayName: null,        status: 'disconnected', provider: 'evolution' },
    ]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/public/v1/me', headers: { 'x-api-key': KEY } });

    const { data } = res.json();
    expect(data.apiKey.scopes).toEqual(['messages:write']);
    expect(data.numbers[0]).toEqual({
      id: 'num-meta', phoneNumber: '5511977776666', displayName: 'Comercial',
      status: 'connected', channel: 'official',
    });
    // 'pending' não é telefone — não vaza como se fosse.
    expect(data.numbers[1].phoneNumber).toBeNull();
    expect(data.numbers[1].channel).toBe('evolution');
    await app.close();
  });
});
