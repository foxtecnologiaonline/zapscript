process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';
process.env.BV_STORAGE_DIR = process.env.BV_STORAGE_DIR || require('path').join(require('os').tmpdir(), 'bv-storage-webchat-test');

import crypto from 'crypto';
import http from 'http';
import vm from 'vm';
import WebSocket from 'ws';
import { Server } from 'socket.io';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { authHeader, makeOrg, makeUser } from '../../../core/testing';
import { assignConversation, closeConversation, ingestInbound } from '../../../core/conversations';
import { attachBalcaoSockets } from '../../../core/realtime';
import { hashToken } from '../../../core/crypto';
import { attachVisitorNamespace } from '../socket';
import { WIDGET_JS } from '../widgetSource';
import { cleanCaption } from '../captions';

let app: FastifyInstance;
let server: http.Server; let io: Server; let port: number;
const rnd = () => crypto.randomBytes(4).toString('hex');
const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const ENV_KEYS = ['BV_WEBCHAT_RL_CAPTION', 'BV_WEBCHAT_ENFORCE_ORIGIN'];

beforeAll(async () => {
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => { try { const t = body.toString().trim(); done(null, t ? JSON.parse(t) : {}); } catch (e: any) { done(e); } });
  const { default: webchat } = await import('../index');
  await app.register(webchat, { prefix: '/balcao/webchat' });
  await app.ready();
  server = http.createServer();
  io = new Server(server, { transports: ['websocket'] });
  attachBalcaoSockets(io); attachVisitorNamespace(io);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
afterAll(async () => { io.close(); await app.close(); });
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

const org = (webchat: Record<string, unknown> = {}) => makeOrg({ ai: { enabled: false }, webchat });
interface V { token: string; ip: string; slug: string; orgId: string }
const H = (v: V, extra: Record<string, string> = {}) => ({ 'x-visitor-token': v.token, 'x-forwarded-for': v.ip, ...extra });
async function session(o: { id: string; slug: string }, headers: Record<string, string> = {}): Promise<V> {
  const ip = ipOf();
  const res = await app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ip, ...headers }, payload: { org: o.slug } });
  expect(res.statusCode).toBe(201);
  return { token: res.json().token, ip, slug: o.slug, orgId: o.id };
}
const say = (v: V, text: string) => app.inject({ method: 'POST', url: '/balcao/webchat/public/messages', headers: H(v), payload: { text } });
const vcaption = (v: V, payload: unknown, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/balcao/webchat/public/caption', headers: H(v, extra), payload: payload as any });
const acaption = (convId: string, user: { id: string; orgId: string; role: string } | null, payload: unknown) =>
  app.inject({ method: 'POST', url: `/balcao/webchat/conversations/${convId}/caption`, headers: user ? authHeader(user) : {}, payload: payload as any });
async function convOf(v: V) {
  const s = await prisma.bvWebchatSession.findUniqueOrThrow({ where: { tokenHash: hashToken(v.token) } });
  return prisma.bvConversation.findFirstOrThrow({ where: { id: s.conversationId!, orgId: v.orgId } });
}

function wsClient(nsp: string, auth: unknown) {
  const events: Array<[string, any]> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
  const acks = new Map<number, (v: any) => void>(); let ackId = 0;
  const connected = new Promise<void>((resolve, reject) => {
    ws.on('error', reject); ws.on('close', () => reject(new Error('closed')));
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
    emitAck: (ev: string, ...args: unknown[]) => new Promise<any>((res) => { const id = ++ackId; acks.set(id, res); ws.send(`42${nsp},${id}${JSON.stringify([ev, ...args])}`); }),
    all: (name: string) => events.filter(([n]) => n === name).map(([, p]) => p),
  };
}
const until = async (fn: () => boolean, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout aguardando evento'); await new Promise((r) => setTimeout(r, 25)); } };
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

async function world() {
  const o = await org();
  const agent = await makeUser(o.id, 'ATENDENTE');
  const other = await makeUser(o.id, 'ATENDENTE');
  const sup = await makeUser(o.id, 'SUPERVISOR');
  const fiscal = await makeUser(o.id, 'FISCAL');
  const v = await session(o);
  const visSock = wsClient('/bv-visitor', { token: v.token });
  await visSock.connected;
  await say(v, 'quero atendimento por vídeo'); // cria a conversa → o socket do visitante entra na sala
  const conv = await convOf(v);
  await assignConversation({ orgId: o.id, conversationId: conv.id, userId: agent.id, via: 'MANUAL' });
  const staff = wsClient('/bv', { token: authHeader(agent).authorization.slice(7) });
  await staff.connected;
  expect(await staff.emitAck('conv:join', conv.id)).toBe(true);
  await settle(100);
  return { o, orgId: o.id, agent, other, sup, fiscal, v, visSock, staff, conv, close: () => { visSock.close(); staff.close(); } };
}

describe('legendas — visitante → atendente (POST /public/caption + Socket.IO /bv)', () => {
  it('exige token; sem conversa → 409; com conversa → 204 e o atendente recebe o evento caption (o próprio visitante não recebe eco)', async () => {
    const o = await org();
    const fresh = await session(o);
    expect((await app.inject({ method: 'POST', url: '/balcao/webchat/public/caption', headers: { 'x-forwarded-for': ipOf() }, payload: { text: 'oi', final: true } })).statusCode).toBe(401);
    const none = await vcaption(fresh, { text: 'olá', final: false });
    expect(none.statusCode).toBe(409); expect(none.json().error.code).toBe('webchat.no_conversation');

    const w = await world();
    try {
      const r1 = await vcaption(w.v, { text: 'bom dia, preciso de uma certidão', final: false });
      expect(r1.statusCode).toBe(204); expect(r1.body).toBe('');
      const r2 = await vcaption(w.v, { text: 'Bom dia, preciso de uma certidão.', final: true });
      expect(r2.statusCode).toBe(204);
      await until(() => w.staff.all('caption').length === 2);
      expect(w.staff.all('caption')).toEqual([
        { conversationId: w.conv.id, from: 'VISITOR', text: 'bom dia, preciso de uma certidão', final: false },
        { conversationId: w.conv.id, from: 'VISITOR', text: 'Bom dia, preciso de uma certidão.', final: true },
      ]);
      await settle();
      expect(w.visSock.all('caption')).toHaveLength(0); // sem eco
    } finally { w.close(); }
  });

  it('validação e sanitização: vazio/sem final tipado/longo → 400; controles e bidi removidos; trecho truncado em 500; final é opcional (padrão false)', async () => {
    const w = await world();
    try {
      for (const bad of [{ text: '' }, {}, { text: 'x', final: 'sim' }, { text: 'x'.repeat(1001) }, { text: '   ‮\u0007  ' }]) {
        const r = await vcaption(w.v, bad);
        expect([JSON.stringify(bad).slice(0, 40), r.statusCode]).toEqual([JSON.stringify(bad).slice(0, 40), 400]);
      }
      expect((await vcaption(w.v, { text: 'a‮b\u0007c   d\n\ne' })).statusCode).toBe(204);
      expect((await vcaption(w.v, { text: 'l'.repeat(900), final: true })).statusCode).toBe(204);
      await until(() => w.staff.all('caption').length === 2);
      const [a, b] = w.staff.all('caption');
      expect(a).toEqual({ conversationId: w.conv.id, from: 'VISITOR', text: 'abc d e', final: false });
      expect(b.text).toHaveLength(500); expect(b.final).toBe(true);
      expect(cleanCaption('  ‎  ')).toBeNull();
    } finally { w.close(); }
  });

  it('só a conversa da PRÓPRIA sessão: outro órgão/atendente não recebe; conversa encerrada → 409; rate limit → 429 com Retry-After; Origin é validada', async () => {
    const w = await world(); const w2 = await world();
    try {
      await vcaption(w.v, { text: 'só para o meu atendente', final: true });
      await until(() => w.staff.all('caption').length === 1);
      await settle();
      expect(w2.staff.all('caption')).toHaveLength(0);

      process.env.BV_WEBCHAT_RL_CAPTION = '3';
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await vcaption(w2.v, { text: `t${i}` })).statusCode);
      expect(codes).toEqual([204, 204, 204, 429, 429]);
      const limited = await vcaption(w2.v, { text: 'x' });
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.json().error.code).toBe('webchat.rate_limited');
      delete process.env.BV_WEBCHAT_RL_CAPTION;

      await closeConversation({ orgId: w.orgId, conversationId: w.conv.id, reason: 'RESOLVED' });
      const closed = await vcaption(w.v, { text: 'depois do fim' });
      expect(closed.statusCode).toBe(409); expect(closed.json().error.code).toBe('webchat.conversation_closed');
    } finally { w.close(); w2.close(); }
    const o = await org({ allowedOrigins: ['https://site.gov.br'] });
    const v = await session(o, { origin: 'https://site.gov.br' });
    expect((await vcaption(v, { text: 'oi' }, { origin: 'https://evil.com' })).statusCode).toBe(403);
  });
});

describe('legendas — atendente → visitante (POST /conversations/:id/caption)', () => {
  it('atribuído e supervisão enviam; o visitante recebe caption {from:AGENT}; o atendente não recebe eco; delivered informa se há visitante conectado', async () => {
    const w = await world();
    try {
      const r1 = await acaption(w.conv.id, w.agent, { text: 'Bom dia, em que posso ajudar?', final: false });
      expect(r1.statusCode).toBe(200); expect(r1.json()).toEqual({ delivered: true });
      const r2 = await acaption(w.conv.id, w.sup, { text: 'Bom dia, em que posso ajudar?', final: true });
      expect(r2.statusCode).toBe(200);
      await until(() => w.visSock.all('caption').length === 2);
      expect(w.visSock.all('caption')).toEqual([
        { conversationId: w.conv.id, from: 'AGENT', text: 'Bom dia, em que posso ajudar?', final: false },
        { conversationId: w.conv.id, from: 'AGENT', text: 'Bom dia, em que posso ajudar?', final: true },
      ]);
      await settle();
      expect(w.staff.all('caption')).toHaveLength(0);
      const body = JSON.stringify(w.visSock.events);
      expect(body).not.toContain(w.agent.id); // sem identificar o atendente

      w.visSock.close(); await settle(300); // visitante sem conexão em tempo real
      expect((await acaption(w.conv.id, w.agent, { text: 'ninguém ouvindo', final: true })).json()).toEqual({ delivered: false });
    } finally { w.close(); }
  });

  it('autorização: 401 sem sessão; FISCAL 403; atendente não atribuído 403; outro órgão 404; validação 400; conversa encerrada 409; canal não-webchat 409; rate limit', async () => {
    const w = await world();
    try {
      const ok = { text: 'oi', final: true };
      expect((await acaption(w.conv.id, null, ok)).statusCode).toBe(401);
      expect((await acaption(w.conv.id, w.fiscal, ok)).statusCode).toBe(403);
      const notMine = await acaption(w.conv.id, w.other, ok);
      expect(notMine.statusCode).toBe(403); expect(notMine.json().error.code).toBe('conversation.forbidden');
      const foreign = await makeUser((await org()).id, 'SUPERVISOR');
      expect((await acaption(w.conv.id, foreign, ok)).statusCode).toBe(404);
      expect((await acaption('inexistente', w.agent, ok)).statusCode).toBe(404);
      for (const bad of [{ text: '' }, {}, { text: 'x', final: 1 }, { text: '‮' }]) expect((await acaption(w.conv.id, w.agent, bad)).statusCode).toBe(400);

      const email = (await ingestInbound({ orgId: w.orgId, channel: 'EMAIL', channelRef: `<r-${rnd()}@x>`, externalId: 'c@x.test', email: 'c@x.test', subject: 's', message: { kind: 'TEXT', body: 'oi', channelMessageId: `<m-${rnd()}@x>` } })).conversation;
      const notWc = await acaption(email.id, w.sup, ok);
      expect(notWc.statusCode).toBe(409); expect(notWc.json().error.code).toBe('webchat.not_webchat');

      process.env.BV_WEBCHAT_RL_CAPTION = '2';
      const sup2 = await makeUser(w.orgId, 'SUPERVISOR'); // janela de limite própria (o limite é por usuário)
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await acaption(w.conv.id, sup2, { text: `t${i}` })).statusCode);
      expect(codes).toEqual([200, 200, 429, 429]);
      delete process.env.BV_WEBCHAT_RL_CAPTION;

      await closeConversation({ orgId: w.orgId, conversationId: w.conv.id, reason: 'RESOLVED' });
      const closed = await acaption(w.conv.id, w.agent, ok);
      expect(closed.statusCode).toBe(409); expect(closed.json().error.code).toBe('conversation.closed');
    } finally { w.close(); }
  });

  it('visitante de outro órgão/conversa não recebe a legenda do atendente', async () => {
    const a = await world(); const b = await world();
    try {
      await acaption(a.conv.id, a.agent, { text: 'só para A', final: true });
      await until(() => a.visSock.all('caption').length === 1);
      await settle();
      expect(b.visSock.all('caption')).toHaveLength(0);
    } finally { a.close(); b.close(); }
  });
});

describe('legendas — relé efêmero (nada é gravado)', () => {
  it('trocar dezenas de legendas não cria mensagens, eventos, auditoria nem uso; o texto não aparece em nenhuma tabela do órgão', async () => {
    const w = await world();
    try {
      const secret = `FRASE-SECRETA-${rnd()}`;
      const count = async () => ({
        messages: await prisma.bvMessage.count({ where: { orgId: w.orgId } }),
        events: await prisma.bvConversationEvent.count({ where: { conversationId: w.conv.id } }),
        audit: await prisma.bvAuditLog.count({ where: { orgId: w.orgId } }),
        usage: await prisma.bvUsageDaily.count({ where: { orgId: w.orgId } }),
      });
      const before = await count();
      for (let i = 0; i < 10; i++) {
        await vcaption(w.v, { text: `${secret} visitante ${i}`, final: i % 2 === 0 });
        await acaption(w.conv.id, w.agent, { text: `${secret} atendente ${i}`, final: i % 2 === 0 });
      }
      await until(() => w.staff.all('caption').length === 10 && w.visSock.all('caption').length === 10);
      expect(await count()).toEqual(before);
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT (
          (SELECT count(*) FROM "BvMessage" WHERE "orgId" = ${w.orgId} AND ("body" LIKE ${'%' + secret + '%'} OR "channelMeta"::text LIKE ${'%' + secret + '%'})) +
          (SELECT count(*) FROM "BvAuditLog" WHERE "orgId" = ${w.orgId} AND ("meta"::text LIKE ${'%' + secret + '%'} OR "after"::text LIKE ${'%' + secret + '%'})) +
          (SELECT count(*) FROM "BvConversation" WHERE "orgId" = ${w.orgId} AND "metadata"::text LIKE ${'%' + secret + '%'})
        ) AS n`;
      expect(Number(rows[0].n)).toBe(0);
    } finally { w.close(); }
  });
});

describe('legendas — widget.js (conteúdo estático)', () => {
  it('é JS válido, versão 1.1.0 e continua sem dependências externas', () => {
    expect(() => new vm.Script(WIDGET_JS)).not.toThrow();
    expect(WIDGET_JS).toContain('v1.1.0');
    expect(WIDGET_JS).toContain("version: '1.1.0'");
  });

  it('botão "Legendas" com aria-pressed, região aria-live para as legendas recebidas e evento caption do socket', () => {
    expect(WIDGET_JS).toContain("captions: 'Legendas'");
    expect(WIDGET_JS).toMatch(/el\.capBtn = h\('button', \{ type: 'button', class: 'sb', text: T\.captions, 'aria-pressed': 'false'/);
    expect(WIDGET_JS).toContain("setAttribute('aria-pressed', String(on))");
    // região viva (finais) + linhas parciais fora da região viva (leitores de tela não são inundados)
    expect(WIDGET_JS).toMatch(/el\.capLog = h\('div', \{ role: 'log', 'aria-live': 'polite'/);
    expect(WIDGET_JS).toMatch(/el\.capLive = \{ a: h\('p', \{ class: 'li' \}\), v: h\('p', \{ class: 'li' \}\) \}/);
    expect(WIDGET_JS).toMatch(/hidden: true \}, \[el\.capLog, el\.capLive\.a, el\.capLive\.v\]/);
    expect(WIDGET_JS).toContain("ev === 'caption' && d.from === 'AGENT'");
    expect(WIDGET_JS).toContain('[el.human, vid, el.capBtn, el.end]'); // dentro do grupo de ações
    // texto vindo do servidor entra por textContent/createTextNode (nunca innerHTML)
    for (const m of WIDGET_JS.matchAll(/innerHTML\s*=\s*([^;]+);/g)) expect(m[1].trim().startsWith("'<")).toBe(true);
  });

  it('captura de fala: SpeechRecognition/webkitSpeechRecognition em pt-BR com degradação graciosa e envio para /caption', () => {
    expect(WIDGET_JS).toContain('win.SpeechRecognition || win.webkitSpeechRecognition');
    expect(WIDGET_JS).toContain("r.lang = 'pt-BR'");
    expect(WIDGET_JS).toMatch(/r\.continuous = true; r\.interimResults = true/);
    expect(WIDGET_JS).toMatch(/api\('POST', '\/caption', \{ text: text\.slice\(0, 500\), final: !!final \}\)/);
    // sem suporte: avisa e segue só com as legendas do atendente; permissão negada desliga a captura
    expect(WIDGET_JS).toMatch(/if \(!SR\) \{ say\(T\.capNoSupport\); return; \}/);
    expect(WIDGET_JS).toContain('use Chrome ou Edge');
    expect(WIDGET_JS).toMatch(/e\.error === 'not-allowed' \|\| e\.error === 'service-not-allowed'/);
    expect(WIDGET_JS).toContain('capPriv'); // aviso de privacidade (áudio pode ir ao fornecedor do navegador)
    // parciais estrangulados e fala só enviada com conversa ativa
    expect(WIDGET_JS).toContain('n - lastCap < 400');
    expect(WIDGET_JS).toContain("st.status === 'none' || st.status === 'closed'");
  });

  it('sem <script data-org> o widget encerra silenciosamente (nenhum global exigido além do DOM)', () => {
    const ctx: any = { document: { currentScript: null, querySelector: () => null }, window: {}, console };
    ctx.window = ctx; vm.createContext(ctx);
    expect(() => vm.runInContext(WIDGET_JS, ctx)).not.toThrow(); // sem <script data-org>: encerra silenciosamente
    expect(ctx.__bvWebchat).toBeUndefined();
  });
});
