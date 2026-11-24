process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import Fastify, { type FastifyInstance } from 'fastify';
import MailComposer from 'nodemailer/lib/mail-composer';
import { prisma } from '../../../../lib/prisma';
import { sendMessage, ingestInbound } from '../../../core/conversations';
import { saveIntegration } from '../../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../../core/testing';
import emailPlugin from '../index';
import { loadEmailConfig } from '../config';
import { imapPoller, setImapClientFactory } from '../imap';
import {
  assertTokenUrl, clearOAuthTokenCache, DEFAULT_TOKEN_URL, getAccessToken, OAuthError, REFRESH_SKEW_MS, resolveImapConfig, resolveSmtpConfig, setOAuthClock, setOAuthTokenFetcher,
} from '../oauth';
import { defaultTransportFactory, setMailTransportFactory } from '../outbound';
import type { ImapClientFactory, ImapConfig, MailTransport, OAuth2Auth, SmtpConfig } from '../types';

const OWN = 'balcao@gsuite.test';
const CLIENT_SECRET = 'GOCSPX-client-secret-ABC123';
const REFRESH = '1//refresh-token-DEF456-very-secret';

// ── servidor de token falso (Google) ──────────────────────────────────────────────────────────────
interface TokenServer { url: string; hits: Array<Record<string, string>>; issued: string[]; mode: 'ok' | 'invalid_grant' | 'down' | 'html'; expiresIn: number; close(): Promise<void> }
async function tokenServer(): Promise<TokenServer> {
  const state: TokenServer = { url: '', hits: [], issued: [], mode: 'ok', expiresIn: 3600, close: async () => undefined };
  const srv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/token') { res.writeHead(404); res.end(); return; }
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()).entries());
      state.hits.push({ ...form, 'content-type': String(req.headers['content-type']) });
      if (state.mode === 'down') { req.socket.destroy(); return; }
      if (state.mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); return; }
      if (state.mode === 'invalid_grant' || form.grant_type !== 'refresh_token' || form.client_secret !== CLIENT_SECRET || form.refresh_token !== REFRESH) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: `Token has been expired or revoked. ${form.refresh_token}` }));
        return;
      }
      const token = `ya29.fake-access-${state.hits.length}`;
      state.issued.push(token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: token, expires_in: state.expiresIn, token_type: 'Bearer' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/token`;
  state.close = () => new Promise<void>((r) => srv.close(() => r()));
  return state;
}

const authOf = (url: string, over: Partial<OAuth2Auth> = {}): OAuth2Auth => ({ type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: CLIENT_SECRET, refreshToken: REFRESH, user: OWN, tokenUrl: url, ...over });

let ts: TokenServer;
let clock = 1_000_000_000_000;
beforeEach(async () => { ts = await tokenServer(); clearOAuthTokenCache(); clock = 1_000_000_000_000; setOAuthClock(() => clock); });
afterEach(async () => { await ts.close(); setOAuthClock(); setOAuthTokenFetcher(); clearOAuthTokenCache(); setImapClientFactory(); setMailTransportFactory(); });

describe('oauth2 — token (servidor de token falso)', () => {
  it('busca com grant_type=refresh_token (form) e guarda em cache; padrão é o endpoint do Google', async () => {
    const a = authOf(ts.url);
    const t1 = await getAccessToken(a);
    expect(t1).toBe('ya29.fake-access-1');
    expect(ts.hits).toHaveLength(1);
    expect(ts.hits[0]).toMatchObject({ grant_type: 'refresh_token', client_id: a.clientId, client_secret: CLIENT_SECRET, refresh_token: REFRESH, 'content-type': 'application/x-www-form-urlencoded' });
    expect(await getAccessToken(a)).toBe(t1);
    expect(ts.hits).toHaveLength(1); // cache
    expect(DEFAULT_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    // sem tokenUrl usa o padrão (busca injetada para não sair da máquina)
    const seen: string[] = [];
    setOAuthTokenFetcher(async (_a, url) => { seen.push(url); return { accessToken: 'x'.repeat(20), expiresInSec: 3600 }; });
    await getAccessToken(authOf('', { tokenUrl: undefined }));
    expect(seen).toEqual([DEFAULT_TOKEN_URL]);
  });

  it('renova ~1 min antes de expirar (relógio injetável) e não antes', async () => {
    ts.expiresIn = 3600;
    const a = authOf(ts.url);
    await getAccessToken(a);
    clock += 3600_000 - REFRESH_SKEW_MS - 1000; // faltam 61 s
    await getAccessToken(a);
    expect(ts.hits).toHaveLength(1);
    clock += 2000; // faltam 59 s → renova
    const t2 = await getAccessToken(a);
    expect(ts.hits).toHaveLength(2);
    expect(t2).toBe('ya29.fake-access-2');
    expect(REFRESH_SKEW_MS).toBe(60_000);
  });

  it('chamadas concorrentes dividem uma única renovação; force ignora o cache; contas diferentes têm caches separados', async () => {
    const a = authOf(ts.url);
    const all = await Promise.all(Array.from({ length: 8 }, () => getAccessToken(a)));
    expect(new Set(all).size).toBe(1);
    expect(ts.hits).toHaveLength(1);
    const forced = await getAccessToken(a, { force: true });
    expect(ts.hits).toHaveLength(2);
    expect(forced).not.toBe(all[0]);
    await getAccessToken(authOf(ts.url, { user: 'outra@gsuite.test' }));
    expect(ts.hits).toHaveLength(3);
  });

  it('falhas viram OAuthError sem vazar client secret/refresh token (invalid_grant, servidor fora, resposta não-JSON)', async () => {
    const a = authOf(ts.url);
    ts.mode = 'invalid_grant';
    const e1 = await getAccessToken(a).catch((e) => e);
    expect(e1).toBeInstanceOf(OAuthError);
    expect(e1).toMatchObject({ code: 'oauth2.refresh_failed', oauthError: 'invalid_grant' });
    expect(e1.message).toContain('invalid_grant');
    ts.mode = 'down';
    expect(await getAccessToken(a).catch((e) => e)).toMatchObject({ code: 'oauth2.unreachable' });
    ts.mode = 'html';
    expect(await getAccessToken(a).catch((e) => e)).toMatchObject({ code: 'oauth2.refresh_failed' });
    ts.mode = 'ok';
    expect(await getAccessToken(a)).toMatch(/^ya29\./); // falha não envenena o cache
  });

  it('tokenUrl: https obrigatório fora de teste/dev; sem credenciais embutidas; inválida recusada', () => {
    expect(() => assertTokenUrl('https://oauth2.googleapis.com/token')).not.toThrow();
    expect(() => assertTokenUrl('ftp://x/token')).toThrow(/https/);
    expect(() => assertTokenUrl('não é url')).toThrow(/inválida/);
    expect(() => assertTokenUrl('https://user:pw@x.test/token')).toThrow(/credenciais/);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => assertTokenUrl('http://127.0.0.1:1/token')).toThrow(/https/);
      process.env.BV_EMAIL_OAUTH_ALLOW_HTTP = '1';
      expect(() => assertTokenUrl('http://127.0.0.1:1/token')).not.toThrow();
    } finally { process.env.NODE_ENV = prev; delete process.env.BV_EMAIL_OAUTH_ALLOW_HTTP; }
  });

  it('resolveImapConfig/resolveSmtpConfig: com OAuth2 devolvem usuário da conta + accessToken e sem senha; sem OAuth2 devolvem a config como está', async () => {
    const base = { from: { name: '', address: OWN }, mailbox: 'INBOX', pollIntervalSec: 30 };
    const imap: ImapConfig = { host: 'imap.gmail.com', port: 993, secure: true, user: 'x@y', pass: 'p' };
    const smtp: SmtpConfig = { host: 'smtp.gmail.com', port: 465, secure: true, user: 'x@y', pass: 'p' };
    const o = { ...base, imap, smtp, auth: authOf(ts.url) };
    const i = await resolveImapConfig(o); const s = await resolveSmtpConfig(o);
    expect(i).toMatchObject({ host: 'imap.gmail.com', user: OWN, accessToken: 'ya29.fake-access-1' }); expect(i.pass).toBeUndefined();
    expect(s).toMatchObject({ host: 'smtp.gmail.com', user: OWN, accessToken: 'ya29.fake-access-1' }); expect(s.pass).toBeUndefined();
    expect(ts.hits).toHaveLength(1);
    expect(await resolveImapConfig({ ...base, imap, smtp })).toBe(imap);
    expect(await resolveSmtpConfig({ ...base, imap, smtp })).toBe(smtp);
  });
});

// ── Adaptadores reais: imapflow (XOAUTH2) e nodemailer (OAuth2) ──────────────────────────────────────
describe('oauth2 — adaptadores reais', () => {
  it('nodemailer: SMTP real (servidor mínimo) autentica com XOAUTH2 usando o access token obtido', async () => {
    const logins: string[] = [];
    const smtp = net.createServer((sock) => {
      sock.write('220 smtp.fake ESMTP\r\n');
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (/^EHLO/i.test(line)) sock.write('250-smtp.fake\r\n250-AUTH XOAUTH2\r\n250 OK\r\n');
          else if (/^AUTH XOAUTH2 /i.test(line)) { logins.push(Buffer.from(line.slice(13), 'base64').toString('utf8')); sock.write('235 2.7.0 Accepted\r\n'); }
          else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
    try {
      const cfg = { imap: { host: 'x', port: 1, secure: true, user: OWN }, smtp: { host: '127.0.0.1', port: (smtp.address() as AddressInfo).port, secure: false, user: OWN, pass: 'ignorada' }, from: { name: '', address: OWN }, mailbox: 'INBOX', pollIntervalSec: 30, auth: authOf(ts.url) };
      const t = defaultTransportFactory(await resolveSmtpConfig(cfg));
      await t.verify?.();
      t.close?.();
      expect(logins).toEqual([`user=${OWN}\x01auth=Bearer ya29.fake-access-1\x01\x01`]);
    } finally { await new Promise<void>((r) => smtp.close(() => r())); }
  });

  it('imapflow: a conexão usa auth.accessToken (XOAUTH2) e nunca a senha', async () => {
    jest.resetModules();
    const ctor = jest.fn();
    jest.doMock('imapflow', () => ({ ImapFlow: class { constructor(o: unknown) { ctor(o); } on() { return this; } async connect() { return undefined; } } }));
    try {
      const { imapFlowFactory } = await import('../imap');
      await imapFlowFactory.connect({ host: 'imap.gmail.com', port: 993, secure: true, user: OWN, accessToken: 'ya29.tok' });
      expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ host: 'imap.gmail.com', auth: { user: OWN, accessToken: 'ya29.tok' } }));
      await imapFlowFactory.connect({ host: 'h', port: 993, secure: true, user: OWN, pass: 'senha' });
      expect(ctor).toHaveBeenLastCalledWith(expect.objectContaining({ auth: { user: OWN, pass: 'senha' } }));
    } finally { jest.dontMock('imapflow'); jest.resetModules(); }
  });
});

// ── Integração: config, teste, coleta e envio ─────────────────────────────────────────────────────────
let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => { try { const s = body.toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); } });
  await app.register(emailPlugin, { prefix: '/balcao/email' });
  await app.ready();
});
afterAll(async () => { await app.close(); });

const oauthInput = (url: string, over: Record<string, any> = {}) => ({
  imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  auth: { type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: CLIENT_SECRET, refreshToken: REFRESH, user: OWN, tokenUrl: url },
  from: { name: 'Balcão Virtual', address: OWN }, ...over,
});

async function admin() {
  const org = await makeOrg({ ai: { enabled: false } });
  const user = await makeUser(org.id, 'ADMIN');
  return { org, orgId: org.id, h: authHeader(user) };
}

describe('oauth2 — PUT/GET /config (segredos cifrados e mascarados)', () => {
  it('aceita OAuth2 sem senha (usuário vem de auth.user), mascara clientSecret/refreshToken, cifra em repouso e audita sem segredos', async () => {
    const a = await admin();
    const put = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    expect(put.statusCode).toBe(200);
    const cfg = put.json().config;
    expect(cfg.auth).toEqual({ type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: '••••••', refreshToken: '••••••', user: OWN, tokenUrl: ts.url });
    expect(cfg.imap.user).toBe(OWN); expect(cfg.smtp.user).toBe(OWN);
    expect(JSON.stringify(put.json())).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(put.json())).not.toContain(REFRESH);

    const row = await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: a.orgId, type: 'EMAIL_IMAP' } });
    expect(row.configEnc).not.toContain(CLIENT_SECRET); expect(row.configEnc).not.toContain('refreshToken');
    const saved = (await loadEmailConfig(a.orgId))!.config;
    expect(saved.auth).toMatchObject({ clientSecret: CLIENT_SECRET, refreshToken: REFRESH });
    expect(saved.imap.pass).toBeUndefined(); expect(saved.smtp.pass).toBeUndefined();

    const get = await app.inject({ method: 'GET', url: '/balcao/email/config', headers: a.h });
    expect(get.json().config.auth).toMatchObject({ clientSecret: '••••••', refreshToken: '••••••', user: OWN });
    expect(JSON.stringify(get.json())).not.toContain(REFRESH);

    const audits = await prisma.bvAuditLog.findMany({ where: { orgId: a.orgId, action: 'config.update' } });
    const versions = await prisma.bvConfigVersion.findMany({ where: { orgId: a.orgId, entityType: 'EMAIL_IMAP' } });
    expect(JSON.stringify([audits, versions])).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify([audits, versions])).not.toContain(REFRESH);
  });

  it('reenviar com "••••••"/omitido preserva os segredos; trocar de conta exige novo refreshToken; faltando segredo → 400', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    const masked = oauthInput(ts.url, { auth: { type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: '••••••', user: OWN, tokenUrl: '••••••' } });
    const again = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: masked });
    expect(again.statusCode).toBe(200);
    expect((await loadEmailConfig(a.orgId))!.config.auth).toMatchObject({ clientSecret: CLIENT_SECRET, refreshToken: REFRESH, tokenUrl: ts.url });

    const other = oauthInput(ts.url, { auth: { type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: '••••••', user: 'outra@gsuite.test' } });
    const sw = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: other });
    expect(sw.statusCode).toBe(400);
    expect(sw.json().error).toMatchObject({ code: 'email.credentials_required' });
    expect(JSON.stringify(sw.json().error.details)).toContain('refreshToken');

    const fresh = await admin();
    const no = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: fresh.h, payload: oauthInput(ts.url, { auth: { type: 'oauth2', clientId: 'c', user: OWN } }) });
    expect(no.statusCode).toBe(400);
    expect(JSON.stringify(no.json().error.details)).toContain('clientSecret');
    const badUrl = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: fresh.h, payload: oauthInput('ftp://x/y') });
    expect(badUrl.statusCode).toBe(400);
    expect(JSON.stringify(badUrl.json().error.details)).toContain('tokenUrl');
    const badAuth = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: fresh.h, payload: oauthInput(ts.url, { auth: { type: 'basic', clientId: 'c', user: OWN } }) });
    expect(badAuth.statusCode).toBe(400);
  });

  it('migrar de senha para OAuth2 remove a senha guardada', async () => {
    const a = await admin();
    await saveIntegration(a.orgId, 'EMAIL_IMAP', { imap: { host: 'imap.gmail.com', port: 993, secure: true, user: OWN, pass: 'senha-antiga-123' }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: OWN, pass: 'senha-antiga-456' }, from: { name: '', address: OWN }, mailbox: 'INBOX', pollIntervalSec: 30 });
    const r = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url, { imap: { host: 'imap.gmail.com', port: 993, secure: true, user: OWN, pass: '••••••' } }) });
    expect(r.statusCode).toBe(200);
    const saved = (await loadEmailConfig(a.orgId))!.config;
    expect(saved.imap.pass).toBeUndefined(); expect(saved.smtp.pass).toBeUndefined();
  });
});

function captureFactories() {
  const imapCfgs: ImapConfig[] = []; const smtpCfgs: SmtpConfig[] = []; const sent: any[] = [];
  const msgs: Array<{ uid: number; raw: Buffer }> = [];
  const imap = (failFirstWith?: any): ImapClientFactory => {
    let n = 0;
    return {
      async connect(cfg) {
        imapCfgs.push(cfg);
        if (failFirstWith && n++ === 0) throw failFirstWith;
        return {
          async openMailbox() { return { uidValidity: 7n, uidNext: msgs.length + 1 }; },
          async fetchNew({ afterUid, limit }) { const c = msgs.filter((m) => m.uid > afterUid).slice(0, limit); return { messages: c.map((m) => ({ uid: m.uid, size: m.raw.length, raw: m.raw })), hasMore: false }; },
          async markSeen() { /* noop */ }, async close() { /* noop */ },
        };
      },
    };
  };
  const smtp = (failFirst?: any) => { let n = 0; return (cfg: SmtpConfig): MailTransport => { smtpCfgs.push(cfg); const mine = n++; return { async sendMail(mail: any) { if (failFirst && mine === 0) throw failFirst; sent.push(mail); return { messageId: mail.messageId, accepted: [mail.to], rejected: [] }; }, async verify() { if (failFirst && mine === 0) throw failFirst; return true; }, close() { /* noop */ } }; }; };
  return { imapCfgs, smtpCfgs, sent, msgs, imap, smtp };
}

describe('oauth2 — POST /config/test, coleta IMAP e envio SMTP', () => {
  it('/config/test exercita o fluxo: busca o token e o entrega ao IMAP (XOAUTH2) e ao SMTP (OAuth2)', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    const cap = captureFactories();
    setImapClientFactory(cap.imap()); setMailTransportFactory(cap.smtp());
    const r = await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: a.h, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, imap: { ok: true }, smtp: { ok: true } });
    expect(ts.hits).toHaveLength(1); // um token serve aos dois
    expect(cap.imapCfgs[0]).toMatchObject({ user: OWN, accessToken: ts.issued[0], host: 'imap.gmail.com' }); expect(cap.imapCfgs[0].pass).toBeUndefined();
    expect(cap.smtpCfgs[0]).toMatchObject({ user: OWN, accessToken: ts.issued[0], host: 'smtp.gmail.com' }); expect(cap.smtpCfgs[0].pass).toBeUndefined();
    expect((await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: a.orgId, type: 'EMAIL_IMAP' } })).status).toBe('OK');
  });

  it('/config/test com refresh token revogado: imap e smtp falham com motivo claro, sem vazar segredos; status ERROR', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    ts.mode = 'invalid_grant';
    const cap = captureFactories();
    setImapClientFactory(cap.imap()); setMailTransportFactory(cap.smtp());
    const r = await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: a.h, payload: {} });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.ok).toBe(false);
    expect(b.imap.error).toContain('invalid_grant'); expect(b.smtp.error).toContain('invalid_grant');
    expect(JSON.stringify(b)).not.toContain(REFRESH); expect(JSON.stringify(b)).not.toContain(CLIENT_SECRET);
    expect(cap.imapCfgs).toHaveLength(0); // nem chegou a conectar
    expect((await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: a.orgId, type: 'EMAIL_IMAP' } })).status).toBe('ERROR');
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId: a.orgId, operation: 'config.test' } });
    expect(JSON.stringify(logs)).not.toContain(REFRESH);
  });

  it('/config/test com corpo (config ainda não salva): testa com os dados enviados e segredos mascarados herdam os salvos', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    const cap = captureFactories();
    setImapClientFactory(cap.imap()); setMailTransportFactory(cap.smtp());
    const r = await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: a.h, payload: { auth: { type: 'oauth2', clientId: 'cid.apps.googleusercontent.com', clientSecret: '••••••', refreshToken: '••••••', user: OWN, tokenUrl: ts.url } } });
    expect(r.json()).toMatchObject({ ok: true });
    expect(cap.imapCfgs[0].accessToken).toBe(ts.issued[0]);
  });

  it('coleta (poll): usa o token, reaproveita o cache entre coletas e renova ao se aproximar da expiração', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    const cap = captureFactories();
    setImapClientFactory(cap.imap());
    const mail = async (n: number) => new MailComposer({ from: { name: 'Maria', address: 'maria@cidadao.test' }, to: OWN, subject: `Dúvida ${n}`, text: `corpo ${n}`, messageId: `<oauth-${Date.now()}-${n}@cidadao.test>` }).compile().build();
    cap.msgs.push({ uid: 1, raw: await mail(1) });
    const p1 = await imapPoller.pollOrg(a.orgId, { force: true });
    expect(p1).toMatchObject({ polled: true, ingested: 1 });
    cap.msgs.push({ uid: 2, raw: await mail(2) });
    const p2 = await imapPoller.pollOrg(a.orgId, { force: true });
    expect(p2).toMatchObject({ ingested: 1 });
    expect(ts.hits).toHaveLength(1);
    expect(cap.imapCfgs.map((c) => c.accessToken)).toEqual([ts.issued[0], ts.issued[0]]);
    clock += 3600_000 - REFRESH_SKEW_MS + 1000; // faltam < 60 s
    cap.msgs.push({ uid: 3, raw: await mail(3) });
    const p3 = await imapPoller.pollOrg(a.orgId, { force: true });
    expect(p3).toMatchObject({ ingested: 1 });
    expect(ts.hits).toHaveLength(2);
    expect(cap.imapCfgs[2].accessToken).toBe(ts.issued[1]);
  });

  it('servidor IMAP recusa o token em cache (revogado antes do previsto): renova uma vez e reconecta', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    await getAccessToken((await loadEmailConfig(a.orgId))!.config.auth!); // token #1 em cache
    const cap = captureFactories();
    setImapClientFactory(cap.imap(Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })));
    const p = await imapPoller.pollOrg(a.orgId, { force: true });
    expect(p.error).toBeUndefined();
    expect(cap.imapCfgs.map((c) => c.accessToken)).toEqual([ts.issued[0], ts.issued[1]]);
  });

  it('falha de renovação na coleta grava lastError/ERROR sem segredos', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    ts.mode = 'invalid_grant';
    setImapClientFactory(captureFactories().imap());
    const p = await imapPoller.pollOrg(a.orgId, { force: true });
    expect(p.error).toContain('invalid_grant');
    expect(p.error).not.toContain(REFRESH);
    const mb = await prisma.bvMailbox.findFirstOrThrow({ where: { orgId: a.orgId } });
    expect(mb.lastError).toContain('invalid_grant');
    expect(mb.lastError).not.toContain(REFRESH);
  });

  it('envio: o SMTP recebe o access token; 535 do servidor → renova e reenvia; refresh falho → FAILED com código estável', async () => {
    const a = await admin();
    await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: a.h, payload: oauthInput(ts.url) });
    const agent = await makeUser(a.orgId, 'ATENDENTE');
    const open = async (n: string) => (await ingestInbound({ orgId: a.orgId, channel: 'EMAIL', channelRef: `<root-${n}@c.test>`, externalId: `c${n}@cidadao.test`, name: 'Cidadã', email: `c${n}@cidadao.test`, subject: 'Pedido', message: { kind: 'TEXT', body: 'oi', channelMessageId: `<in-${n}-${Date.now()}@c.test>` } })).conversation;

    let cap = captureFactories();
    setMailTransportFactory(cap.smtp());
    const c1 = await open('1');
    const m1 = await sendMessage({ orgId: a.orgId, conversationId: c1.id, senderType: 'AGENT', userId: agent.id, body: 'Resposta 1' });
    expect(m1.message.status).toBe('SENT');
    expect(cap.smtpCfgs[0]).toMatchObject({ user: OWN, accessToken: ts.issued[0] }); expect(cap.smtpCfgs[0].pass).toBeUndefined();
    expect(cap.sent).toHaveLength(1);

    cap = captureFactories();
    setMailTransportFactory(cap.smtp(Object.assign(new Error('535 5.7.8 Username and Password not accepted'), { responseCode: 535, response: '535 5.7.8 invalid credentials' })));
    const c2 = await open('2');
    const m2 = await sendMessage({ orgId: a.orgId, conversationId: c2.id, senderType: 'AGENT', userId: agent.id, body: 'Resposta 2' });
    expect(m2.message.status).toBe('SENT');
    expect(cap.smtpCfgs.map((c) => c.accessToken)).toEqual([ts.issued[0], ts.issued[1]]); // renovou e reenviou
    expect(cap.sent).toHaveLength(1);

    ts.mode = 'invalid_grant'; clearOAuthTokenCache();
    cap = captureFactories(); setMailTransportFactory(cap.smtp());
    const c3 = await open('3');
    const m3 = await sendMessage({ orgId: a.orgId, conversationId: c3.id, senderType: 'AGENT', userId: agent.id, body: 'Resposta 3' });
    expect(m3.message.status).toBe('FAILED');
    expect(m3.error).toBe('email.oauth_failed');
    expect(cap.sent).toHaveLength(0);
  });
});
