process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { decryptField } from '../../core/crypto';
import { getHolidays } from '../../core/settings';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { verifyPassword } from '../../core/passwords';
import { createOrgWithAdmin } from '../service';
import { seedDemo, nationalHolidays } from '../../cli/seed-demo';
import { totpCode } from '../totp';

jest.setTimeout(60_000);

const PW = 'SenhaForte12345';
let app: FastifyInstance;

beforeAll(async () => {
  // App mínimo só com a frente IAM (não depende das outras frentes, que mudam em paralelo).
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try { const s = (body as Buffer).toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); }
  });
  const { default: iam } = await import('../index');
  await app.register(iam, { prefix: '/balcao' });
  await app.ready();
});
afterAll(async () => { await app.close(); });

// IP único por chamada de teste: o rate limit de login é por IP+org e o Redis é compartilhado entre execuções.
const freshIp = () => `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string>; ip?: string } = {}) {
  const res = await app.inject({ method, url: `/balcao${url}`, payload: opts.body as any, headers: { 'x-forwarded-for': opts.ip ?? freshIp(), ...(opts.headers ?? {}) } });
  let json: any = null;
  try { json = res.json(); } catch { /* corpo não-JSON (csv) */ }
  return { status: res.statusCode, json, text: res.body, headers: res.headers };
}
const login = (email: string, password = PW, orgSlug?: string, ip?: string) => call('POST', '/auth/login', { body: { email, password, orgSlug }, ip });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function loginOk(email: string, password = PW, orgSlug?: string) {
  const r = await login(email, password, orgSlug);
  expect(r.status).toBe(200);
  return r.json as { accessToken: string; refreshToken: string; [k: string]: any };
}
async function orgWith(roles: Array<'ADMIN' | 'SUPERVISOR' | 'ATENDENTE' | 'FISCAL'> = ['ADMIN']) {
  const org = await makeOrg();
  const users: Record<string, Awaited<ReturnType<typeof makeUser>>> = {};
  for (const r of roles) users[r] = await makeUser(org.id, r, { password: PW });
  return { org, users, admin: users.ADMIN };
}

describe('iam — login, sessão e senha', () => {
  it('login ok devolve sessão; /me traz perfil, permissões e flags; erro é genérico e auditado', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const ok = await loginOk(admin.email);
    expect(ok.user).toMatchObject({ id: admin.id, role: 'ADMIN', orgId: org.id });
    expect(ok.mfaSetupRequired).toBe(false);

    const me = await call('GET', '/auth/me', { headers: bearer(ok.accessToken) });
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(admin.email);
    expect(me.json.user.passwordHash).toBeUndefined();
    expect(me.json.permissions).toContain('user:manage');
    expect(me.json).toMatchObject({ mustChangePassword: false, totpEnabled: false });

    const wrongPw = await login(admin.email, 'senha-errada-123');
    const unknown = await login('naoexiste@teste.local', PW, org.slug);
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.json.error.message).toBe(unknown.json.error.message); // sem enumeração de usuários

    const actions = (await prisma.bvAuditLog.findMany({ where: { orgId: org.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'auth.login_failed']));
    expect((await call('GET', '/auth/me')).status).toBe(401);
  });

  it('bloqueia a conta após 5 falhas por 15 min (mesmo com senha correta) e libera depois', async () => {
    const { org, users } = await orgWith(['ATENDENTE']);
    const u = users.ATENDENTE;
    for (let i = 0; i < 5; i++) expect((await login(u.email, 'errada-errada-1')).status).toBe(401);
    const locked = await login(u.email, PW);
    expect(locked.status).toBe(423);
    expect(locked.json.error.code).toBe('auth.locked');
    const row = await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect((await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'auth.lockout' } }))).toBe(1);

    await prisma.bvUser.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await loginOk(u.email);
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(0);
  });

  it('rate limit por IP+órgão no login (429) sem depender do plugin global', async () => {
    const { org, users } = await orgWith(['ATENDENTE']);
    const ip = freshIp();
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await login(users.ATENDENTE.email, PW, org.slug, ip)).status;
    expect(last).toBe(429);
  });

  it('e-mail em dois órgãos exige orgSlug (só revelado com a senha correta)', async () => {
    const a = await makeOrg(); const b = await makeOrg();
    const email = `dup${crypto.randomBytes(3).toString('hex')}@teste.local`;
    await makeUser(a.id, 'ATENDENTE', { email, password: PW });
    await makeUser(b.id, 'SUPERVISOR', { email, password: PW });
    const amb = await login(email, PW);
    expect(amb.status).toBe(409);
    expect(amb.json.error.code).toBe('auth.org_required');
    expect((await login(email, 'errada-errada-1')).status).toBe(401);
    expect((await loginOk(email, PW, a.slug)).user.role).toBe('ATENDENTE');
    expect((await loginOk(email, PW, b.slug)).user.role).toBe('SUPERVISOR');
  });

  it('refresh rotaciona o token; reuso do antigo revoga todas as sessões e é auditado', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const s1 = await loginOk(admin.email);
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.json.refreshToken).not.toBe(s1.refreshToken);
    expect((await call('GET', '/auth/me', { headers: bearer(r1.json.accessToken) })).status).toBe(200);

    const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } });
    expect(reuse.status).toBe(401);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: r1.json.refreshToken } })).status).toBe(401); // sessão nova também caiu
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'auth.refresh_reuse' } })).toBe(1);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: 'bvr_inexistente_inexistente' } })).status).toBe(401);
  });

  it('logout revoga a sessão (por access token ou só pelo refresh token)', async () => {
    const { admin } = await orgWith(['ADMIN']);
    const s1 = await loginOk(admin.email);
    expect((await call('POST', '/auth/logout', { headers: bearer(s1.accessToken), body: {} })).status).toBe(200);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } })).status).toBe(401);

    const s2 = await loginOk(admin.email);
    expect((await call('POST', '/auth/logout', { body: { refreshToken: s2.refreshToken } })).status).toBe(200);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s2.refreshToken } })).status).toBe(401);
  });

  it('troca de senha: valida atual e política, revoga as outras sessões, limpa mustChangePassword', async () => {
    const { users } = await orgWith(['ATENDENTE']);
    const u = users.ATENDENTE;
    await prisma.bvUser.update({ where: { id: u.id }, data: { mustChangePassword: true } });
    const s1 = await loginOk(u.email); const s2 = await loginOk(u.email);
    expect(s1.mustChangePassword).toBe(true);
    const h = bearer(s1.accessToken);
    expect((await call('POST', '/auth/password', { headers: h, body: { currentPassword: 'errada-errada-1', newPassword: 'NovaSenhaForte99' } })).status).toBe(403);
    expect((await call('POST', '/auth/password', { headers: h, body: { currentPassword: PW, newPassword: 'curta1' } })).status).toBe(400);
    expect((await call('POST', '/auth/password', { headers: h, body: { currentPassword: PW, newPassword: PW } })).status).toBe(400);
    const ok = await call('POST', '/auth/password', { headers: h, body: { currentPassword: PW, newPassword: 'NovaSenhaForte99' } });
    expect(ok.status).toBe(200);
    expect(ok.json.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s2.refreshToken } })).status).toBe(401);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } })).status).toBe(200);
    expect((await login(u.email, PW)).status).toBe(401);
    expect((await loginOk(u.email, 'NovaSenhaForte99')).mustChangePassword).toBe(false);
  });
});

describe('iam — MFA TOTP', () => {
  it('fluxo completo: setup → enable → login em 2 etapas → anti-replay → disable', async () => {
    const { users } = await orgWith(['SUPERVISOR']);
    const u = users.SUPERVISOR;
    const s = await loginOk(u.email);
    const h = bearer(s.accessToken);

    const setup = await call('POST', '/auth/mfa/setup', { headers: h });
    expect(setup.status).toBe(200);
    const secret: string = setup.json.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.json.otpauthUrl).toContain(`secret=${secret}`);
    expect(setup.json.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    let row = await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.totpEnabled).toBe(false);
    expect(row.totpSecretEnc).toMatch(/^bv1\./);
    expect(row.totpSecretEnc).not.toContain(secret);
    expect(decryptField(row.totpSecretEnc!)).toBe(secret);

    expect((await call('POST', '/auth/mfa/enable', { headers: h, body: { code: totpCode(secret, Date.now(), 5) } })).status).toBe(400);
    expect((await call('POST', '/auth/mfa/enable', { headers: h, body: { code: totpCode(secret) } })).status).toBe(200);
    expect((await call('POST', '/auth/mfa/setup', { headers: h })).status).toBe(409);

    // login em duas etapas
    const step1 = await login(u.email);
    expect(step1.status).toBe(200);
    expect(step1.json.mfaRequired).toBe(true);
    expect(step1.json.accessToken).toBeUndefined();
    const { mfaToken } = step1.json;
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: s.accessToken, code: totpCode(secret) } })).status).toBe(401); // access token não vale como mfaToken
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken, code: totpCode(secret, Date.now(), 5) } })).status).toBe(401);
    const good = totpCode(secret);
    const done = await call('POST', '/auth/login/mfa', { body: { mfaToken, code: good } });
    expect(done.status).toBe(200);
    expect(done.json.accessToken).toBeTruthy();
    expect((await call('GET', '/auth/me', { headers: bearer(done.json.accessToken) })).json.totpEnabled).toBe(true);

    // o mesmo código não vale duas vezes
    const again = (await login(u.email)).json.mfaToken;
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken: again, code: good } })).status).toBe(401);

    // desativar exige senha + código
    const dh = bearer(done.json.accessToken);
    const next = totpCode(secret, Date.now(), 1);
    expect((await call('POST', '/auth/mfa/disable', { headers: dh, body: { password: 'errada-errada-1', code: next } })).status).toBe(403);
    expect((await call('POST', '/auth/mfa/disable', { headers: dh, body: { password: PW, code: next } })).status).toBe(200);
    row = await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.totpEnabled).toBe(false);
    expect(row.totpSecretEnc).toBeNull();
    expect((await login(u.email)).json.accessToken).toBeTruthy();
  });

  it('falhas de MFA contam para o bloqueio da conta', async () => {
    const { users } = await orgWith(['ATENDENTE']);
    const u = users.ATENDENTE;
    const { accessToken } = await loginOk(u.email);
    const secret = (await call('POST', '/auth/mfa/setup', { headers: bearer(accessToken) })).json.secret;
    await call('POST', '/auth/mfa/enable', { headers: bearer(accessToken), body: { code: totpCode(secret) } });
    const { mfaToken } = (await login(u.email)).json;
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/login/mfa', { body: { mfaToken, code: totpCode(secret, Date.now(), 7 + i) } })).status).toBe(401);
    expect((await call('POST', '/auth/login/mfa', { body: { mfaToken, code: totpCode(secret) } })).status).toBe(423);
  });

  it('security.requireMfaRoles: perfil obrigado sem MFA recebe mfaSetupRequired no login e no /me', async () => {
    const { org, users, admin } = await orgWith(['ADMIN', 'ATENDENTE', 'SUPERVISOR']);
    const adm = await loginOk(admin.email);
    const patch = await call('PATCH', '/admin/org', { headers: bearer(adm.accessToken), body: { security: { requireMfaRoles: ['ATENDENTE'] } } });
    expect(patch.status).toBe(200);
    const at = await loginOk(users.ATENDENTE.email);
    expect(at.mfaSetupRequired).toBe(true);
    expect((await call('GET', '/auth/me', { headers: bearer(at.accessToken) })).json.mfaSetupRequired).toBe(true);
    expect((await loginOk(users.SUPERVISOR.email)).mfaSetupRequired).toBe(false);
    expect((await prisma.bvOrg.findUniqueOrThrow({ where: { id: org.id } })).settings).toMatchObject({ security: { requireMfaRoles: ['ATENDENTE'] } });
  });
});

describe('iam — RBAC das rotas /admin', () => {
  it('cada perfil acessa só o que a matriz de permissões permite', async () => {
    const { users } = await orgWith(['ADMIN', 'SUPERVISOR', 'ATENDENTE', 'FISCAL']);
    const status = async (role: string, url: string) => (await call('GET', url, { headers: authHeader(users[role]) })).status;
    const expected: Record<string, Record<string, number>> = {
      '/admin/users': { ADMIN: 200, SUPERVISOR: 403, ATENDENTE: 403, FISCAL: 403 },
      '/admin/org': { ADMIN: 200, SUPERVISOR: 403, ATENDENTE: 403, FISCAL: 403 },
      '/admin/holidays': { ADMIN: 200, SUPERVISOR: 403, ATENDENTE: 403, FISCAL: 403 },
      '/admin/tokens': { ADMIN: 200, SUPERVISOR: 403, ATENDENTE: 403, FISCAL: 403 },
      '/admin/audit': { ADMIN: 200, SUPERVISOR: 200, ATENDENTE: 403, FISCAL: 200 },
      '/admin/sectors': { ADMIN: 200, SUPERVISOR: 200, ATENDENTE: 403, FISCAL: 403 },
    };
    for (const [url, byRole] of Object.entries(expected)) for (const [role, code] of Object.entries(byRole)) expect([url, role, await status(role, url)]).toEqual([url, role, code]);
    expect((await call('GET', '/admin/users')).status).toBe(401);
    expect((await call('POST', '/admin/users', { headers: authHeader(users.SUPERVISOR), body: { email: 'x@y.com', name: 'Xx', role: 'ATENDENTE' } })).status).toBe(403);
  });
});

describe('iam — usuários', () => {
  it('cria com senha temporária (uma vez), mustChangePassword, filtros e paginação', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    const sector = (await call('POST', '/admin/sectors', { headers: h, body: { name: 'Cartório', email: 'cartorio@teste.local' } })).json;
    const c = await call('POST', '/admin/users', { headers: h, body: { email: 'Maria.Silva@Teste.Local', name: 'Maria Silva', role: 'ATENDENTE', skills: ['geral', 'geral', ' civel '], sectorId: sector.id, sipExtension: '6101', maxConcurrent: 4 } });
    expect(c.status).toBe(201);
    expect(c.json.user).toMatchObject({ email: 'maria.silva@teste.local', role: 'ATENDENTE', mustChangePassword: true, sipExtension: '6101', skills: ['geral', 'civel'], sectorId: sector.id });
    expect(c.json.user.passwordHash).toBeUndefined();
    expect(c.json.temporaryPassword).toMatch(/^[A-Za-z][A-Za-z0-9]{15}$/);
    expect(c.headers['cache-control']).toBe('no-store');
    const first = await loginOk('maria.silva@teste.local', c.json.temporaryPassword);
    expect(first.mustChangePassword).toBe(true);
    // a senha temporária não vai para a auditoria
    const audits = await prisma.bvAuditLog.findMany({ where: { orgId: org.id, action: 'user.create' } });
    expect(JSON.stringify(audits)).not.toContain(c.json.temporaryPassword);

    expect((await call('POST', '/admin/users', { headers: h, body: { email: 'maria.silva@teste.local', name: 'Outra', role: 'ATENDENTE' } })).json.error.code).toBe('user.email_taken');
    expect((await call('POST', '/admin/users', { headers: h, body: { email: 'b@teste.local', name: 'Bia', role: 'ATENDENTE', sipExtension: '6101' } })).json.error.code).toBe('user.sip_taken');
    expect((await call('POST', '/admin/users', { headers: h, body: { email: 'c@teste.local', name: 'Cid', role: 'ATENDENTE', sectorId: 'inexistente' } })).status).toBe(400);
    for (const n of ['d', 'e', 'f']) await call('POST', '/admin/users', { headers: h, body: { email: `${n}@teste.local`, name: `User ${n}`, role: 'FISCAL' } });

    const p1 = await call('GET', '/admin/users?limit=3', { headers: h });
    expect(p1.json.items).toHaveLength(3);
    expect(p1.json.total).toBe(5); // admin + 4 criados
    const p2 = await call('GET', `/admin/users?limit=3&cursor=${p1.json.nextCursor}`, { headers: h });
    expect(p2.json.items).toHaveLength(2);
    expect(p2.json.nextCursor).toBeNull();
    const ids = [...p1.json.items, ...p2.json.items].map((u: any) => u.id);
    expect(new Set(ids).size).toBe(5);
    expect((await call('GET', '/admin/users?role=FISCAL', { headers: h })).json.items).toHaveLength(3);
    expect((await call('GET', '/admin/users?q=maria', { headers: h })).json.items).toHaveLength(1);
    expect((await call('GET', `/admin/users?sectorId=${sector.id}`, { headers: h })).json.items).toHaveLength(1);
  });

  it('edita, desativa (revoga sessões e derruba o acesso), reativa, reseta senha e MFA', async () => {
    const { org, admin, users } = await orgWith(['ADMIN', 'ATENDENTE']);
    const h = authHeader(admin); const u = users.ATENDENTE;
    const s = await loginOk(u.email);

    const patch = await call('PATCH', `/admin/users/${u.id}`, { headers: h, body: { role: 'SUPERVISOR', name: 'Novo Nome', skills: ['x'], maxConcurrent: 5, sipExtension: '6201' } });
    expect(patch.status).toBe(200);
    expect(patch.json).toMatchObject({ role: 'SUPERVISOR', name: 'Novo Nome', maxConcurrent: 5, sipExtension: '6201' });
    const upd = await prisma.bvAuditLog.findFirstOrThrow({ where: { orgId: org.id, action: 'user.update', entityId: u.id } });
    expect((upd.before as any).role).toBe('ATENDENTE');
    expect((upd.after as any).role).toBe('SUPERVISOR');
    expect((await call('PATCH', `/admin/users/${u.id}`, { headers: h, body: {} })).status).toBe(400);
    expect((await call('PATCH', `/admin/users/${u.id}`, { headers: h, body: { role: 'GOD' } })).status).toBe(400);

    const deact = await call('POST', `/admin/users/${u.id}/deactivate`, { headers: h });
    expect(deact.json.active).toBe(false);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
    expect((await call('GET', '/auth/me', { headers: bearer(s.accessToken) })).status).toBe(401);
    expect((await login(u.email)).status).toBe(401);

    expect((await call('POST', `/admin/users/${u.id}/activate`, { headers: h })).json.active).toBe(true);
    await loginOk(u.email);

    const reset = await call('POST', `/admin/users/${u.id}/reset-password`, { headers: h });
    expect(reset.status).toBe(200);
    expect(reset.json.user.mustChangePassword).toBe(true);
    expect((await login(u.email, PW)).status).toBe(401);
    expect((await loginOk(u.email, reset.json.temporaryPassword)).mustChangePassword).toBe(true);

    await prisma.bvUser.update({ where: { id: u.id }, data: { totpEnabled: true, totpSecretEnc: 'x' } });
    const rm = await call('POST', `/admin/users/${u.id}/reset-mfa`, { headers: h });
    expect(rm.json.totpEnabled).toBe(false);
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).totpSecretEnc).toBeNull();
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: { in: ['user.deactivate', 'user.activate', 'user.reset_password', 'user.reset_mfa'] } } })).toBe(4);
  });

  it('ninguém se rebaixa/desativa sozinho, e o órgão nunca fica sem ADMIN ativo (inclusive em corrida)', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const other = await makeUser(org.id, 'ADMIN', { password: PW });
    const hA = authHeader(admin); const hB = authHeader(other);

    expect((await call('PATCH', `/admin/users/${admin.id}`, { headers: hA, body: { role: 'ATENDENTE' } })).json.error.code).toBe('user.self_change');
    expect((await call('POST', `/admin/users/${admin.id}/deactivate`, { headers: hA })).json.error.code).toBe('user.self_change');
    expect((await call('POST', `/admin/users/${admin.id}/reset-password`, { headers: hA })).json.error.code).toBe('user.self_change');
    expect((await call('PATCH', `/admin/users/${admin.id}`, { headers: hA, body: { name: 'Meu Nome' } })).status).toBe(200); // outros campos podem

    // dois admins tentando rebaixar um ao outro ao mesmo tempo: exatamente um consegue
    const race = await Promise.all([
      call('PATCH', `/admin/users/${other.id}`, { headers: hA, body: { role: 'SUPERVISOR' } }),
      call('PATCH', `/admin/users/${admin.id}`, { headers: hB, body: { role: 'SUPERVISOR' } }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(race.find((r) => r.status === 409)!.json.error.code).toBe('user.last_admin');
    expect(await prisma.bvUser.count({ where: { orgId: org.id, role: 'ADMIN', active: true } })).toBe(1);
  });

  it('desativação concorrente também preserva o último ADMIN', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const other = await makeUser(org.id, 'ADMIN', { password: PW });
    const race = await Promise.all([
      call('POST', `/admin/users/${other.id}/deactivate`, { headers: authHeader(admin) }),
      call('POST', `/admin/users/${admin.id}/deactivate`, { headers: authHeader(other) }),
    ]);
    // um é barrado por "self_change"? não — cada um desativa o OUTRO; só um pode vencer
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.bvUser.count({ where: { orgId: org.id, role: 'ADMIN', active: true } })).toBe(1);
  });

  it('cadastro em massa: resposta por linha (ok/erro + senha temporária), limite de 500, CSV', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    await call('POST', '/admin/sectors', { headers: h, body: { name: 'Fórum Central' } });
    await call('POST', '/admin/users', { headers: h, body: { email: 'ja.existe@teste.local', name: 'Já Existe', role: 'ATENDENTE' } });

    const rows: any[] = [];
    for (let i = 0; i < 110; i++) rows.push({ email: `atendente${i}@bulk.local`, name: `Atendente ${i}`, role: 'ATENDENTE', skills: ['geral'], ...(i === 0 ? { sectorName: 'fórum central' } : {}) });
    for (let i = 0; i < 10; i++) rows.push({ email: `sup${i}@bulk.local`, name: `Supervisor ${i}`, role: 'SUPERVISOR' });
    rows.push({ email: 'ATENDENTE5@bulk.local', name: 'Duplicado', role: 'ATENDENTE' }); // repetido (case-insensitive)
    rows.push({ email: 'invalido', name: 'Sem Email', role: 'ATENDENTE' });
    rows.push({ email: 'papel@bulk.local', name: 'Papel Ruim', role: 'CHEFE' });
    rows.push({ email: 'ja.existe@teste.local', name: 'Já Existe', role: 'ATENDENTE' });
    rows.push({ email: 'setor@bulk.local', name: 'Setor Ruim', role: 'ATENDENTE', sectorId: 'nao-existe' });
    rows.push('lixo');

    const r = await call('POST', '/admin/users/bulk', { headers: h, body: { users: rows } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 121 + 5, created: 120, failed: 6 });
    expect(r.json.results[0]).toMatchObject({ row: 1, ok: true });
    expect(r.json.results[0].temporaryPassword).toBeTruthy();
    const errs = r.json.results.filter((x: any) => !x.ok).map((x: any) => x.error.code);
    expect(errs.sort()).toEqual(['sector.not_found', 'user.duplicate_in_payload', 'user.email_taken', 'validation.failed', 'validation.failed', 'validation.failed']);
    expect(await prisma.bvUser.count({ where: { orgId: org.id, email: { endsWith: '@bulk.local' } } })).toBe(120);
    const first = await prisma.bvUser.findFirstOrThrow({ where: { orgId: org.id, email: 'atendente0@bulk.local' } });
    expect(first.sectorId).not.toBeNull();
    expect(first.mustChangePassword).toBe(true);
    expect(verifyPassword(r.json.results[0].temporaryPassword, first.passwordHash)).toBe(true);
    await loginOk('sup3@bulk.local', r.json.results[113].temporaryPassword);

    expect((await call('POST', '/admin/users/bulk', { headers: h, body: { users: Array.from({ length: 501 }, (_, i) => ({ email: `x${i}@y.com`, name: 'Xx', role: 'ATENDENTE' })) } })).status).toBe(400);
    expect((await call('POST', '/admin/users/bulk', { headers: h, body: { users: [] } })).status).toBe(400);

    const csv = await call('POST', '/admin/users/bulk?format=csv', { headers: h, body: { users: [{ email: 'csv1@bulk.local', name: 'Csv Um', role: 'FISCAL' }, { email: 'csv-ruim', name: 'x', role: 'FISCAL' }] } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe('linha,email,ok,senha_temporaria,erro');
    expect(csv.text).toContain('csv1@bulk.local,sim,');
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'user.bulk_create' } })).toBe(2);
  });
});

describe('iam — tokens de API', () => {
  it('cria (em claro só uma vez, hash no banco), autentica rota protegida, respeita escopo e revoga', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    expect((await call('POST', '/admin/tokens', { headers: h, body: { name: 'BI', scopes: ['user:manage'] } })).status).toBe(400);
    expect((await call('POST', '/admin/tokens', { headers: h, body: { name: 'BI', scopes: ['inexistente:x'] } })).status).toBe(400);
    expect((await call('POST', '/admin/tokens', { headers: h, body: { name: 'BI', scopes: [] } })).status).toBe(400);

    const c = await call('POST', '/admin/tokens', { headers: h, body: { name: 'Painel BI', scopes: ['audit:read', 'report:read'] } });
    expect(c.status).toBe(201);
    const token: string = c.json.token;
    expect(token).toMatch(/^bvt_[A-Za-z0-9_-]{40,}$/);
    const row = await prisma.bvApiToken.findUniqueOrThrow({ where: { id: c.json.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);

    const list = await call('GET', '/admin/tokens', { headers: h });
    expect(list.json.items).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(token);
    expect(list.json.items[0].tokenHash).toBeUndefined();

    expect((await call('GET', '/admin/audit', { headers: bearer(token) })).status).toBe(200); // escopo audit:read
    expect((await call('GET', '/admin/users', { headers: bearer(token) })).status).toBe(403);
    expect((await call('GET', '/auth/me', { headers: bearer(token) })).status).toBe(403);
    expect((await call('POST', '/admin/tokens', { headers: bearer(token), body: { name: 'Filho', scopes: ['audit:read'] } })).status).toBe(403);

    expect((await call('DELETE', `/admin/tokens/${c.json.id}`, { headers: h })).status).toBe(200);
    expect((await call('GET', '/admin/audit', { headers: bearer(token) })).status).toBe(401);
    expect((await call('DELETE', `/admin/tokens/${c.json.id}`, { headers: h })).status).toBe(200); // idempotente
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'apitoken.revoke' } })).toBe(1);
    expect((await call('GET', '/admin/audit', { headers: { authorization: 'Bearer bvt_nao-existe' } })).status).toBe(401);
  });
});

describe('iam — auditoria', () => {
  it('filtros (ator/ação/entidade/período), paginação por cursor e exportação CSV auditada', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    const mk = async (n: string) => (await call('POST', '/admin/users', { headers: h, body: { email: `${n}@aud.local`, name: `Aud ${n}`, role: 'ATENDENTE' } })).json.user;
    const u1 = await mk('a1'); await mk('a2'); await mk('a3');
    await call('PATCH', `/admin/users/${u1.id}`, { headers: h, body: { name: 'Aud Um' } });
    await call('POST', '/admin/sectors', { headers: h, body: { name: 'Setor Auditado' } });

    const all = await call('GET', '/admin/audit?limit=200', { headers: h });
    expect(all.status).toBe(200);
    expect(all.json.items.every((a: any) => a.actorName !== undefined)).toBe(true);
    expect(all.json.items.find((a: any) => a.action === 'user.create').actorName).toBe(admin.name);

    const creates = await call('GET', '/admin/audit?action=user.create', { headers: h });
    expect(creates.json.items).toHaveLength(3);
    expect((await call('GET', '/admin/audit?action=user.*', { headers: h })).json.items).toHaveLength(4);
    expect((await call('GET', `/admin/audit?entityType=user&entityId=${u1.id}`, { headers: h })).json.items.map((a: any) => a.action).sort()).toEqual(['user.create', 'user.update']);
    expect((await call('GET', `/admin/audit?actorId=${admin.id}&action=sector.create`, { headers: h })).json.items).toHaveLength(1);
    expect((await call('GET', '/admin/audit?actorId=ninguem', { headers: h })).json.items).toHaveLength(0);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await call('GET', `/admin/audit?from=${encodeURIComponent(future)}`, { headers: h })).json.items).toHaveLength(0);
    expect((await call('GET', `/admin/audit?to=${encodeURIComponent(future)}&action=user.create`, { headers: h })).json.items).toHaveLength(3);
    expect((await call('GET', '/admin/audit?from=nao-e-data', { headers: h })).status).toBe(400);

    const p1 = await call('GET', '/admin/audit?limit=2', { headers: h });
    expect(p1.json.items).toHaveLength(2);
    expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await call('GET', `/admin/audit?limit=2&cursor=${p1.json.nextCursor}`, { headers: h });
    const idsSeen = [...p1.json.items, ...p2.json.items].map((a: any) => a.id);
    expect(new Set(idsSeen).size).toBe(4);

    const csv = await call('GET', '/admin/audit?format=csv&action=user.*', { headers: h });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,data,tipo_ator,ator_id,ator_nome,acao,entidade,entidade_id,ip,user_agent,antes,depois,meta');
    expect(lines).toHaveLength(1 + 4);
    const exp = await prisma.bvAuditLog.findFirstOrThrow({ where: { orgId: org.id, action: 'audit.export' } });
    expect((exp.meta as any).rows).toBe(4);
  });
});

describe('iam — configurações do órgão, setores e feriados', () => {
  it('PATCH /admin/org valida, faz merge, versiona e audita antes/depois', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    const bad = [
      { timezone: 'Marte/Olimpo' }, { businessHours: { mon: [['18:00', '08:00']] } }, { businessHours: { xxx: [] } },
      { sla: { firstResponseSec: 1 } }, { ai: { confidenceThreshold: 2 } }, { unknownKey: 1 }, {}, { webchat: { allowedOrigins: ['not a url'] } }, { protocolPrefix: 'a' },
    ];
    for (const b of bad) expect([JSON.stringify(b), (await call('PATCH', '/admin/org', { headers: h, body: b })).status]).toEqual([JSON.stringify(b), 400]);

    const r = await call('PATCH', '/admin/org', { headers: h, body: {
      name: 'Tribunal Teste', timezone: 'America/Sao_Paulo', recordingNotice: 'Gravamos.', sla: { firstResponseSec: 600 },
      businessHours: { sat: [['08:00', '12:00']] }, ai: { mode: 'PROGRESSIVE' }, webchat: { allowedOrigins: ['https://www.tjto.jus.br'] },
    } });
    expect(r.status).toBe(200);
    const get = await call('GET', '/admin/org', { headers: h });
    expect(get.json.name).toBe('Tribunal Teste');
    expect(get.json.settings).toMatchObject({
      timezone: 'America/Sao_Paulo', recordingNotice: 'Gravamos.', sla: { firstResponseSec: 600, resolutionSec: 86400 },
      ai: { mode: 'PROGRESSIVE', enabled: true }, businessHours: { sat: [['08:00', '12:00']], mon: [['08:00', '18:00']] },
    });
    expect(get.json.security.requireMfaRoles).toEqual([]);

    await call('PATCH', '/admin/org', { headers: h, body: { sla: { resolutionSec: 3600 } } });
    const after = (await call('GET', '/admin/org', { headers: h })).json.settings;
    expect(after.sla).toEqual({ firstResponseSec: 600, resolutionSec: 3600 }); // merge, não substituição

    const versions = await prisma.bvConfigVersion.findMany({ where: { orgId: org.id, entityType: 'org-settings' }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const audits = await prisma.bvAuditLog.findMany({ where: { orgId: org.id, action: 'org.update' }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect((audits[0].before as any).settings).toEqual({});
    expect((audits[0].after as any).settings.sla.firstResponseSec).toBe(600);
  });

  it('setores: CRUD, nome único por órgão, exclusão bloqueada quando em uso', async () => {
    const { admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    const s = (await call('POST', '/admin/sectors', { headers: h, body: { name: 'Distribuição' } })).json;
    expect((await call('POST', '/admin/sectors', { headers: h, body: { name: 'Distribuição' } })).status).toBe(409);
    expect((await call('PATCH', `/admin/sectors/${s.id}`, { headers: h, body: { email: 'dist@teste.local' } })).json.email).toBe('dist@teste.local');
    await call('POST', '/admin/users', { headers: h, body: { email: 'x1@teste.local', name: 'Xx Um', role: 'ATENDENTE', sectorId: s.id } });
    expect((await call('DELETE', `/admin/sectors/${s.id}`, { headers: h })).json.error.code).toBe('sector.in_use');
    expect((await call('PATCH', `/admin/sectors/${s.id}`, { headers: h, body: { active: false } })).json.active).toBe(false);
    expect((await call('GET', '/admin/sectors?active=true', { headers: h })).json.items).toHaveLength(0);
    const s2 = (await call('POST', '/admin/sectors', { headers: h, body: { name: 'Vazio' } })).json;
    expect((await call('DELETE', `/admin/sectors/${s2.id}`, { headers: h })).status).toBe(200);
  });

  it('feriados: CRUD, duplicidade, filtro por ano e invalidação do cache do core', async () => {
    const { org, admin } = await orgWith(['ADMIN']);
    const h = authHeader(admin);
    expect((await getHolidays(org.id)).size).toBe(0); // popula o cache
    const c = await call('POST', '/admin/holidays', { headers: h, body: { day: '2026-12-25', name: 'Natal' } });
    expect(c.status).toBe(201);
    expect(c.json.day).toBe('2026-12-25');
    expect((await getHolidays(org.id)).has('2026-12-25')).toBe(true);
    expect((await call('POST', '/admin/holidays', { headers: h, body: { day: '2026-12-25', name: 'Outra' } })).status).toBe(409);
    expect((await call('POST', '/admin/holidays', { headers: h, body: { day: '2026-02-30', name: 'Inválido' } })).status).toBe(400);
    await call('POST', '/admin/holidays/bulk', { headers: h, body: { items: [{ day: '2027-01-01', name: 'Confraternização' }, { day: '2026-12-25', name: 'Natal (renomeado)' }] } });
    expect((await call('GET', '/admin/holidays?year=2026', { headers: h })).json.items).toEqual([expect.objectContaining({ day: '2026-12-25', name: 'Natal (renomeado)' })]);
    expect((await call('GET', '/admin/holidays', { headers: h })).json.items).toHaveLength(2);
    const p = await call('PATCH', `/admin/holidays/${c.json.id}`, { headers: h, body: { day: '2026-12-24' } });
    expect(p.json.day).toBe('2026-12-24');
    const days = await getHolidays(org.id);
    expect(days.has('2026-12-24') && !days.has('2026-12-25')).toBe(true);
    expect((await call('DELETE', `/admin/holidays/${c.json.id}`, { headers: h })).status).toBe(200);
    expect((await getHolidays(org.id)).has('2026-12-24')).toBe(false);
    expect((await call('DELETE', `/admin/holidays/${c.json.id}`, { headers: h })).status).toBe(404);
  });
});

describe('iam — isolamento entre órgãos', () => {
  it('admin de um órgão não enxerga nem altera dados de outro', async () => {
    const A = await orgWith(['ADMIN', 'ATENDENTE']);
    const B = await orgWith(['ADMIN']);
    const hA = authHeader(A.admin); const hB = authHeader(B.admin);
    const sector = (await call('POST', '/admin/sectors', { headers: hA, body: { name: 'Só do A' } })).json;
    const holiday = (await call('POST', '/admin/holidays', { headers: hA, body: { day: '2026-09-07', name: 'Independência' } })).json;
    const token = (await call('POST', '/admin/tokens', { headers: hA, body: { name: 'A', scopes: ['audit:read'] } })).json;
    const target = A.users.ATENDENTE;

    expect((await call('GET', `/admin/users/${target.id}`, { headers: hB })).status).toBe(404);
    expect((await call('PATCH', `/admin/users/${target.id}`, { headers: hB, body: { name: 'Invasor' } })).status).toBe(404);
    for (const act of ['deactivate', 'activate', 'reset-password', 'reset-mfa', 'unlock']) expect((await call('POST', `/admin/users/${target.id}/${act}`, { headers: hB })).status).toBe(404);
    expect((await call('PATCH', `/admin/sectors/${sector.id}`, { headers: hB, body: { name: 'X' } })).status).toBe(404);
    expect((await call('DELETE', `/admin/sectors/${sector.id}`, { headers: hB })).status).toBe(404);
    expect((await call('PATCH', `/admin/holidays/${holiday.id}`, { headers: hB, body: { name: 'Hack' } })).status).toBe(404);
    expect((await call('DELETE', `/admin/holidays/${holiday.id}`, { headers: hB })).status).toBe(404);
    expect((await call('DELETE', `/admin/tokens/${token.id}`, { headers: hB })).status).toBe(404);
    expect((await call('POST', '/admin/users', { headers: hB, body: { email: 'y@teste.local', name: 'Yy Yy', role: 'ATENDENTE', sectorId: sector.id } })).status).toBe(400);

    expect((await call('GET', '/admin/users', { headers: hB })).json.items.map((u: any) => u.id)).toEqual([B.admin.id]);
    expect((await call('GET', '/admin/sectors', { headers: hB })).json.items).toHaveLength(0);
    expect((await call('GET', '/admin/holidays', { headers: hB })).json.items).toHaveLength(0);
    expect((await call('GET', '/admin/tokens', { headers: hB })).json.items).toHaveLength(0);
    const audB = await call('GET', '/admin/audit?limit=200', { headers: hB });
    expect(audB.json.items.every((a: any) => a.actorId !== A.admin.id)).toBe(true);
    expect((await call('GET', '/admin/org', { headers: hB })).json.id).toBe(B.org.id);
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: target.id } })).active).toBe(true);
    expect(await login(target.email, PW, B.org.slug).then((r) => r.status)).toBe(401); // credencial do A não vale no B
  });
});

describe('iam — CLIs (serviço de criação de órgão e seed demo)', () => {
  it('createOrgWithAdmin é idempotente e valida política de senha', async () => {
    const slug = `cli-${crypto.randomBytes(4).toString('hex')}`;
    const email = `adm@${slug}.local`;
    await expect(createOrgWithAdmin({ name: 'Órgão CLI', slug, adminEmail: email, adminPassword: 'curta' })).rejects.toMatchObject({ code: 'password.weak' });
    await expect(createOrgWithAdmin({ name: 'Órgão CLI', slug: 'A_', adminEmail: email, adminPassword: PW })).rejects.toMatchObject({ code: 'org.invalid_slug' });
    const r1 = await createOrgWithAdmin({ name: 'Órgão CLI', slug, adminEmail: email, adminPassword: PW });
    expect(r1).toMatchObject({ orgCreated: true, adminCreated: true });
    const r2 = await createOrgWithAdmin({ name: 'Órgão CLI', slug, adminEmail: email, adminPassword: 'OutraSenha12345' });
    expect(r2).toMatchObject({ orgCreated: false, adminCreated: false, adminPasswordSet: false, orgId: r1.orgId, adminId: r1.adminId });
    expect(await prisma.bvUser.count({ where: { orgId: r1.orgId } })).toBe(1);
    expect((await login(email, PW, slug)).status).toBe(200); // senha original mantida
    await createOrgWithAdmin({ name: 'Órgão CLI', slug, adminEmail: email, adminPassword: 'OutraSenha12345', resetAdminPassword: true });
    expect((await login(email, 'OutraSenha12345', slug)).status).toBe(200);
  });

  it('seedDemo cria o órgão completo e é idempotente', async () => {
    const slug = `demo-${crypto.randomBytes(4).toString('hex')}`;
    const r1 = await seedDemo({ slug, password: 'DemoSenha12345' });
    const count = async () => ({
      users: await prisma.bvUser.count({ where: { orgId: r1.orgId } }), queues: await prisma.bvQueue.count({ where: { orgId: r1.orgId } }),
      members: await prisma.bvQueueMember.count({ where: { queue: { orgId: r1.orgId } } }), kb: await prisma.bvKbArticle.count({ where: { orgId: r1.orgId, status: 'APPROVED' } }),
      holidays: await prisma.bvHoliday.count({ where: { orgId: r1.orgId } }), quotas: await prisma.bvQuota.count({ where: { orgId: r1.orgId } }),
      sectors: await prisma.bvSector.count({ where: { orgId: r1.orgId } }),
    });
    const c1 = await count();
    expect(c1).toMatchObject({ users: 6, queues: 3, kb: 10, holidays: 20, sectors: 3 });
    expect(c1.quotas).toBeGreaterThanOrEqual(5);
    expect(c1.members).toBeGreaterThanOrEqual(5);
    const roles = (await prisma.bvUser.findMany({ where: { orgId: r1.orgId } })).map((u) => u.role).sort();
    expect(roles).toEqual(['ADMIN', 'ATENDENTE', 'ATENDENTE', 'ATENDENTE', 'FISCAL', 'SUPERVISOR']);
    const sips = (await prisma.bvUser.findMany({ where: { orgId: r1.orgId, sipExtension: { not: null } } })).map((u) => u.sipExtension).sort();
    expect(sips).toEqual(['6001', '6002', '6003']);
    expect((await prisma.bvQueue.findMany({ where: { orgId: r1.orgId } })).map((q) => q.name).sort()).toEqual(['Atendimento Geral', 'Processos Judiciais', 'Suporte Técnico']);

    await seedDemo({ slug, password: 'DemoSenha12345' });
    expect(await count()).toEqual(c1);
    const ok = await login('admin@demo.balcao.local', 'DemoSenha12345', slug);
    expect(ok.status).toBe(200);
    expect(ok.json.user.role).toBe('ADMIN');

    // senha gerada: só aparece em quem é novo; órgão já existente mantém as senhas
    const r3 = await seedDemo({ slug });
    expect(r3.password).toBeNull();
    await expect(seedDemo({ slug, password: 'curta' })).rejects.toThrow(/inválida/);
  });

  it('feriados nacionais: Sexta-feira Santa 2026 = 03/04 e 2027 = 26/03', () => {
    const iso = (y: number) => nationalHolidays(y).find((h) => h.name === 'Sexta-feira Santa')!.day.toISOString().slice(0, 10);
    expect(iso(2026)).toBe('2026-04-03');
    expect(iso(2027)).toBe('2027-03-26');
  });
});
