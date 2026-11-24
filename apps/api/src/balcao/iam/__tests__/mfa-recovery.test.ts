process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { hashToken } from '../../core/crypto';
import { makeOrg, makeUser } from '../../core/testing';
import { generateRecoveryCodes, normalizeRecoveryCode } from '../recovery';
import { totpCode } from '../totp';

jest.setTimeout(60_000);

const PW = 'SenhaForte12345';
let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try { const s = (body as Buffer).toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); }
  });
  const { default: iam } = await import('../index');
  await app.register(iam, { prefix: '/balcao' });
  await app.ready();
});
afterAll(async () => { await app.close(); });

const freshIp = () => `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
async function call(method: 'GET' | 'POST', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.inject({ method, url: `/balcao${url}`, payload: opts.body as any, headers: { 'x-forwarded-for': freshIp(), ...(opts.headers ?? {}) } });
  let json: any = null; try { json = res.json(); } catch { /* sem corpo */ }
  return { status: res.statusCode, json, headers: res.headers };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const login = (email: string) => call('POST', '/auth/login', { body: { email, password: PW } });

/** Usuário com MFA ativo + os códigos de recuperação devolvidos pelo enable. */
async function userWithMfa(role: 'ATENDENTE' | 'ADMIN' = 'ATENDENTE') {
  const org = await makeOrg();
  const u = await makeUser(org.id, role);
  const s = (await login(u.email)).json;
  const h = bearer(s.accessToken);
  const secret: string = (await call('POST', '/auth/mfa/setup', { headers: h })).json.secret;
  const en = await call('POST', '/auth/mfa/enable', { headers: h, body: { code: totpCode(secret) } });
  expect(en.status).toBe(200);
  return { org, u, secret, h, enable: en };
}
const mfaToken = async (email: string) => (await login(email)).json.mfaToken as string;

describe('iam — códigos de recuperação do MFA', () => {
  it('geração: 10 códigos XXXX-XXXX únicos, alfabeto sem ambiguidade; normalização aceita variações', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(hashes[0]).toBe(hashToken(`mfa-recovery:${codes[0]}`));
    expect(normalizeRecoveryCode(codes[0].toLowerCase().replace('-', ' '))).toBe(codes[0]);
    expect(normalizeRecoveryCode('curto')).toBeNull();
  });

  it('enable devolve os códigos uma vez (no-store) e guarda só os hashes; /me informa quantos restam', async () => {
    const { u, h, enable } = await userWithMfa();
    const codes: string[] = enable.json.recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(enable.json.recoveryCodesRemaining).toBe(10);
    expect(enable.headers['cache-control']).toBe('no-store');
    const row = await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaRecoveryHashes).toHaveLength(10);
    for (const c of codes) {
      expect(row.mfaRecoveryHashes).toContain(hashToken(`mfa-recovery:${c}`));
      expect(row.mfaRecoveryHashes).not.toContain(c);
      expect(row.mfaRecoveryHashes.some((x) => x.includes(c))).toBe(false);
    }
    const me = await call('GET', '/auth/me', { headers: h });
    expect(me.json.recoveryCodesRemaining).toBe(10);
    expect(JSON.stringify(me.json)).not.toContain(row.mfaRecoveryHashes[0]);
  });

  it('login com recoveryCode: uso único, reuso recusado, avisa quantos restam e audita', async () => {
    const { org, u, enable } = await userWithMfa();
    const [c1, c2] = enable.json.recoveryCodes as string[];

    const ok = await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: c1.toLowerCase() } }); // minúsculas também vale
    expect(ok.status).toBe(200);
    expect(ok.json.accessToken).toBeTruthy();
    expect(ok.json.recoveryCodesRemaining).toBe(9);
    expect((await call('GET', '/auth/me', { headers: bearer(ok.json.accessToken) })).json.recoveryCodesRemaining).toBe(9);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'auth.mfa_recovery_used', entityId: u.id } })).toBe(1);
    const log = await prisma.bvAuditLog.findFirstOrThrow({ where: { orgId: org.id, action: 'auth.mfa_recovery_used' } });
    expect(JSON.stringify(log)).not.toContain(c1);

    // reuso do mesmo código: recusado (e conta como falha)
    const reuse = await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: c1 } });
    expect(reuse.status).toBe(401);
    expect(reuse.json.error.code).toBe('auth.invalid_recovery_code');
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBeGreaterThan(0);

    // outro código ainda vale; formato inválido -> 400; code e recoveryCode juntos -> 400
    const t = await mfaToken(u.email);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: t, recoveryCode: c2.replace('-', '') } })).json.recoveryCodesRemaining).toBe(8);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: t, code: '123456', recoveryCode: c2 } })).status).toBe(400);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: t } })).status).toBe(400);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: t, recoveryCode: 'XXXX-XXXX-XXXX' } })).status).toBe(401);
  });

  it('uso concorrente do mesmo código: só uma sessão é criada', async () => {
    const { u, enable } = await userWithMfa();
    const code = enable.json.recoveryCodes[0] as string;
    const tokens = await Promise.all([1, 2, 3].map(() => mfaToken(u.email)));
    const rs = await Promise.all(tokens.map((t) => call('POST', '/auth/login/mfa', { body: { mfaToken: t, recoveryCode: code } })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).mfaRecoveryHashes).toHaveLength(9);
  });

  it('avisa quando poucos códigos restam e quando acabam', async () => {
    const { u, enable } = await userWithMfa();
    const codes = enable.json.recoveryCodes as string[];
    let last: any;
    for (const c of codes) {
      last = (await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: c } })).json;
      expect(last.accessToken).toBeTruthy();
    }
    expect(last.recoveryCodesRemaining).toBe(0);
    expect(last.recoveryCodesWarning).toBeTruthy();
  });

  it('regenerate: exige senha + TOTP, devolve novo conjunto e invalida o anterior', async () => {
    const { u, secret, enable } = await userWithMfa();
    const old = enable.json.recoveryCodes as string[];
    const s = (await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: old[0] } })).json;
    const h = bearer(s.accessToken);

    expect((await call('POST', '/auth/mfa/recovery-codes/regenerate', { headers: h, body: { password: 'errada-errada-1', code: totpCode(secret, Date.now(), 1) } })).status).toBe(403);
    expect((await call('POST', '/auth/mfa/recovery-codes/regenerate', { headers: h, body: { password: PW, code: totpCode(secret, Date.now(), 5) } })).status).toBe(403);
    expect((await call('POST', '/auth/mfa/recovery-codes/regenerate', {})).status).toBe(401);
    const re = await call('POST', '/auth/mfa/recovery-codes/regenerate', { headers: h, body: { password: PW, code: totpCode(secret, Date.now(), 1) } });
    expect(re.status).toBe(200);
    expect(re.headers['cache-control']).toBe('no-store');
    const fresh = re.json.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(re.json.recoveryCodesRemaining).toBe(10);
    expect(fresh.some((c) => old.includes(c))).toBe(false);

    // os antigos (inclusive os não usados) não valem mais; os novos valem
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: old[1] } })).status).toBe(401);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: await mfaToken(u.email), recoveryCode: fresh[0] } })).status).toBe(200);
    expect(await prisma.bvAuditLog.count({ where: { orgId: u.orgId, action: 'auth.mfa_recovery_regenerate' } })).toBe(1);
  });

  it('regenerate sem MFA ativo -> 409', async () => {
    const org = await makeOrg(); const u = await makeUser(org.id, 'ATENDENTE');
    const s = (await login(u.email)).json;
    expect((await call('POST', '/auth/mfa/recovery-codes/regenerate', { headers: bearer(s.accessToken), body: { password: PW, code: '123456' } })).status).toBe(409);
  });

  it('lockout continua valendo com recoveryCode errado; conta bloqueada recusa até o código certo', async () => {
    const { u, enable } = await userWithMfa();
    const t = await mfaToken(u.email);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: t, recoveryCode: `AAAA-AAA${i + 2}` } })).status).toBe(401);
    const locked = await call('POST', '/auth/login/mfa', { body: { mfaToken: t, recoveryCode: enable.json.recoveryCodes[0] } });
    expect(locked.status).toBe(423);
    expect(locked.json.error.code).toBe('auth.locked');
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).mfaRecoveryHashes).toHaveLength(10); // nada consumido
  });

  it('disable e reset-mfa do admin limpam os hashes', async () => {
    const a = await userWithMfa();
    const secret = a.secret;
    expect((await call('POST', '/auth/mfa/disable', { headers: a.h, body: { password: PW, code: totpCode(secret, Date.now(), 1) } })).status).toBe(200);
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: a.u.id } })).mfaRecoveryHashes).toHaveLength(0);
    expect((await call('GET', '/auth/me', { headers: a.h })).json.recoveryCodesRemaining).toBe(0);

    const b = await userWithMfa();
    const admin = await makeUser(b.org.id, 'ADMIN');
    const as = (await login(admin.email)).json;
    const rm = await call('POST', `/admin/users/${b.u.id}/reset-mfa`, { headers: bearer(as.accessToken) });
    expect(rm.status).toBe(200);
    const row = await prisma.bvUser.findUniqueOrThrow({ where: { id: b.u.id } });
    expect(row.mfaRecoveryHashes).toHaveLength(0);
    expect(row.totpEnabled).toBe(false);
    expect(JSON.stringify(rm.json)).not.toContain('mfaRecoveryHashes');
  });
});
