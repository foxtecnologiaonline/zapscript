process.env.BV_DEV_SIMULATORS = '1';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import Fastify from 'fastify';
import { authHeader, makeOrg, makeUser } from '../../../core/testing';
import waPlugin from '../index';
import { clearBvEventHandlers } from '../../../core/events';
import { saveIntegration } from '../../../core/integrations';
import { ingestInbound, sendMessage } from '../../../core/conversations';
import { getUsage } from '../../../core/usage';
import { listMessages } from '../../../core/messages';
import { getObjectBuffer, newKey, putObject } from '../../../core/storage';
import { configureWaRuntime, mapGraphErrorCode, setWaHttp } from '../graph';
import { drainWhatsappBackground, mapInboundMessage, retryPendingMedia, trustedMediaUrl } from '../inbound';
import { invalidateWaConfigCache } from '../config';
import { splitText } from '../sender';
import { buildTemplateComponents, renderTemplateText, TemplateParamError, validateTemplateComponents } from '../templates';
import { FakeGraph } from './fake-graph';

const TOKEN = 'tok-test-1234567890';
const graph = new FakeGraph();
let app: FastifyInstance;
const rand = (n = 12) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const day = () => [new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000)] as const;
const usage = (orgId: string, item: any) => getUsage(orgId, item, ...day());

interface Ctx { orgId: string; admin: Awaited<ReturnType<typeof makeUser>>; h: { authorization: string }; phoneNumberId: string; wabaId: string; appSecret: string; verifyToken: string }

async function setup(over: Record<string, unknown> = {}, orgSettings: Record<string, unknown> = {}): Promise<Ctx> {
  const org = await makeOrg({ ai: { enabled: false }, ...orgSettings });
  const admin = await makeUser(org.id, 'ADMIN');
  const c = { phoneNumberId: rand(), wabaId: rand(), appSecret: `secret-${rand(8)}`, verifyToken: `verify-${rand(8)}` };
  graph.wabaIds.add(c.wabaId);
  await saveIntegration(org.id, 'WHATSAPP', { accessToken: TOKEN, ...c, apiBase: graph.base, ...over });
  invalidateWaConfigCache();
  return { orgId: org.id, admin, h: authHeader(admin), ...c };
}

const sign = (body: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

async function webhook(ctx: Pick<Ctx, 'appSecret'>, payload: unknown, secret?: string | null) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST', url: '/balcao/whatsapp/webhook', payload: body,
    headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-hub-signature-256': sign(body, secret ?? ctx.appSecret) }) },
  });
}

function msgPayload(ctx: Pick<Ctx, 'phoneNumberId'>, messages: any[], name = 'Maria') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '556333330000', phone_number_id: ctx.phoneNumberId }, contacts: [{ profile: { name }, wa_id: messages[0]?.from }], messages } }] }],
  };
}
const statusPayload = (ctx: Pick<Ctx, 'phoneNumberId'>, statuses: any[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: ctx.phoneNumberId }, statuses } }] }],
});
const textMsg = (from: string, body: string, id = `wamid.IN${crypto.randomBytes(6).toString('hex')}`) => ({ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });

async function inbound(ctx: Ctx, from: string, text = 'oi') {
  const m = textMsg(from, text);
  expect((await webhook(ctx, msgPayload(ctx, [m]))).statusCode).toBe(200);
  const row = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: m.id } });
  return { wamid: m.id, conversationId: row.conversationId };
}

async function makeTemplate(ctx: Ctx, over: Record<string, any> = {}) {
  return prisma.bvWaTemplate.create({
    data: {
      orgId: ctx.orgId, name: over.name ?? `aviso_${rand(6)}`, language: 'pt_BR', category: over.category ?? 'UTILITY', status: over.status ?? 'APPROVED',
      components: over.components ?? [{ type: 'BODY', text: 'Olá {{1}}, sua audiência é em {{2}}.', example: { body_text: [['Maria', '10/12']] } }, { type: 'FOOTER', text: 'TJ-TO' }],
    },
  });
}

beforeAll(async () => {
  await graph.start();
  configureWaRuntime({ baseDelayMs: 1, maxDelayMs: 5, sleep: async () => undefined, statusRetryDelaysMs: [] });
  // App isolado só com o plugin desta frente (não depende do estado das demais frentes em paralelo).
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try { (req as any).rawBody = body; const t = body.toString().trim(); done(null, t ? JSON.parse(t) : {}); } catch (e: any) { done(e); }
  });
  await app.register(waPlugin, { prefix: '/balcao/whatsapp' });
  await app.ready();
});
afterAll(async () => { await drainWhatsappBackground(); await app.close(); await graph.stop(); clearBvEventHandlers(); setWaHttp(null); });
beforeEach(() => graph.reset());

describe('whatsapp — webhook: verificação e HMAC', () => {
  it('GET devolve o challenge só com o verify token de alguma integração', async () => {
    const ctx = await setup();
    const ok = await app.inject({ url: `/balcao/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${ctx.verifyToken}&hub.challenge=12345` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    expect(ok.headers['content-type']).toContain('text/plain');
    expect((await app.inject({ url: '/balcao/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1' })).statusCode).toBe(403);
    expect((await app.inject({ url: `/balcao/whatsapp/webhook?hub.mode=unsubscribe&hub.verify_token=${ctx.verifyToken}&hub.challenge=1` })).statusCode).toBe(403);
  });

  it('POST com assinatura inválida ou ausente → 401 e nada é gravado', async () => {
    const ctx = await setup();
    const m = textMsg('5563999990001', 'segredo do cidadão');
    expect((await webhook(ctx, msgPayload(ctx, [m]), 'outro-segredo')).statusCode).toBe(401);
    expect((await webhook(ctx, msgPayload(ctx, [m]), null)).statusCode).toBe(401);
    expect(await prisma.bvMessage.count({ where: { orgId: ctx.orgId } })).toBe(0);
  });

  it('assinatura calculada sobre o corpo bruto (adulteração do corpo invalida)', async () => {
    const ctx = await setup();
    const body = JSON.stringify(msgPayload(ctx, [textMsg('5563999990002', 'oi')]));
    const r = await app.inject({ method: 'POST', url: '/balcao/whatsapp/webhook', payload: body.replace('oi', 'ola'), headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, ctx.appSecret) } });
    expect(r.statusCode).toBe(401);
  });

  it('número desconhecido → 200 e ignora (sem vazar existência)', async () => {
    const ctx = await setup();
    const r = await webhook(ctx, msgPayload({ phoneNumberId: rand(14) }, [textMsg('5563999990003', 'oi')]));
    expect(r.statusCode).toBe(200);
    expect(r.json().ignored).toBe(true);
  });

  it('integração desabilitada é ignorada', async () => {
    const ctx = await setup();
    await prisma.bvIntegration.updateMany({ where: { orgId: ctx.orgId, type: 'WHATSAPP' }, data: { enabled: false } });
    invalidateWaConfigCache();
    expect((await webhook(ctx, msgPayload(ctx, [textMsg('5563999990004', 'oi')]))).json().ignored).toBe(true);
    expect(await prisma.bvMessage.count({ where: { orgId: ctx.orgId } })).toBe(0);
  });
});

describe('whatsapp — entrada', () => {
  it('texto: cria contato/conversa, cifra o corpo, deduplica por wamid e conta WA_SERVICE uma vez por janela', async () => {
    const ctx = await setup();
    const m1 = textMsg('5563988880001', 'Preciso de ajuda com o processo');
    expect((await webhook(ctx, msgPayload(ctx, [m1]))).statusCode).toBe(200);
    expect((await webhook(ctx, msgPayload(ctx, [m1]))).statusCode).toBe(200); // reentrega da Meta
    const m2 = textMsg('5563988880001', 'segunda mensagem');
    await webhook(ctx, msgPayload(ctx, [m2]));
    const conv = await prisma.bvConversation.findFirstOrThrow({ where: { orgId: ctx.orgId } });
    expect(conv.channel).toBe('WHATSAPP');
    expect(conv.channelRef).toBe('5563988880001');
    expect(conv.status).toBe('WAITING');
    expect(await prisma.bvMessage.count({ where: { orgId: ctx.orgId, direction: 'IN' } })).toBe(2);
    const raw = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: m1.id } });
    expect(raw.body).not.toContain('processo');
    const msgs = await listMessages(conv.id);
    expect(msgs[0].body).toBe('Preciso de ajuda com o processo');
    expect((await prisma.bvContact.findFirstOrThrow({ where: { orgId: ctx.orgId } })).name).toBe('Maria');
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(1);
    expect((conv.metadata as any)).toBeDefined();
    const fresh = await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect((fresh.metadata as any).whatsapp.windowOpenedAt).toBeTruthy();
  });

  it('nova janela (>24h desde a abertura) conta de novo; janela aberta em outra conversa do mesmo contato não duplica', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563988880002');
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(1);
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: conversationId } });
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { metadata: { ...(conv.metadata as any), whatsapp: { windowOpenedAt: old } } } });
    await inbound(ctx, '5563988880002', 'voltei no dia seguinte');
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(2);
    await inbound(ctx, '5563988880002', 'mais uma');
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(2);
  });

  it('janela é por abertura mesmo com mensagens concorrentes', async () => {
    const ctx = await setup();
    const from = '5563988880003';
    await Promise.all(Array.from({ length: 5 }, (_, i) => webhook(ctx, msgPayload(ctx, [textMsg(from, `msg ${i}`)]))));
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(1);
  });

  it('localização, botão/lista interativos e reações', async () => {
    expect(mapInboundMessage({ type: 'location', location: { latitude: -10.18, longitude: -48.33, name: 'Fórum' } })).toMatchObject({ kind: 'TEXT', body: expect.stringContaining('Fórum') });
    expect(mapInboundMessage({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Sim' } } })).toMatchObject({ body: 'Sim', wa: { interactive: { id: 'b1' } } });
    expect(mapInboundMessage({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'Certidões' } } })).toMatchObject({ body: 'Certidões' });
    expect(mapInboundMessage({ type: 'button', button: { text: 'Confirmar', payload: 'ok' } })).toMatchObject({ body: 'Confirmar' });
    expect(mapInboundMessage({ type: 'reaction', reaction: { emoji: '👍' } })).toBe('ignore');
    // Flows (nfm_reply) e respostas sem título nunca geram corpo vazio
    expect(mapInboundMessage({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', response_json: '{}' } } })).toMatchObject({ kind: 'TEXT', body: '[Resposta interativa recebida]' });
    expect(mapInboundMessage({ type: 'sticker', sticker: { id: 'm1', mime_type: 'image/webp' } })).toMatchObject({ kind: 'IMAGE' });

    const ctx = await setup();
    const from = '5563988880004';
    const loc = { from, id: 'wamid.LOC1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'location', location: { latitude: -10.18, longitude: -48.33, name: 'Fórum de Palmas' } };
    const react = { from, id: 'wamid.REACT1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } };
    expect((await webhook(ctx, msgPayload(ctx, [loc, react]))).statusCode).toBe(200);
    const rows = await prisma.bvMessage.findMany({ where: { orgId: ctx.orgId } });
    expect(rows.map((r) => r.channelMessageId)).toEqual(['wamid.LOC1']);
    expect((rows[0].channelMeta as any).wa.location.latitude).toBe(-10.18);
  });

  it('imagem: baixa pela Graph (id → url → bytes), grava no storage e registra o anexo', async () => {
    const ctx = await setup();
    const data = crypto.randomBytes(2048);
    graph.files.set('media-in-1', { mime: 'image/jpeg', data });
    const from = '5563988880005';
    const m = { from, id: 'wamid.IMG1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'media-in-1', mime_type: 'image/jpeg', caption: 'foto do documento' } };
    expect((await webhook(ctx, msgPayload(ctx, [m]))).statusCode).toBe(200);
    await drainWhatsappBackground();
    const row = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: 'wamid.IMG1' } });
    expect(row.kind).toBe('IMAGE');
    const att = (row.attachments as any[])[0];
    expect(att.mime).toBe('image/jpeg');
    expect(att.size).toBe(2048);
    expect(att.key.startsWith(`${ctx.orgId}/attachments/`)).toBe(true);
    expect((await getObjectBuffer(att.key)).equals(data)).toBe(true);
    expect((row.channelMeta as any).wa.mediaStatus).toBe('STORED');
    expect((await listMessages(row.conversationId))[0].body).toBe('foto do documento');
    expect(graph.callsTo(/\/v23\.0\/media-in-1$/).length).toBe(1);
  });

  it('mídia: falha transitória deixa PENDING e o job reprocessa; sha256 divergente não é aceito', async () => {
    const ctx = await setup();
    graph.files.set('media-in-2', { mime: 'application/pdf', data: Buffer.from('%PDF-1.4 teste') });
    const m = { from: '5563988880006', id: 'wamid.DOC1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document: { id: 'media-in-2', mime_type: 'application/pdf', filename: '../../etc/laudo.pdf' } };
    graph.mediaFailures.push({ status: 500 }, { status: 500 }, { status: 500 }); // esgota os retries do 1º ciclo
    await webhook(ctx, msgPayload(ctx, [m]));
    await drainWhatsappBackground();
    let row = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: 'wamid.DOC1' } });
    expect((row.channelMeta as any).wa.mediaStatus).toBe('PENDING');
    expect(row.attachments).toEqual([]);
    await retryPendingMedia();
    row = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: 'wamid.DOC1' } });
    expect((row.channelMeta as any).wa.mediaStatus).toBe('STORED');
    expect((row.attachments as any[])[0].name).toBe('laudo.pdf'); // sem path traversal

    graph.files.set('media-in-3', { mime: 'image/png', data: Buffer.from('abc'), sha256: 'a'.repeat(64) });
    const bad = { from: '5563988880006', id: 'wamid.IMG2', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'media-in-3', mime_type: 'image/png' } };
    await webhook(ctx, msgPayload(ctx, [bad]));
    await drainWhatsappBackground();
    const r2 = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: 'wamid.IMG2' } });
    expect(r2.attachments).toEqual([]);
    expect((r2.channelMeta as any).wa.mediaStatus).toBe('PENDING');
  });

  it('URL de mídia só de hosts da Meta (anti-SSRF)', () => {
    const cfg: any = {};
    expect(trustedMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', cfg)).toBe(true);
    expect(trustedMediaUrl('http://lookaside.fbsbx.com/x', cfg)).toBe(false);
    expect(trustedMediaUrl('https://169.254.169.254/latest', cfg)).toBe(false);
    expect(trustedMediaUrl('https://fbsbx.com.evil.io/x', cfg)).toBe(false);
    expect(trustedMediaUrl(`${graph.base}/files/x`, { apiBase: graph.base } as any)).toBe(true);
  });

  it('falha de persistência → 500 (a Meta reenvia) e a reentrega é idempotente', async () => {
    const ctx = await setup();
    const spy = jest.spyOn(prisma.bvContact, 'findFirst').mockRejectedValueOnce(new Error('db fora'));
    const lookup = jest.spyOn(prisma.bvContactIdentity, 'findUnique').mockRejectedValueOnce(new Error('db fora'));
    const m = textMsg('5563988880007', 'não pode se perder');
    const r1 = await webhook(ctx, msgPayload(ctx, [m]));
    spy.mockRestore(); lookup.mockRestore();
    expect(r1.statusCode).toBe(500);
    expect((await webhook(ctx, msgPayload(ctx, [m]))).statusCode).toBe(200);
    expect(await prisma.bvMessage.count({ where: { orgId: ctx.orgId, channelMessageId: m.id } })).toBe(1);
  });
});

describe('whatsapp — saída: janela, mídia, retries', () => {
  it('dentro da janela envia texto livre pela Graph e guarda o wamid', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770001');
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, body: 'Olá, como posso ajudar?' });
    expect(r.error).toBeUndefined();
    expect(r.message.status).toBe('SENT');
    expect(r.message.channelMessageId).toMatch(/^wamid\.OUT/);
    const call = graph.callsTo(/\/messages$/, 'POST').pop()!;
    expect(call.json).toMatchObject({ messaging_product: 'whatsapp', to: '5563977770001', type: 'text', text: { body: 'Olá, como posso ajudar?' } });
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.path).toBe(`/v23.0/${ctx.phoneNumberId}/messages`);
  });

  it('fora da janela de 24 h → whatsapp.outside_window sem chamar a Graph (usar template)', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770002');
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    graph.reset();
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, body: 'tarde demais' });
    expect(r.error).toBe('whatsapp.outside_window');
    expect(r.message.status).toBe('FAILED');
    expect(graph.callsTo(/\/messages$/).length).toBe(0);
  });

  it('windowHours do órgão é respeitado', async () => {
    const ctx = await setup({}, { whatsapp: { windowHours: 1 } });
    const { conversationId } = await inbound(ctx, '5563977770003');
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Date.now() - 2 * 3600_000) } });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'oi' });
    expect(r.error).toBe('whatsapp.outside_window');
  });

  it('erro 131047 da Graph (janela expirada do ponto de vista da Meta) vira whatsapp.outside_window', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770004');
    graph.messageFailures.push({ status: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'oi' });
    expect(r.error).toBe('whatsapp.outside_window');
    expect(graph.callsTo(/\/messages$/).length).toBe(1); // não repete erro permanente
  });

  it('retry com backoff em 5xx; sucesso na 3ª tentativa', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770005');
    const sleeps: number[] = [];
    configureWaRuntime({ sleep: async (ms) => { sleeps.push(ms); } });
    graph.messageFailures.push({ status: 500 }, { status: 503 });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'tentando' });
    configureWaRuntime({ sleep: async () => undefined });
    expect(r.error).toBeUndefined();
    expect(graph.callsTo(/\/messages$/).length).toBe(3);
    expect(sleeps.length).toBe(2);
    expect(sleeps[1]).toBeGreaterThanOrEqual(sleeps[0]);
  });

  it('429/130429 persistente esgota as tentativas → whatsapp.rate_limited (respeita Retry-After)', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770006');
    const sleeps: number[] = [];
    configureWaRuntime({ sleep: async (ms) => { sleeps.push(ms); }, maxDelayMs: 10_000 });
    for (let i = 0; i < 3; i++) graph.messageFailures.push({ status: 429, body: { error: { message: 'rate', code: 130429 } }, headers: { 'retry-after': '1' } });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x' });
    configureWaRuntime({ sleep: async () => undefined, maxDelayMs: 5 });
    expect(r.error).toBe('whatsapp.rate_limited');
    expect(graph.callsTo(/\/messages$/).length).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('número inválido 131026 → whatsapp.invalid_recipient sem retry; token inválido → auth_failed', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770007');
    graph.messageFailures.push({ status: 400, body: { error: { message: 'Message undeliverable', code: 131026 } } });
    expect((await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x' })).error).toBe('whatsapp.invalid_recipient');
    graph.reset(); graph.failAuth = true;
    expect((await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x' })).error).toBe('whatsapp.auth_failed');
    expect(graph.callsTo(/\/messages$/).length).toBe(1);
  });

  it('sem integração configurada/desabilitada → erros estáveis', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const r = await ingestInbound({ orgId: org.id, channel: 'WHATSAPP', channelRef: '5563977770008', externalId: '5563977770008', message: { body: 'oi' } });
    expect((await sendMessage({ orgId: org.id, conversationId: r.conversation.id, senderType: 'BOT', body: 'x' })).error).toBe('whatsapp.not_configured');
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770009');
    await prisma.bvIntegration.updateMany({ where: { orgId: ctx.orgId, type: 'WHATSAPP' }, data: { enabled: false } });
    expect((await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x' })).error).toBe('whatsapp.disabled');
  });

  it('texto longo é dividido; botões interativos são enviados', async () => {
    expect(splitText('a'.repeat(5000)).every((c) => c.length <= 4096)).toBe(true);
    expect(splitText('um\n\ndois', 5)).toEqual(['um', 'dois']);
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770010');
    await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'Escolha', channelMeta: { interactive: { type: 'button', buttons: [{ id: 'a', title: 'Certidão' }, { id: 'b', title: 'Processo' }] } } });
    const call = graph.callsTo(/\/messages$/, 'POST').pop()!;
    expect(call.json.type).toBe('interactive');
    expect(call.json.interactive.action.buttons).toHaveLength(2);
    const bad = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x', channelMeta: { interactive: { type: 'button', buttons: [] } } });
    expect(bad.error).toBe('whatsapp.invalid_parameter');
  });

  it('mídia: sobe o arquivo do storage à Graph (multipart) e envia com o media id; anexo de outro órgão é recusado', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563977770011');
    const key = newKey(ctx.orgId, 'attachments', 'pdf');
    await putObject(key, Buffer.from('%PDF-1.4 conteúdo'));
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, kind: 'DOCUMENT', body: 'Segue a certidão', attachments: [{ key, name: 'certidao.pdf', mime: 'application/pdf', size: 20 }] });
    expect(r.error).toBeUndefined();
    const up = graph.callsTo(/\/media$/, 'POST').pop()!;
    expect(up.headers['content-type']).toContain('multipart/form-data');
    expect(up.raw!.toString('latin1')).toContain('%PDF-1.4');
    const send = graph.callsTo(/\/messages$/, 'POST').pop()!;
    expect(send.json).toMatchObject({ type: 'document', document: { id: expect.stringMatching(/^media-up-/), caption: 'Segue a certidão', filename: 'certidao.pdf' } });

    const foreign = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, kind: 'DOCUMENT', attachments: [{ key: newKey('outro-org', 'attachments', 'pdf'), name: 'x.pdf', mime: 'application/pdf', size: 1 }] });
    expect(foreign.error).toBe('whatsapp.invalid_attachment');
    const exe = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, kind: 'IMAGE', attachments: [{ key, name: 'x.gif', mime: 'image/gif', size: 1 }] });
    expect(exe.error).toBe('whatsapp.unsupported_media');
  });
});

describe('whatsapp — status de entrega', () => {
  it('sent → delivered → read atualiza BvMessage; status atrasado não rebaixa', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563966660001');
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'oi' });
    const wamid = r.message.channelMessageId!;
    const st = async (status: string, extra: any = {}) => webhook(ctx, statusPayload(ctx, [{ id: wamid, status, timestamp: '1', recipient_id: '5563966660001', ...extra }]));
    expect((await st('delivered', { pricing: { billable: true, category: 'service' } })).statusCode).toBe(200);
    let row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } });
    expect(row.status).toBe('DELIVERED');
    expect((row.channelMeta as any).wa.billedCategory).toBe('service');
    await st('read');
    expect((await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } })).status).toBe('READ');
    await st('delivered');
    row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } });
    expect(row.status).toBe('READ');
  });

  it('failed com 131047/131026/130429/132001 vira errorCode estável', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563966660002');
    const cases: Array<[number, string]> = [[131047, 'whatsapp.outside_window'], [131026, 'whatsapp.invalid_recipient'], [130429, 'whatsapp.rate_limited'], [132001, 'whatsapp.template_not_approved']];
    for (const [code, expected] of cases) {
      const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: `t${code}` });
      await webhook(ctx, statusPayload(ctx, [{ id: r.message.channelMessageId, status: 'failed', timestamp: '1', errors: [{ code, title: 'x' }] }]));
      const row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } });
      expect([row.status, row.errorCode]).toEqual(['FAILED', expected]);
    }
    expect(mapGraphErrorCode(999999, 503)).toBe('whatsapp.unavailable');
  });

  it('status de wamid de outro órgão não altera nada (isolamento)', async () => {
    const a = await setup(); const b = await setup();
    const { conversationId } = await inbound(a, '5563966660003');
    const r = await sendMessage({ orgId: a.orgId, conversationId, senderType: 'BOT', body: 'oi' });
    await webhook(b, statusPayload(b, [{ id: r.message.channelMessageId, status: 'read', timestamp: '1' }]));
    expect((await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } })).status).toBe('SENT');
  });

  it('status que chega antes do wamid ser gravado é reaplicado em segundo plano', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563966660004');
    configureWaRuntime({ statusRetryDelaysMs: [150, 150], sleep: (ms) => new Promise((res) => setTimeout(res, ms)) });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'oi' });
    const wamid = r.message.channelMessageId!;
    await prisma.bvMessage.update({ where: { id: r.message.id }, data: { channelMessageId: null } }); // simula a corrida
    await webhook(ctx, statusPayload(ctx, [{ id: wamid, status: 'delivered', timestamp: '1' }]));
    await prisma.bvMessage.update({ where: { id: r.message.id }, data: { channelMessageId: wamid } });
    await drainWhatsappBackground();
    configureWaRuntime({ statusRetryDelaysMs: [], sleep: async () => undefined });
    expect((await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } })).status).toBe('DELIVERED');
  });
});

describe('whatsapp — templates, cotas e consumo', () => {
  it('validação de componentes, parâmetros e renderização', () => {
    expect(validateTemplateComponents([{ type: 'BODY', text: 'Olá {{1}}.', example: { body_text: [['Ana']] } }], 'UTILITY')).toEqual([]);
    expect(validateTemplateComponents([{ type: 'BODY', text: 'Olá {{1}} e {{3}}.' }], 'UTILITY').join('|')).toMatch(/sequenciais/);
    expect(validateTemplateComponents([{ type: 'BODY', text: '{{1}} oi' }], 'UTILITY').join('|')).toMatch(/começar/);
    expect(validateTemplateComponents([{ type: 'BODY', text: 'Olá {{1}}.' }], 'UTILITY').join('|')).toMatch(/example/);
    expect(validateTemplateComponents([{ type: 'FOOTER', text: 'x' }], 'UTILITY')).toContain('BODY é obrigatório');
    expect(validateTemplateComponents([{ type: 'BODY', text: 'ok' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'http://x.com' }] }], 'UTILITY').join('|')).toMatch(/https/);
    expect(validateTemplateComponents([{ type: 'BODY', text: 'Texto simples sem variáveis' }, { type: 'FOOTER', text: 'TJ-TO' }], 'MARKETING')).toEqual([]);
    const stored = [{ type: 'BODY', text: 'Olá {{1}}, audiência em {{2}}.' }, { type: 'FOOTER', text: 'TJ-TO' }];
    expect(buildTemplateComponents(stored, { params: ['Ana\nSilva', '10/12'] })).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Ana Silva' }, { type: 'text', text: '10/12' }] }]);
    expect(() => buildTemplateComponents(stored, { params: ['Ana'] })).toThrow(TemplateParamError);
    expect(renderTemplateText(stored, { params: ['Ana', '10/12'] })).toBe('Olá Ana, audiência em 10/12.\n\nTJ-TO');
  });

  it('CRUD local → submit à Meta (PENDING) → sync traz APPROVED/REJECTED com motivo; webhook também atualiza', async () => {
    const ctx = await setup();
    const body = { name: 'lembrete_audiencia', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}, sua audiência é em {{2}}.', example: { body_text: [['Maria', '10/12']] } }] };
    const bad = await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: ctx.h, payload: { ...body, name: 'Nome Inválido' } });
    expect(bad.statusCode).toBe(400);
    const badComp = await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: ctx.h, payload: { ...body, components: [{ type: 'BODY', text: 'x {{2}}.' }] } });
    expect(badComp.statusCode).toBe(400);
    expect(badComp.json().error.code).toBe('whatsapp.template_invalid');
    const created = await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: ctx.h, payload: body });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().status).toBe('DRAFT');
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: ctx.h, payload: body })).statusCode).toBe(409);

    const upd = await app.inject({ method: 'PUT', url: `/balcao/whatsapp/templates/${id}`, headers: ctx.h, payload: { category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}, sua audiência foi marcada para {{2}}.', example: { body_text: [['Maria', '10/12']] } }] } });
    expect(upd.statusCode).toBe(200);

    const sub = await app.inject({ method: 'POST', url: `/balcao/whatsapp/templates/${id}/submit`, headers: ctx.h });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().status).toBe('PENDING');
    expect(sub.json().metaTemplateId).toMatch(/^tpl-/);
    const post = graph.callsTo(/message_templates$/, 'POST').pop()!;
    expect(post.path).toBe(`/v23.0/${ctx.wabaId}/message_templates`);
    expect(post.json).toMatchObject({ name: 'lembrete_audiencia', language: 'pt_BR', category: 'UTILITY' });
    expect((await app.inject({ method: 'PUT', url: `/balcao/whatsapp/templates/${id}`, headers: ctx.h, payload: { category: 'UTILITY', components: body.components } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/balcao/whatsapp/templates/${id}/submit`, headers: ctx.h })).statusCode).toBe(409);

    // Meta aprova um e rejeita outro (que só existe lá); sync importa.
    graph.templates[0].status = 'APPROVED';
    graph.templates.push({ id: 'tpl-x', name: 'promo_x', language: 'pt_BR', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'INVALID_FORMAT', components: [{ type: 'BODY', text: 'Promoção' }] });
    const sync = await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates/sync', headers: ctx.h });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toMatchObject({ created: 1, updated: 1, total: 2 });
    expect((await prisma.bvWaTemplate.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
    const rej = await prisma.bvWaTemplate.findFirstOrThrow({ where: { orgId: ctx.orgId, name: 'promo_x' } });
    expect([rej.status, rej.rejectedReason, rej.category]).toEqual(['REJECTED', 'INVALID_FORMAT', 'MARKETING']);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates/sync', headers: ctx.h })).json()).toMatchObject({ created: 0, updated: 0, unchanged: 2 });

    // webhook de aprovação (identificado pela WABA)
    const hook = { object: 'whatsapp_business_account', entry: [{ id: ctx.wabaId, changes: [{ field: 'message_template_status_update', value: { event: 'PAUSED', message_template_name: 'lembrete_audiencia', message_template_language: 'pt_BR', reason: 'NONE' } }] }] };
    expect((await webhook(ctx, hook)).statusCode).toBe(200);
    expect((await prisma.bvWaTemplate.findUniqueOrThrow({ where: { id } })).status).toBe('PAUSED');

    expect((await app.inject({ method: 'DELETE', url: `/balcao/whatsapp/templates/${id}`, headers: ctx.h })).statusCode).toBe(204);
    expect(graph.callsTo(/message_templates$/, 'DELETE')).toHaveLength(1);
  });

  it('send-template: rejeita não aprovado, valida parâmetros, abre conversa, conta WA_UTILITY e WA_MARKETING', async () => {
    const ctx = await setup();
    const draft = await makeTemplate(ctx, { status: 'PENDING' });
    const post = (p: any) => app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: ctx.h, payload: p });
    const r0 = await post({ phone: '(63) 99999-1111', templateName: draft.name, params: ['Ana', '10/12'] });
    expect(r0.statusCode).toBe(422);
    expect(r0.json().error.code).toBe('whatsapp.template_not_approved');
    expect(await prisma.bvConversation.count({ where: { orgId: ctx.orgId } })).toBe(0); // não abriu conversa à toa

    const util = await makeTemplate(ctx);
    const mk = await makeTemplate(ctx, { category: 'MARKETING', components: [{ type: 'BODY', text: 'Conheça o Balcão Virtual do TJ-TO' }] });
    expect((await post({ phone: '63999991111', templateName: util.name, params: ['Ana'] })).json().error.code).toBe('whatsapp.template_params_mismatch');

    const ok = await post({ phone: '(63) 99999-1111', templateName: util.name, params: ['Ana', '10/12'] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().usageItem).toBe('WA_UTILITY');
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: ok.json().conversationId } });
    expect([conv.channel, conv.status, conv.assignedUserId, conv.channelRef]).toEqual(['WHATSAPP', 'ACTIVE', ctx.admin.id, '5563999991111']);
    const sent = graph.callsTo(/\/messages$/, 'POST').pop()!;
    expect(sent.json).toMatchObject({ to: '5563999991111', type: 'template', template: { name: util.name, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '10/12' }] }] } });
    const msgs = await listMessages(conv.id);
    expect(msgs[0]).toMatchObject({ kind: 'TEMPLATE', status: 'SENT', body: 'Olá Ana, sua audiência é em 10/12.\n\nTJ-TO' });

    // 2º envio ao mesmo número reaproveita a conversa; marketing conta em WA_MARKETING
    const mkr = await post({ conversationId: conv.id, templateName: mk.name });
    expect(mkr.statusCode).toBe(201);
    expect(mkr.json().conversationId).toBe(conv.id);
    expect(await usage(ctx.orgId, 'WA_UTILITY')).toBe(1);
    expect(await usage(ctx.orgId, 'WA_MARKETING')).toBe(1);
    expect(await usage(ctx.orgId, 'WA_SERVICE')).toBe(0); // template enviado por nós não é conversa de serviço
    // por contactId
    const again = await post({ contactId: conv.contactId, templateName: util.name, params: ['Bia', '11/12'] });
    expect(again.statusCode).toBe(201);
    expect(again.json().conversationId).toBe(conv.id);
    expect(await usage(ctx.orgId, 'WA_UTILITY')).toBe(2);
  });

  it('cota BLOCK impede o template (quota_exceeded, 429) sem chamar a Graph nem consumir', async () => {
    const ctx = await setup();
    const tpl = await makeTemplate(ctx, { components: [{ type: 'BODY', text: 'Aviso importante do tribunal' }] });
    await prisma.bvQuota.create({ data: { orgId: ctx.orgId, item: 'WA_UTILITY', period: 'DAY', limit: 1n, action: 'BLOCK' } });
    const post = () => app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: ctx.h, payload: { phone: '63988887777', templateName: tpl.name } });
    expect((await post()).statusCode).toBe(201);
    graph.reset();
    const blocked = await post();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('whatsapp.quota_exceeded');
    expect(graph.callsTo(/\/messages$/).length).toBe(0);
    expect(await usage(ctx.orgId, 'WA_UTILITY')).toBe(1);

    // pelo caminho do núcleo (sendMessage) a falha fica registrada na mensagem
    const conv = await prisma.bvConversation.findFirstOrThrow({ where: { orgId: ctx.orgId } });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId: conv.id, senderType: 'AGENT', userId: ctx.admin.id, kind: 'TEMPLATE', body: 'x', channelMeta: { templateName: tpl.name, language: 'pt_BR' } });
    expect(r.error).toBe('whatsapp.quota_exceeded');
    expect(r.message.status).toBe('FAILED');
  });

  it('cota ALERT não bloqueia; template não aprovado pelo núcleo → template_not_approved; falha da Graph não consome', async () => {
    const ctx = await setup();
    const tpl = await makeTemplate(ctx, { category: 'MARKETING', components: [{ type: 'BODY', text: 'Campanha de conciliação' }] });
    await prisma.bvQuota.create({ data: { orgId: ctx.orgId, item: 'WA_MARKETING', period: 'DAY', limit: 1n, action: 'ALERT' } });
    const { conversationId } = await inbound(ctx, '5563955550001');
    const send = (name: string) => sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, kind: 'TEMPLATE', body: 'x', channelMeta: { templateName: name, language: 'pt_BR' } });
    expect((await send(tpl.name)).error).toBeUndefined();
    expect((await send(tpl.name)).error).toBeUndefined();
    expect(await usage(ctx.orgId, 'WA_MARKETING')).toBe(2);
    expect((await send('nao_existe')).error).toBe('whatsapp.template_not_approved');
    graph.messageFailures.push({ status: 400, body: { error: { message: 'x', code: 132001 } } });
    expect((await send(tpl.name)).error).toBe('whatsapp.template_not_approved');
    expect(await usage(ctx.orgId, 'WA_MARKETING')).toBe(2);
  });

  it('template funciona fora da janela de 24 h (é o caminho oficial)', async () => {
    const ctx = await setup();
    const tpl = await makeTemplate(ctx, { components: [{ type: 'BODY', text: 'Sua solicitação foi atualizada' }] });
    const { conversationId } = await inbound(ctx, '5563955550002');
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Date.now() - 48 * 3600_000) } });
    const r = await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'AGENT', userId: ctx.admin.id, kind: 'TEMPLATE', body: 'x', channelMeta: { templateName: tpl.name, language: 'pt_BR' } });
    expect(r.error).toBeUndefined();
    expect(r.message.status).toBe('SENT');
    expect(await usage(ctx.orgId, 'WA_UTILITY')).toBe(1);
  });

  it('atendente sem acesso à conversa de outro agente não dispara template nela', async () => {
    const ctx = await setup();
    const tpl = await makeTemplate(ctx, { components: [{ type: 'BODY', text: 'Aviso' }] });
    const owner = await makeUser(ctx.orgId, 'ATENDENTE');
    const other = await makeUser(ctx.orgId, 'ATENDENTE');
    const { conversationId } = await inbound(ctx, '5563955550003');
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { assignedUserId: owner.id, status: 'ACTIVE' } });
    const r = await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: authHeader(other), payload: { conversationId, templateName: tpl.name } });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: authHeader(owner), payload: { conversationId, templateName: tpl.name } });
    expect(ok.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: authHeader(owner), payload: { templateName: tpl.name } })).statusCode).toBe(400);
  });
});

describe('whatsapp — configuração e saúde', () => {
  it('PUT /config cria, mascara segredos, gera verifyToken, exige campos e preserva segredo omitido/mascarado', async () => {
    const org = await makeOrg(); const admin = await makeUser(org.id, 'ADMIN'); const h = authHeader(admin);
    const none = await app.inject({ url: '/balcao/whatsapp/config', headers: h });
    expect(none.json()).toMatchObject({ configured: false, status: 'UNCONFIGURED', config: null });
    expect((await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { phoneNumberId: rand() } })).statusCode).toBe(400);
    const c = { accessToken: TOKEN, phoneNumberId: rand(), wabaId: rand(), appSecret: 'segredo-app-123', apiBase: graph.base };
    graph.wabaIds.add(c.wabaId);
    const put = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: c });
    expect(put.statusCode).toBe(200);
    const view = put.json();
    expect(view.configured).toBe(true);
    expect(view.config.accessToken).toBe('••••••');
    expect(view.config.appSecret).toBe('••••••');
    expect(view.config.phoneNumberId).toBe(c.phoneNumberId);
    expect(JSON.stringify(view.config)).not.toContain(TOKEN);
    expect(view.webhook.url).toMatch(/\/balcao\/whatsapp\/webhook$/);
    expect(view.webhook.verifyToken.length).toBeGreaterThan(16);
    const vt = view.webhook.verifyToken;
    // segredo em repouso está cifrado
    const raw = await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: org.id, type: 'WHATSAPP' } });
    expect(raw.configEnc).not.toContain(TOKEN);
    // reenviar com placeholder não sobrescreve
    const again = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { accessToken: '••••••', graphVersion: 'v22.0' } });
    expect(again.json().webhook.verifyToken).toBe(vt);
    const t = await app.inject({ method: 'POST', url: '/balcao/whatsapp/config/test', headers: h });
    expect(t.json()).toMatchObject({ ok: true, phone: { verifiedName: 'TJ Teste', qualityRating: 'GREEN' } });
    expect(graph.callsTo(/\/v22\.0\//).length).toBeGreaterThan(0); // graphVersion respeitada
    expect((await app.inject({ url: '/balcao/whatsapp/config', headers: h })).json().status).toBe('OK');
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'whatsapp.config.update' } })).toBe(2);
    // o webhook agora resolve este órgão
    invalidateWaConfigCache();
    const body = JSON.stringify(msgPayload(c, [textMsg('5563944440001', 'oi')]));
    const w = await app.inject({ method: 'POST', url: '/balcao/whatsapp/webhook', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, c.appSecret) } });
    expect(w.statusCode).toBe(200);
    expect(await prisma.bvMessage.count({ where: { orgId: org.id } })).toBe(1);
  });

  it('config/test com token inválido → ok:false e status ERROR; health reflete', async () => {
    const ctx = await setup({ accessToken: 'token-invalido-123' });
    const t = await app.inject({ method: 'POST', url: '/balcao/whatsapp/config/test', headers: ctx.h });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ ok: false, error: { code: 'whatsapp.auth_failed' } });
    const hl = (await app.inject({ url: '/balcao/whatsapp/health', headers: ctx.h })).json();
    expect(hl).toMatchObject({ configured: true, enabled: true, status: 'ERROR', failedOutbound24h: 0, windowHours: 24 });
    expect(hl.lastError).toContain('190');
  });

  it('health: última entrada, falhas 24h e templates por status', async () => {
    const ctx = await setup();
    const { conversationId } = await inbound(ctx, '5563944440002');
    await prisma.bvConversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Date.now() - 30 * 3600_000) } });
    await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'BOT', body: 'x' }); // FAILED (fora da janela)
    await makeTemplate(ctx); await makeTemplate(ctx, { status: 'PENDING' });
    const hl = (await app.inject({ url: '/balcao/whatsapp/health', headers: ctx.h })).json();
    expect(hl.failedOutbound24h).toBe(1);
    expect(hl.lastInboundAt).toBeTruthy();
    expect(hl.templates).toEqual({ APPROVED: 1, PENDING: 1 });
  });

  it('permissões: só quem tem integration:manage mexe na config; atendente lista templates mas não cria', async () => {
    const ctx = await setup();
    const ag = authHeader(await makeUser(ctx.orgId, 'ATENDENTE'));
    const fiscal = authHeader(await makeUser(ctx.orgId, 'FISCAL'));
    expect((await app.inject({ url: '/balcao/whatsapp/config', headers: ag })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: ag, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ url: '/balcao/whatsapp/health', headers: ag })).statusCode).toBe(403);
    expect((await app.inject({ url: '/balcao/whatsapp/templates', headers: ag })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: ag, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: fiscal, payload: { phone: '63999990000', templateName: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/balcao/whatsapp/config' })).statusCode).toBe(401);
  });

  it('apiBase e mock só em dev; número/WABA não pode ser de dois órgãos', async () => {
    const a = await setup();
    const org = await makeOrg(); const h = authHeader(await makeUser(org.id, 'ADMIN'));
    const dup = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { accessToken: TOKEN, phoneNumberId: a.phoneNumberId, wabaId: rand(), appSecret: 'segredo-xyz-1' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('whatsapp.number_in_use');
    const dupWaba = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { accessToken: TOKEN, phoneNumberId: rand(), wabaId: a.wabaId, appSecret: 'segredo-xyz-1' } });
    expect(dupWaba.statusCode).toBe(409);
    process.env.BV_DEV_SIMULATORS = '0';
    const mock = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { mock: true } });
    process.env.BV_DEV_SIMULATORS = '1';
    expect(mock.statusCode).toBe(400);
    expect(mock.json().error.code).toBe('whatsapp.mock_disabled');
  });
});

describe('whatsapp — isolamento entre órgãos', () => {
  it('cada órgão só recebe o que é do seu número; assinatura de um não vale para o outro', async () => {
    const a = await setup(); const b = await setup();
    const same = '5563933330001'; // mesmo cidadão falando com dois órgãos
    await inbound(a, same, 'para A'); await inbound(b, same, 'para B');
    expect(await prisma.bvMessage.count({ where: { orgId: a.orgId } })).toBe(1);
    expect(await prisma.bvMessage.count({ where: { orgId: b.orgId } })).toBe(1);
    expect((await prisma.bvContact.findMany({ where: { orgId: a.orgId } })).length).toBe(1);
    expect((await webhook(a, msgPayload(a, [textMsg(same, 'forjada')]), b.appSecret)).statusCode).toBe(401);
    expect(await prisma.bvMessage.count({ where: { orgId: a.orgId } })).toBe(1);
    expect(await usage(a.orgId, 'WA_SERVICE')).toBe(1);
    expect(await usage(b.orgId, 'WA_SERVICE')).toBe(1);
    await makeTemplate(a, { name: 'so_do_a' });
    const listB = (await app.inject({ url: '/balcao/whatsapp/templates', headers: b.h })).json();
    expect(listB.find((t: any) => t.name === 'so_do_a')).toBeUndefined();
    const tA = await prisma.bvWaTemplate.findFirstOrThrow({ where: { orgId: a.orgId, name: 'so_do_a' } });
    expect((await app.inject({ url: `/balcao/whatsapp/templates/${tA.id}`, headers: b.h })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/balcao/whatsapp/templates/${tA.id}/submit`, headers: b.h })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: b.h, payload: { phone: same, templateName: 'so_do_a' } })).json().error.code).toBe('whatsapp.template_not_approved');
  });

  it('payload com duas entradas de órgãos distintos: cada uma exige a própria assinatura', async () => {
    const a = await setup(); const b = await setup();
    const payload = { object: 'whatsapp_business_account', entry: [msgPayload(a, [textMsg('5563933330002', 'a')]).entry[0], msgPayload(b, [textMsg('5563933330003', 'b')]).entry[0]] };
    const r = await webhook(a, payload); // assinado só com o segredo de A
    expect(r.statusCode).toBe(200);
    expect(await prisma.bvMessage.count({ where: { orgId: a.orgId } })).toBe(1);
    expect(await prisma.bvMessage.count({ where: { orgId: b.orgId } })).toBe(0);
  });
});

describe('whatsapp — modo mock e simulador de desenvolvimento', () => {
  it('mock: não chama a Graph, marca SENT, conta template e aprova template no submit', async () => {
    const org = await makeOrg({ ai: { enabled: false } }); const admin = await makeUser(org.id, 'ADMIN'); const h = authHeader(admin);
    const put = await app.inject({ method: 'PUT', url: '/balcao/whatsapp/config', headers: h, payload: { mock: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ configured: true, status: 'OK' });
    graph.reset();

    const sim = await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-inbound', headers: h, payload: { from: '(63) 99999-0000', name: 'Cidadão Demo', text: 'Quero certidão' } });
    expect(sim.statusCode).toBe(200);
    const { conversationId, wamid } = sim.json();
    expect(wamid).toMatch(/^wamid\.sim\./);
    expect(conversationId).toBeTruthy();
    expect(await getUsage(org.id, 'WA_SERVICE', ...day())).toBe(1);
    expect((await listMessages(conversationId))[0].body).toBe('Quero certidão');
    expect((await prisma.bvContact.findFirstOrThrow({ where: { orgId: org.id } })).name).toBe('Cidadão Demo');
    // idempotência do simulador não se aplica (wamid novo); a 2ª mensagem cai na mesma conversa
    const sim2 = await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-inbound', headers: h, payload: { from: '5563999990000', text: 'outra' } });
    expect(sim2.json().conversationId).toBe(conversationId);
    expect(await getUsage(org.id, 'WA_SERVICE', ...day())).toBe(1);

    const r = await sendMessage({ orgId: org.id, conversationId, senderType: 'AGENT', userId: admin.id, body: 'Já providenciamos' });
    expect(r.message.status).toBe('SENT');
    expect(r.message.channelMessageId).toMatch(/^wamid\.mock\./);
    const st = await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-status', headers: h, payload: { wamid: r.message.channelMessageId, status: 'read' } });
    expect(st.json().ok).toBe(true);
    expect((await prisma.bvMessage.findUniqueOrThrow({ where: { id: r.message.id } })).status).toBe('READ');

    const t = await app.inject({ method: 'POST', url: '/balcao/whatsapp/templates', headers: h, payload: { name: 'demo_aviso', category: 'MARKETING', components: [{ type: 'BODY', text: 'Novidade do Balcão Virtual' }] } });
    const sub = await app.inject({ method: 'POST', url: `/balcao/whatsapp/templates/${t.json().id}/submit`, headers: h });
    expect(sub.json().status).toBe('APPROVED');
    const send = await app.inject({ method: 'POST', url: '/balcao/whatsapp/send-template', headers: h, payload: { conversationId, templateName: 'demo_aviso' } });
    expect(send.statusCode).toBe(201);
    expect(await getUsage(org.id, 'WA_MARKETING', ...day())).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/config/test', headers: h })).json()).toMatchObject({ ok: true, mock: true });
    expect(graph.calls.length).toBe(0);
  });

  it('simulador exige o órgão autenticado e valida a entrada', async () => {
    const ctx = await setup();
    const other = await makeOrg();
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-inbound', headers: ctx.h, payload: { orgId: other.id, from: '5563999990000', text: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-inbound', headers: ctx.h, payload: { from: '1', text: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/balcao/whatsapp/dev/simulate-inbound', payload: { from: '5563999990000', text: 'x' } })).statusCode).toBe(401);
  });
});
