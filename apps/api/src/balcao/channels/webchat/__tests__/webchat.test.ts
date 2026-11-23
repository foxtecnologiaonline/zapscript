process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';
process.env.BV_STORAGE_DIR = process.env.BV_STORAGE_DIR || require('path').join(require('os').tmpdir(), 'bv-storage-webchat-test');

import crypto from 'crypto';
import http from 'http';
import vm from 'vm';
import WebSocket from 'ws';
import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import Fastify from 'fastify';
import { authHeader, makeOrg, makeUser } from '../../../core/testing';
import { addNote, closeConversation, ingestInbound, sendMessage } from '../../../core/conversations';
import { resolveContact } from '../../../core/contacts';
import { updateOrgSettings } from '../../../core/settings';
import { getUsage } from '../../../core/usage';
import { attachBalcaoSockets } from '../../../core/realtime';
import { attachVisitorNamespace } from '../socket';
import { WIDGET_JS } from '../widgetSource';
import { hashToken } from '../../../core/crypto';

let app: FastifyInstance;
const ENV_KEYS = ['BV_WEBCHAT_ENFORCE_ORIGIN', 'BV_WEBCHAT_RL_MSG', 'BV_WEBCHAT_RL_SESSIONS', 'BV_WEBCHAT_MAX_ATTACHMENT_MB', 'BV_WEBCHAT_RL_ATTACH', 'BV_JITSI_BASE_URL', 'BV_WEBCHAT_MAX_MESSAGE_CHARS', 'BV_WEBCHAT_SESSION_TTL_SEC'];
const rnd = () => crypto.randomBytes(4).toString('hex');
const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** App mínimo só com o plugin do webchat (o plugin raiz carrega as demais frentes, fora do escopo destes testes). */
async function buildApp(): Promise<FastifyInstance> {
  const a = Fastify({ logger: false, trustProxy: true });
  a.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try { const t = body.toString().trim(); done(null, t ? JSON.parse(t) : {}); } catch (e: any) { done(e); }
  });
  const { default: webchat } = await import('../index');
  await a.register(webchat, { prefix: '/balcao/webchat' });
  await a.ready();
  return a;
}
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

/** Órgão com IA desligada (conversa vai direto para a fila humana). */
async function org(webchat: Record<string, unknown> = {}) {
  return makeOrg({ ai: { enabled: false }, webchat });
}

interface V { token: string; ip: string; slug: string; orgId: string }
const H = (v: V, extra: Record<string, string> = {}) => ({ 'x-visitor-token': v.token, 'x-forwarded-for': v.ip, ...extra });

async function session(o: { id: string; slug: string }, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<V> {
  const ip = ipOf();
  const res = await app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ip, ...headers }, payload: { org: o.slug, ...body } });
  expect(res.statusCode).toBe(201);
  return { token: res.json().token, ip, slug: o.slug, orgId: o.id };
}

const say = (v: V, text: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/balcao/webchat/public/messages', headers: H(v), payload: { text, ...extra } });
const poll = (v: V, q = '') => app.inject({ method: 'GET', url: `/balcao/webchat/public/messages${q}`, headers: H(v) });

async function convOf(v: V) {
  const s = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(v.token) } });
  return prisma.bvConversation.findFirstOrThrow({ where: { id: s.conversationId!, orgId: v.orgId } });
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
function multipart(file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) {
  const b = `----bv${rnd()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}
const upload = (v: V, file: Parameters<typeof multipart>[0], fields?: Record<string, string>) => {
  const m = multipart(file, fields);
  return app.inject({ method: 'POST', url: '/balcao/webchat/public/attachments', headers: H(v, { 'content-type': m.contentType }), payload: m.payload });
};

// ── widget.js e demo ──────────────────────────────────────────────────────────
describe('webchat — widget.js e demo', () => {
  it('serve o script com CORP cross-site, cache/ETag e 304', async () => {
    const res = await app.inject({ method: 'GET', url: '/balcao/webchat/widget.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-site');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['cache-control'])).toMatch(/max-age=\d+/);
    const etag = String(res.headers.etag);
    expect(etag).toBeTruthy();
    expect(res.body).toBe(WIDGET_JS);
    const again = await app.inject({ method: 'GET', url: '/balcao/webchat/widget.js', headers: { 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
  });

  it('o script é JS válido, sem dependências externas e de tamanho contido', () => {
    expect(() => new vm.Script(WIDGET_JS)).not.toThrow();
    expect(Buffer.byteLength(WIDGET_JS)).toBeLessThan(32 * 1024);
    expect(WIDGET_JS).not.toMatch(/\bimport\s*\(|\brequire\s*\(|<script/);
    // único host externo permitido: VLibras (opt-in por data-vlibras)
    const hosts = [...WIDGET_JS.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/^(www\.)?w3\.org$/.test(h));
    expect(new Set(hosts)).toEqual(new Set(['vlibras.gov.br']));
  });

  it('acessibilidade estática: ARIA, foco preso, Esc, teclado, alto contraste, movimento reduzido, Shadow DOM', () => {
    const must = ['aria-live', "role: 'dialog'", "role: 'log'", "role: 'status'", "role: 'alert'", "'aria-modal'", "'aria-labelledby'", "'aria-label'", "'aria-expanded'", "'aria-pressed'",
      'attachShadow', "'Escape'", "'Tab'", 'prefers-reduced-motion', 'prefers-contrast', "tabindex: '0'", '.hc ', 'data-vlibras', 'vlibras-plugin.js', "h('fieldset'", 'legend', "type: 'radio'", "max-width:480px"];
    for (const s of must) expect(WIDGET_JS).toContain(s);
    // aria-live="polite" na região de mensagens
    expect(WIDGET_JS).toMatch(/role: 'log', 'aria-live': 'polite'/);
    // todo campo de formulário tem rótulo associado (label for / aria-label)
    for (const id of ['bv-n', 'bv-e', 'bv-m']) expect(WIDGET_JS).toContain(`for: '${id}'`);
    expect(WIDGET_JS).toMatch(/<label|h\('label'/);
    // nunca insere HTML vindo do servidor (XSS): innerHTML só com literais estáticos
    const uses = [...WIDGET_JS.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const u of uses) expect(u.startsWith("'<")).toBe(true);
    expect(WIDGET_JS).toContain('X-Visitor-Token');
  });

  it('demo: HTML acessível com o widget embutido e slug escapado/validado', async () => {
    const o = await org();
    const res = await app.inject({ method: 'GET', url: `/balcao/webchat/demo?org=${o.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<html lang="pt-BR">');
    expect(res.body).toContain(`data-org="${o.slug}"`);
    expect(res.body).toContain('/balcao/webchat/widget.js');
    const evil = await app.inject({ method: 'GET', url: `/balcao/webchat/demo?org=${encodeURIComponent('"><script>alert(1)</script>')}` });
    expect(evil.body).not.toContain('<script>alert');
    expect(evil.body).not.toMatch(/<script[^>]*data-org/);
  });
});

// ── config pública ────────────────────────────────────────────────────────────
describe('webchat — configuração pública', () => {
  it('devolve só dados de apresentação e o estado aberto/fechado', async () => {
    const o = await makeOrg({ ai: { enabled: true }, businessHours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }, webchat: { title: 'TJ Atende', primaryColor: '#0a6b3d', offlineMessage: 'Fechado agora.', allowedOrigins: [] } });
    const res = await app.inject({ method: 'GET', url: `/balcao/webchat/public/config?org=${o.slug}`, headers: { 'x-forwarded-for': ipOf() } });
    expect(res.statusCode).toBe(200);
    const c = res.json();
    expect(c).toMatchObject({ org: o.slug, title: 'TJ Atende', color: '#0a6b3d', open: false, offlineMessage: 'Fechado agora.' });
    expect(c.aiNotice).toBeTruthy();
    expect(c.privacyNotice).toContain('LGPD');
    expect(Object.keys(c).sort()).toEqual(['aiNotice', 'attachments', 'color', 'features', 'lang', 'maxMessageChars', 'offlineMessage', 'open', 'org', 'position', 'privacyNotice', 'title', 'version', 'welcome']);
    expect(JSON.stringify(c)).not.toContain(o.id);
  });

  it('org inexistente → 404; cor inválida cai no padrão', async () => {
    const nf = await app.inject({ method: 'GET', url: '/balcao/webchat/public/config?org=nao-existe-xyz', headers: { 'x-forwarded-for': ipOf() } });
    expect(nf.statusCode).toBe(404);
    const o = await org({ primaryColor: 'red;}</style>' });
    const res = await app.inject({ method: 'GET', url: `/balcao/webchat/public/config?org=${o.slug}`, headers: { 'x-forwarded-for': ipOf() } });
    expect(res.json().color).toBe('#1f4e9c');
  });
});

// ── ciclo completo ────────────────────────────────────────────────────────────
describe('webchat — sessão, mensagens, resposta e polling', () => {
  it('visitante → atendente → polling; nota interna não vaza; histórico; uso contabilizado', async () => {
    const o = await org();
    const agent = await makeUser(o.id, 'ATENDENTE');
    const v = await session(o, { name: 'Maria <b>Souza</b>' });

    // sem conversa ainda
    const empty = await poll(v);
    expect(empty.json()).toMatchObject({ messages: [], state: { status: 'none', conversationId: null } });

    const m1 = await say(v, '  Olá,‮ preciso de ajuda\u0000  ');
    expect(m1.statusCode).toBe(201);
    expect(m1.json().message).toMatchObject({ from: 'visitor', text: 'Olá, preciso de ajuda' });
    expect(m1.json().state.status).toBe('waiting');
    const conv = await convOf(v);
    expect(conv.channel).toBe('WEBCHAT');
    const contact = await prisma.bvContact.findUniqueOrThrow({ where: { id: conv.contactId } });
    expect(contact.name).toBe('Maria bSouza/b');

    await addNote(o.id, conv.id, agent.id, 'NOTA SECRETA: cidadão é reincidente');
    const reply = await sendMessage({ orgId: o.id, conversationId: conv.id, senderType: 'AGENT', userId: agent.id, body: 'Bom dia, Maria! Em que posso ajudar?' });
    expect(reply.message.status).toBe('SENT');
    const sys = await sendMessage({ orgId: o.id, conversationId: conv.id, senderType: 'BOT', body: 'Resposta do bot' });

    const p = await poll(v);
    const list = p.json().messages as any[];
    expect(list.map((m) => m.text)).toEqual(['Bom dia, Maria! Em que posso ajudar?', 'Resposta do bot']);
    expect(list.map((m) => m.from)).toEqual(['agent', 'bot']);
    expect(JSON.stringify(p.json())).not.toContain('SECRETA');
    expect(JSON.stringify(p.json())).not.toContain(agent.id);
    expect(Object.keys(list[0]).sort()).toEqual(['at', 'attachments', 'from', 'id', 'kind', 'text']);

    // since (inclusivo): devolve a partir do instante
    const since = await poll(v, `?since=${encodeURIComponent(list[1].at)}`);
    expect(since.json().messages.map((m: any) => m.id)).toEqual([sys.message.id]);
    expect((await poll(v, '?since=lixo')).statusCode).toBe(400);

    // histórico (retomada): visitante + atendimento, nunca a nota
    const hist = await app.inject({ method: 'GET', url: '/balcao/webchat/public/history', headers: H(v) });
    expect(hist.json().messages.map((m: any) => m.from)).toEqual(['visitor', 'agent', 'bot']);
    expect(JSON.stringify(hist.json())).not.toContain('SECRETA');

    // canal marcou a entrega como SENT e sem socket → 'poll'
    const row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: reply.message.id } });
    expect(row.status).toBe('SENT');
    expect((row.channelMeta as any).delivery).toBe('poll');

    // consumo
    await new Promise((r) => setTimeout(r, 300));
    expect(await getUsage(o.id, 'WEBCHAT_MSG', new Date(Date.now() - 86400_000), new Date())).toBeGreaterThanOrEqual(3);
  });

  it('mensagens: vazia, longa demais, idempotência por clientMsgId', async () => {
    process.env.BV_WEBCHAT_MAX_MESSAGE_CHARS = '50';
    const o = await org();
    const v = await session(o);
    expect((await say(v, '   ')).statusCode).toBe(400);
    expect((await say(v, 'x'.repeat(51))).statusCode).toBe(413);
    const a = await say(v, 'oi', { clientMsgId: 'client-msg-0001' });
    const b = await say(v, 'oi', { clientMsgId: 'client-msg-0001' });
    expect(a.json().duplicate).toBe(false);
    expect(b.json().duplicate).toBe(true);
    expect(b.json().message.id).toBe(a.json().message.id);
    expect(await prisma.bvMessage.count({ where: { orgId: o.id, direction: 'IN' } })).toBe(1);
  });

  it('com IA ligada a conversa nasce em BOT e o bot responde ao visitante', async () => {
    const o = await makeOrg({ ai: { enabled: true } });
    const v = await session(o);
    expect((await say(v, 'Qual o horário?')).json().state.status).toBe('bot');
    const conv = await convOf(v);
    await sendMessage({ orgId: o.id, conversationId: conv.id, senderType: 'BOT', body: 'Das 8h às 18h.' });
    expect((await poll(v)).json().messages[0]).toMatchObject({ from: 'bot', text: 'Das 8h às 18h.' });
  });

  it('e-mail informado casa o contato com o de outro canal; identify une o anônimo', async () => {
    const o = await org();
    const email = `cidadao-${rnd()}@exemplo.org`;
    const other = await resolveContact({ orgId: o.id, channel: 'EMAIL', externalId: email, email, name: 'Cidadão' });

    const v1 = await session(o, { email });
    await say(v1, 'oi por e-mail identificado');
    expect((await convOf(v1)).contactId).toBe(other.contactId);

    const v2 = await session(o);
    await say(v2, 'oi anônimo');
    const anon = (await convOf(v2)).contactId;
    expect(anon).not.toBe(other.contactId);
    const id = await app.inject({ method: 'POST', url: '/balcao/webchat/public/identify', headers: H(v2), payload: { email, name: 'Cidadão' } });
    expect(id.statusCode).toBe(200);
    expect((await convOf(v2)).contactId).toBe(other.contactId);
    expect((await prisma.bvContact.findUniqueOrThrow({ where: { id: anon } })).mergedIntoId).toBe(other.contactId);
  });

  it('digitando do visitante é opcional (204) e exige token', async () => {
    const o = await org();
    const v = await session(o);
    await say(v, 'oi');
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/typing', headers: H(v) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/typing', headers: { 'x-forwarded-for': ipOf() } })).statusCode).toBe(401);
  });
});

// ── humano, vídeo, encerramento e CSAT ────────────────────────────────────────
describe('webchat — humano, vídeo, encerramento, NPS', () => {
  it('"falar com humano" cria a conversa (se preciso) e escala para a fila', async () => {
    const o = await makeOrg({ ai: { enabled: true } });
    const v = await session(o);
    const res = await app.inject({ method: 'POST', url: '/balcao/webchat/public/human', headers: H(v), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.status).toBe('waiting');
    const conv = await convOf(v);
    expect(conv.status).toBe('WAITING');
    expect(conv.botHandled).toBe(true);
  });

  it('vídeo: sala Jitsi configurável e mensagem SYSTEM com o link', async () => {
    process.env.BV_JITSI_BASE_URL = 'https://jitsi.exemplo.gov.br/';
    const o = await org();
    const v = await session(o);
    const res = await app.inject({ method: 'POST', url: '/balcao/webchat/public/video', headers: H(v), payload: {} });
    expect(res.statusCode).toBe(201);
    const conv = await convOf(v);
    expect(res.json().url).toMatch(new RegExp(`^https://jitsi\\.exemplo\\.gov\\.br/bv-${conv.protocol}-[a-z0-9]{6,10}$`));
    const msgs = (await poll(v)).json().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe('system');
    expect(msgs[0].text).toContain(res.json().url);
    expect(conv.status).toBe('WAITING');
  });

  it('vídeo usa meet.jit.si por padrão e respeita videoEnabled=false', async () => {
    const o = await org();
    const v = await session(o);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/video', headers: H(v), payload: {} })).json().url).toMatch(/^https:\/\/meet\.jit\.si\/bv-/);
    const o2 = await org({ videoEnabled: false });
    const v2 = await session(o2);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/video', headers: H(v2), payload: {} })).statusCode).toBe(403);
  });

  it('encerrar → NPS pendente → CSAT gravado uma única vez', async () => {
    const o = await org();
    const v = await session(o);
    const csat = (score: unknown) => app.inject({ method: 'POST', url: '/balcao/webchat/public/csat', headers: H(v), payload: { score, comment: 'Ótimo <3' } });
    await say(v, 'preciso de ajuda');
    expect((await csat(9)).statusCode).toBe(409); // ainda aberta
    const end = await app.inject({ method: 'POST', url: '/balcao/webchat/public/end', headers: H(v), payload: {} });
    expect(end.statusCode).toBe(200);
    expect(end.json().state).toMatchObject({ status: 'closed', csat: { requested: true, done: false } });
    expect((await csat(11)).statusCode).toBe(400);
    expect((await csat(9)).statusCode).toBe(200);
    expect((await csat(3)).statusCode).toBe(409);
    const conv = await convOf(v);
    expect(conv).toMatchObject({ csatScore: 9, csatComment: 'Ótimo <3' });
    expect((await poll(v)).json().state.csat).toMatchObject({ requested: false, done: true });
  });

  it('encerramento pelo atendente também aparece no polling; nova mensagem abre nova conversa', async () => {
    const o = await org();
    const v = await session(o);
    await say(v, 'primeira');
    const first = await convOf(v);
    await closeConversation({ orgId: o.id, conversationId: first.id, reason: 'RESOLVED' });
    expect((await poll(v)).json().state).toMatchObject({ status: 'closed', csat: { requested: true } });
    await say(v, 'segunda conversa');
    expect((await convOf(v)).id).not.toBe(first.id);
  });

  it('leave encerra a sessão: token deixa de valer', async () => {
    const o = await org();
    const v = await session(o);
    await say(v, 'oi');
    const r = await app.inject({ method: 'POST', url: '/balcao/webchat/public/end', headers: H(v), payload: { leave: true } });
    expect(r.json().ended).toBe(true);
    expect((await poll(v)).statusCode).toBe(401);
  });
});

// ── anexos ────────────────────────────────────────────────────────────────────
describe('webchat — anexos', () => {
  it('aceita imagem válida, grava no storage e permite o download pelo próprio visitante', async () => {
    const o = await org();
    const v = await session(o);
    const res = await upload(v, { name: '../../foto "x".png', type: 'image/png', data: PNG }, { text: 'segue a foto' });
    expect(res.statusCode).toBe(201);
    const m = res.json().message;
    expect(m).toMatchObject({ from: 'visitor', kind: 'IMAGE', text: 'segue a foto' });
    expect(m.attachments[0].name).not.toMatch(/[\\/"]/);
    const dl = await app.inject({ method: 'GET', url: `/balcao/webchat/public/${m.attachments[0].path}`, headers: H(v) });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(dl.rawPayload, PNG)).toBe(0);
    const row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect((row.attachments as any)[0].key.startsWith(`${o.id}/attachments/`)).toBe(true);
  });

  it('aceita PDF; recusa tipo não permitido, tipo forjado, vazio e acima do limite', async () => {
    process.env.BV_WEBCHAT_RL_ATTACH = '50';
    const o = await org();
    const v = await session(o);
    expect((await upload(v, { name: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\n%fake') })).statusCode).toBe(201);
    expect((await upload(v, { name: 'a.txt', type: 'text/plain', data: Buffer.from('texto') })).statusCode).toBe(415);
    expect((await upload(v, { name: 'a.svg', type: 'image/svg+xml', data: Buffer.from('<svg onload=alert(1)/>') })).statusCode).toBe(415);
    expect((await upload(v, { name: 'virus.png', type: 'image/png', data: Buffer.from('MZ\x90\x00 executavel') })).statusCode).toBe(415);
    expect((await upload(v, { name: 'x.png', type: 'application/pdf', data: PNG })).statusCode).toBe(415); // declarado ≠ real
    expect((await upload(v, { name: 'v.png', type: 'image/png', data: Buffer.alloc(0) })).statusCode).toBe(400);
    process.env.BV_WEBCHAT_MAX_ATTACHMENT_MB = '1';
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10, 2)]);
    expect((await upload(v, { name: 'big.png', type: 'image/png', data: big })).statusCode).toBe(413);
  });

  it('exige multipart; anexos desativados → 403', async () => {
    const o = await org();
    const v = await session(o);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/attachments', headers: H(v), payload: { a: 1 } })).statusCode).toBe(415);
    const o2 = await org({ attachmentsEnabled: false });
    const v2 = await session(o2);
    expect((await upload(v2, { name: 'a.png', type: 'image/png', data: PNG })).statusCode).toBe(403);
  });

  it('anexo do atendente chega ao visitante; outra sessão/órgão não acessa; nota não vaza', async () => {
    const o = await org();
    const agent = await makeUser(o.id, 'ATENDENTE');
    const v = await session(o);
    await say(v, 'oi');
    const conv = await convOf(v);
    const { putObject, newKey } = await import('../../../core/storage');
    const stored = await putObject(newKey(o.id, 'attachments', 'pdf'), Buffer.from('%PDF-1.4 do atendente'));
    const sent = await sendMessage({ orgId: o.id, conversationId: conv.id, senderType: 'AGENT', userId: agent.id, kind: 'DOCUMENT', body: 'Segue o documento',
      attachments: [{ key: stored.key, name: 'guia.pdf', mime: 'application/pdf', size: stored.size }] });
    const att = (await poll(v)).json().messages[0].attachments[0];
    expect(att).toMatchObject({ name: 'guia.pdf', mime: 'application/pdf' });
    const ok = await app.inject({ method: 'GET', url: `/balcao/webchat/public/${att.path}`, headers: H(v) });
    expect(ok.statusCode).toBe(200);
    expect(String(ok.headers['content-disposition'])).toContain('attachment');

    const same = await session(o);
    expect((await app.inject({ method: 'GET', url: `/balcao/webchat/public/${att.path}`, headers: H(same) })).statusCode).toBe(404);
    const o2 = await org();
    const other = await session(o2);
    await say(other, 'oi');
    expect((await app.inject({ method: 'GET', url: `/balcao/webchat/public/${att.path}`, headers: H(other) })).statusCode).toBe(404);

    // anexo em NOTA interna nunca é servido
    const note = await addNote(o.id, conv.id, agent.id, 'nota');
    await prisma.bvMessage.update({ where: { id: note.id }, data: { attachments: [{ key: stored.key, name: 'n.pdf', mime: 'application/pdf', size: 1 }] as any } });
    expect((await app.inject({ method: 'GET', url: `/balcao/webchat/public/attachments/${note.id}/0`, headers: H(v) })).statusCode).toBe(404);
    expect(sent.message.id).toBeTruthy();
  });
});

// ── segurança ─────────────────────────────────────────────────────────────────
describe('webchat — origem, rate limit, token, expiração, isolamento', () => {
  it('Origin: lista vazia libera em dev; com lista só as permitidas (inclui curinga); sem Origin em POST é negado', async () => {
    const o = await org({ allowedOrigins: [] });
    await session(o, {}, { origin: 'https://qualquer.com' });

    await updateOrgSettings(o.id, { webchat: { allowedOrigins: ['https://www.tjto.jus.br', 'https://*.tjto.jus.br/'] } as any });
    const post = (origin?: string) => app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ipOf(), ...(origin ? { origin } : {}) }, payload: { org: o.slug } });
    expect((await post('https://www.tjto.jus.br')).statusCode).toBe(201);
    expect((await post('https://intranet.tjto.jus.br')).statusCode).toBe(201);
    expect((await post('https://tjto.jus.br.evil.com')).statusCode).toBe(403);
    expect((await post('https://evil.com')).statusCode).toBe(403);
    expect((await post('null')).statusCode).toBe(403);
    expect((await post()).statusCode).toBe(403);
    const bad = await post('https://evil.com');
    expect(bad.json().error.code).toBe('webchat.origin_not_allowed');

    const cfg = (origin: string) => app.inject({ method: 'GET', url: `/balcao/webchat/public/config?org=${o.slug}`, headers: { origin, 'x-forwarded-for': ipOf() } });
    expect((await cfg('https://evil.com')).statusCode).toBe(403);
    expect((await cfg('https://www.tjto.jus.br')).statusCode).toBe(200);
  });

  it('Origin é revalidada nas rotas com token (token roubado não funciona em outro site)', async () => {
    const o = await org({ allowedOrigins: ['https://site.gov.br'] });
    const v = await session(o, {}, { origin: 'https://site.gov.br' });
    expect((await app.inject({ method: 'GET', url: '/balcao/webchat/public/messages', headers: H(v, { origin: 'https://site.gov.br' }) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/balcao/webchat/public/messages', headers: H(v, { origin: 'https://evil.com' }) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/messages', headers: H(v), payload: { text: 'sem origin' } })).statusCode).toBe(403);
  });

  it('em produção (enforce) lista vazia nega tudo, exceto a própria origem da API (demo)', async () => {
    process.env.BV_WEBCHAT_ENFORCE_ORIGIN = '1';
    const o = await org({ allowedOrigins: [] });
    const post = (origin: string) => app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ipOf(), origin, host: 'api.exemplo.gov.br' }, payload: { org: o.slug } });
    expect((await post('https://site.gov.br')).statusCode).toBe(403);
    expect((await post('http://api.exemplo.gov.br')).statusCode).toBe(201);
    expect((await post('*')).statusCode).toBe(403);
    await updateOrgSettings(o.id, { webchat: { allowedOrigins: ['*'] } as any });
    expect((await post('https://site.gov.br')).statusCode).toBe(201);
  });

  it('rate limit por sessão (mensagens) responde 429 com Retry-After; e por IP para novas sessões', async () => {
    process.env.BV_WEBCHAT_RL_MSG = '3';
    process.env.BV_WEBCHAT_RL_SESSIONS = '2';
    const o = await org();
    const v = await session(o);
    for (let i = 0; i < 3; i++) expect((await say(v, `m${i}`)).statusCode).toBe(201);
    const blocked = await say(v, 'm4');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json().error.code).toBe('webchat.rate_limited');
    // outra sessão não é afetada
    expect((await say(await session(o), 'ok')).statusCode).toBe(201);

    const ip = ipOf();
    const mk = () => app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ip }, payload: { org: o.slug } });
    expect((await mk()).statusCode).toBe(201);
    expect((await mk()).statusCode).toBe(201);
    expect((await mk()).statusCode).toBe(429);
  });

  it('token ausente, malformado, desconhecido, encerrado e expirado → 401 idêntico (sem enumeração)', async () => {
    const o = await org();
    const v = await session(o);
    const bodies = new Set<string>();
    const tryTok = async (token?: string) => {
      const r = await app.inject({ method: 'GET', url: '/balcao/webchat/public/messages', headers: { 'x-forwarded-for': ipOf(), ...(token ? { 'x-visitor-token': token } : {}) } });
      expect(r.statusCode).toBe(401);
      bodies.add(r.body);
    };
    await tryTok();
    await tryTok('abc');
    await tryTok(`bvv_${crypto.randomBytes(32).toString('base64url')}`);
    await tryTok(`Bearer ${v.token}`);
    // expirada por inatividade
    const hash = hashToken(v.token);
    await prisma.bvWebchatSession.update({ where: { tokenHash: hash }, data: { lastSeenAt: new Date(Date.now() - 13 * 3600_000) } });
    await tryTok(v.token);
    expect(bodies.size).toBe(1);
    // o token em claro nunca é guardado
    const row = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(JSON.stringify(row)).not.toContain(v.token);
    expect(v.token.startsWith('bvv_')).toBe(true);
  });

  it('TTL configurável e renovação por atividade', async () => {
    process.env.BV_WEBCHAT_SESSION_TTL_SEC = '120';
    const o = await org();
    const v = await session(o);
    await prisma.bvWebchatSession.update({ where: { tokenHash: hashToken(v.token) }, data: { lastSeenAt: new Date(Date.now() - 60_000) } });
    expect((await poll(v)).statusCode).toBe(200);
    const s = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(v.token) } });
    expect(Date.now() - s.lastSeenAt.getTime()).toBeLessThan(5_000);
    await prisma.bvWebchatSession.update({ where: { tokenHash: hashToken(v.token) }, data: { lastSeenAt: new Date(Date.now() - 200_000) } });
    expect((await poll(v)).statusCode).toBe(401);
  });

  it('isolamento entre órgãos: sessões, mensagens e conversas não se cruzam', async () => {
    const a = await org();
    const b = await org();
    const agentA = await makeUser(a.id, 'ATENDENTE');
    const va = await session(a);
    const vb = await session(b);
    await say(va, 'segredo do órgão A');
    await say(vb, 'mensagem do órgão B');
    const ca = await convOf(va);
    await sendMessage({ orgId: a.id, conversationId: ca.id, senderType: 'AGENT', userId: agentA.id, body: 'resposta A' });
    const pb = await poll(vb);
    expect(pb.json().messages).toEqual([]);
    expect(JSON.stringify((await app.inject({ method: 'GET', url: '/balcao/webchat/public/history', headers: H(vb) })).json())).not.toContain('órgão A');
    expect((await convOf(vb)).orgId).toBe(b.id);
    expect((await convOf(va)).orgId).toBe(a.id);
    // o token do órgão A não serve para operar no B: a sessão carrega o próprio orgId
    const s = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(va.token) } });
    expect(s.orgId).toBe(a.id);
    // slug do outro órgão no corpo de /session não vaza nada além de um novo token do PRÓPRIO órgão
    const other = await session(b);
    expect((await poll(other)).json().messages).toEqual([]);
  });

  it('visitante nunca recebe mensagens INTERNAL mesmo que o corpo seja de uma nota', async () => {
    const o = await org();
    const agent = await makeUser(o.id, 'ATENDENTE');
    const v = await session(o);
    await say(v, 'oi');
    const conv = await convOf(v);
    for (let i = 0; i < 3; i++) await addNote(o.id, conv.id, agent.id, `nota interna ${i}`);
    for (const url of ['/balcao/webchat/public/messages', '/balcao/webchat/public/history']) {
      const r = await app.inject({ method: 'GET', url, headers: H(v) });
      expect(r.body).not.toContain('nota interna');
    }
  });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function wsClient(port: number, nsp: string, auth: unknown, origin?: string) {
  const events: Array<[string, any]> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, { headers: origin ? { Origin: origin } : {} });
  const acks = new Map<number, (v: any) => void>();
  let ackId = 0;
  const connected = new Promise<void>((resolve, reject) => {
    ws.on('error', reject);
    ws.on('close', () => reject(new Error('closed')));
    ws.on('message', (raw) => {
      const d = raw.toString();
      if (d[0] === '0') ws.send(`40${nsp},${JSON.stringify(auth)}`);
      else if (d === '2') ws.send('3');
      else if (d.startsWith(`40${nsp},`)) resolve();
      else if (d.startsWith(`44${nsp},`)) reject(new Error(JSON.parse(d.slice(`44${nsp},`.length)).message));
      else if (d.startsWith(`42${nsp},`)) events.push(JSON.parse(d.slice(`42${nsp},`.length)));
      else if (d.startsWith(`43${nsp},`)) { const m = /^(\d+)(\[.*\])$/.exec(d.slice(`43${nsp},`.length)); if (m) acks.get(Number(m[1]))?.(JSON.parse(m[2])[0]); }
    });
  });
  connected.catch(() => undefined);
  return {
    connected, events, close: () => ws.close(),
    emit: (ev: string, ...args: unknown[]) => ws.send(`42${nsp},${JSON.stringify([ev, ...args])}`),
    emitAck: (ev: string, ...args: unknown[]) => new Promise<any>((res) => { const id = ++ackId; acks.set(id, res); ws.send(`42${nsp},${id}${JSON.stringify([ev, ...args])}`); }),
    has: (name: string, pred: (p: any) => boolean = () => true) => events.some(([n, p]) => n === name && pred(p)),
  };
}
const until = async (fn: () => boolean, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout aguardando evento'); await new Promise((r) => setTimeout(r, 25)); } };

describe('webchat — Socket.IO /bv-visitor', () => {
  let server: http.Server; let io: Server; let port: number;
  beforeAll(async () => {
    server = http.createServer();
    io = new Server(server, { transports: ['websocket'] });
    attachBalcaoSockets(io);
    attachVisitorNamespace(io);
    attachVisitorNamespace(io); // idempotente
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as any).port;
  });
  afterAll(async () => { io.close(); });

  it('rejeita token inválido e Origin não permitida', async () => {
    const bad = wsClient(port, '/bv-visitor', { token: 'bvv_naoexiste_naoexiste_naoexiste' });
    await expect(bad.connected).rejects.toThrow('unauthorized');
    const o = await org({ allowedOrigins: ['https://site.gov.br'] });
    const v = await session(o, {}, { origin: 'https://site.gov.br' });
    const evil = wsClient(port, '/bv-visitor', { token: v.token }, 'https://evil.com');
    await expect(evil.connected).rejects.toThrow('origin_not_allowed');
    const good = wsClient(port, '/bv-visitor', { token: v.token }, 'https://site.gov.br');
    await good.connected;
    good.close();
  });

  it('entrega message:new, typing do atendente, csat:request e conversation:closed — sem notas internas', async () => {
    const o = await org();
    const agent = await makeUser(o.id, 'ATENDENTE');
    const v = await session(o);
    const vis = wsClient(port, '/bv-visitor', { token: v.token });
    await vis.connected;
    await say(v, 'oi, estou online'); // cria a conversa → o socket entra na sala
    const conv = await convOf(v);
    await new Promise((r) => setTimeout(r, 100));

    await addNote(o.id, conv.id, agent.id, 'NOTA INTERNA SECRETA');
    const reply = await sendMessage({ orgId: o.id, conversationId: conv.id, senderType: 'AGENT', userId: agent.id, body: 'Olá, sou o atendente' });
    await until(() => vis.has('message:new', (p) => p.message.id === reply.message.id));
    const evt = vis.events.find(([n]) => n === 'message:new')![1];
    expect(evt.message).toMatchObject({ from: 'agent', text: 'Olá, sou o atendente' });
    expect(JSON.stringify(vis.events)).not.toContain('SECRETA');
    expect(JSON.stringify(vis.events)).not.toContain(agent.id);
    expect((await prisma.bvMessage.findUniqueOrThrow({ where: { id: reply.message.id } })).channelMeta).toMatchObject({ delivery: 'socket' });

    // atendente digitando (namespace /bv) → visitante
    const staff = wsClient(port, '/bv', { token: authHeader(agent).authorization.slice(7) });
    await staff.connected;
    await staff.emitAck('conv:join', conv.id);
    staff.emit('typing', conv.id);
    await until(() => vis.has('typing', (p) => p.from === 'agent'));

    // visitante digitando → sala da conversa na equipe
    vis.emit('typing');
    await until(() => staff.has('typing', (p) => p.from === 'CONTACT'));

    // encerramento → conversation:closed + csat:request
    await closeConversation({ orgId: o.id, conversationId: conv.id, reason: 'RESOLVED' });
    await until(() => vis.has('conversation:closed') && vis.has('csat:request', (p) => typeof p.prompt === 'string'));
    staff.close(); vis.close();
  });

  it('isolamento: visitante de outro órgão não recebe eventos', async () => {
    const a = await org(); const b = await org();
    const agent = await makeUser(a.id, 'ATENDENTE');
    const va = await session(a); const vb = await session(b);
    const sa = wsClient(port, '/bv-visitor', { token: va.token }); const sb = wsClient(port, '/bv-visitor', { token: vb.token });
    await Promise.all([sa.connected, sb.connected]);
    await say(va, 'a'); await say(vb, 'b');
    await new Promise((r) => setTimeout(r, 100));
    const ca = await convOf(va);
    await sendMessage({ orgId: a.id, conversationId: ca.id, senderType: 'AGENT', userId: agent.id, body: 'só para A' });
    await until(() => sa.has('message:new'));
    await new Promise((r) => setTimeout(r, 200));
    expect(sb.has('message:new')).toBe(false);
    sa.close(); sb.close();
  });

  it('leave desconecta o socket da sessão', async () => {
    const o = await org();
    const v = await session(o);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const closed = new Promise<void>((r) => ws.on('close', () => r()));
    ws.on('message', (raw) => { const d = raw.toString(); if (d[0] === '0') ws.send(`40/bv-visitor,${JSON.stringify({ token: v.token })}`); else if (d === '2') ws.send('3'); });
    await new Promise((r) => setTimeout(r, 300));
    await app.inject({ method: 'POST', url: '/balcao/webchat/public/end', headers: H(v), payload: { leave: true } });
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('não desconectou')), 3000))]);
  });
});

// Garante que ingestInbound continua funcionando para o canal (sanidade do contrato)
describe('webchat — contrato com o core', () => {
  it('conversa WEBCHAT usa channelRef = id da sessão', async () => {
    const o = await org();
    const v = await session(o);
    await say(v, 'oi');
    const s = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(v.token) } });
    const conv = await convOf(v);
    expect(conv.channelRef).toBe(s.id);
    const again = await ingestInbound({ orgId: o.id, channel: 'WEBCHAT', channelRef: s.id, externalId: s.id, message: { body: 'direto' } });
    expect(again.conversation.id).toBe(conv.id);
  });
});

// ── Lacunas fechadas na auditoria ─────────────────────────────────────────────
describe('webchat — auditoria de escopo', () => {
  const CLOSED_ALL_WEEK = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

  it('fora do horário o visitante ainda consegue deixar mensagem (vai à fila; a config informa open=false)', async () => {
    const o = await makeOrg({ ai: { enabled: false }, businessHours: CLOSED_ALL_WEEK, webchat: { offlineMessage: 'Deixe sua mensagem.' } });
    const cfg = await app.inject({ method: 'GET', url: `/balcao/webchat/public/config?org=${o.slug}`, headers: { 'x-forwarded-for': ipOf() } });
    expect(cfg.json()).toMatchObject({ open: false, offlineMessage: 'Deixe sua mensagem.' });
    const v = await session(o);
    const res = await say(v, 'Preciso de retorno sobre meu processo.');
    expect(res.statusCode).toBe(201);
    expect(res.json().state.status).toBe('waiting');
    expect((await convOf(v)).status).toBe('WAITING');
    // o widget troca "Iniciar conversa/Enviar" por "Deixar mensagem" quando cfg.open é falso
    expect(WIDGET_JS).toContain('cfg.open ? T.start : T.leave');
    expect(WIDGET_JS).toContain('cfg.open ? T.send : T.leave');
  });

  it('o token do visitante só existe como hash (SHA-256) no banco e nunca é devolvido depois da criação', async () => {
    const o = await org();
    const v = await session(o, { name: 'Maria', email: `m${rnd()}@exemplo.gov.br` });
    const row = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(v.token) } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toBe(v.token);
    expect(JSON.stringify(row)).not.toContain(v.token);
    await say(v, 'olá');
    for (const r of [await poll(v), await app.inject({ method: 'GET', url: '/balcao/webchat/public/history', headers: H(v) })]) {
      expect(r.body).not.toContain(v.token);
    }
  });

  it('o widget lê todos os atributos documentados (data-org/lang/position/vlibras/color)', () => {
    for (const a of ['data-org', 'data-lang', 'data-position', 'data-vlibras', 'data-color']) expect(WIDGET_JS).toContain(`'${a}'`);
    expect(WIDGET_JS).toContain('sessionStorage'); // retomada
  });

  it('contraste AA: a cor do texto escolhida pelo widget sempre atinge 4,5:1 sobre qualquer cor de marca', () => {
    // extrai lum()/ink() do próprio script e as executa
    const fn = (name: string) => {
      const m = new RegExp(`function ${name}\\([^)]*\\) \\{[^\\n]*\\}\\n`).exec(WIDGET_JS);
      expect(m).not.toBeNull();
      return m![0];
    };
    const ctx: any = {};
    vm.createContext(ctx);
    vm.runInContext(`${fn('lum')}${fn('ink')}`, ctx);
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    for (let i = 0; i < 400; i++) {
      const hex = '#' + crypto.randomBytes(3).toString('hex');
      const ink = ctx.ink(hex) as string;
      expect(['#ffffff', '#000000']).toContain(ink);
      expect(ratio(ctx.lum(hex), ctx.lum(ink))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
