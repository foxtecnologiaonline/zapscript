import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { saveIntegration } from '../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { verifyJwt } from '../../core/jwt';
import { mapRole } from '../oidc';
import { clearJwksCache } from '../common';
import { buildApp, FakeIdp } from './fakes';

const FRONT = 'https://app.test.local/balcao/login/oidc';
const CB = 'https://api.test.local/balcao/integrations/oidc/callback';

describe('integrations/oidc — login da equipe pelo IdP do TJTO', () => {
  let app: FastifyInstance; let idp: FakeIdp;
  beforeAll(async () => { app = await buildApp(); idp = await FakeIdp.create(); });
  afterAll(async () => { await idp.close(); await app.close(); });
  beforeEach(() => { idp.opts = {}; clearJwksCache(); });

  async function setup(over: Record<string, unknown> = {}) {
    const org = await makeOrg();
    await saveIntegration(org.id, 'OIDC_TJTO', { ...idp.cfg, redirectUri: CB, frontendRedirect: FRONT, ...over });
    return org;
  }
  const login = (slug: string) => app.inject({ method: 'GET', url: `/balcao/integrations/oidc/login?org=${slug}` });
  const cb = (back: string) => app.inject({ method: 'GET', url: `/balcao/integrations/oidc/callback${new URL(back).search}` });
  const exchange = (code: string) => app.inject({ method: 'POST', url: '/balcao/integrations/oidc/exchange', payload: { code } });
  async function run(slug: string, claims: Record<string, unknown>) {
    const l = await login(slug);
    expect(l.statusCode).toBe(302);
    return cb(idp.authorize(l.headers.location as string, claims));
  }
  const codeOf = (loc: string) => new URL(loc).searchParams.get('code')!;

  it('fluxo completo para usuário existente (vínculo por e-mail), troca de código única e sessão válida', async () => {
    const org = await setup();
    const user = await makeUser(org.id, 'SUPERVISOR', { email: 'maria@tjto.jus.br' });
    const r = await run(org.slug, { sub: 'idp-1', email: 'maria@tjto.jus.br', name: 'Maria' });
    expect(r.statusCode).toBe(302);
    const loc = r.headers.location as string;
    expect(loc.startsWith(FRONT + '?code=')).toBe(true);
    expect(loc).not.toMatch(/token|bvr_/i);
    expect((await prisma.bvUser.findUnique({ where: { id: user.id } }))!.oidcSub).toBe('idp-1');

    const ex = await exchange(codeOf(loc));
    expect(ex.statusCode).toBe(200);
    const j = ex.json();
    expect(j.user).toMatchObject({ id: user.id, role: 'SUPERVISOR' });
    expect(verifyJwt(j.accessToken)?.sub).toBe(user.id);
    expect(j.refreshToken).toMatch(/^bvr_/);
    expect((await prisma.bvAuditLog.findMany({ where: { orgId: org.id, action: 'auth.oidc_login' } })).length).toBe(1);
    expect((await prisma.bvUser.findUnique({ where: { id: user.id } }))!.lastLoginAt).toBeTruthy();

    const reuse = await exchange(codeOf(loc));
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('oidc.invalid_code');
  });

  it('segundo login encontra o usuário por oidcSub (mesmo mudando o e-mail)', async () => {
    const org = await setup();
    const user = await makeUser(org.id, 'ATENDENTE');
    await prisma.bvUser.update({ where: { id: user.id }, data: { oidcSub: 'idp-sub-9' } });
    const r = await run(org.slug, { sub: 'idp-sub-9', email: 'novo@tjto.jus.br' });
    expect((await exchange(codeOf(r.headers.location as string))).json().user.id).toBe(user.id);
  });

  it('código de troca expira em 30 s (TTL)', async () => {
    const org = await setup();
    await makeUser(org.id, 'ATENDENTE', { email: 'a@tjto.jus.br' });
    const loc = (await run(org.slug, { sub: 's1', email: 'a@tjto.jus.br' })).headers.location as string;
    const { redis } = await import('../../../services/queue');
    const keys = await redis.keys('bv:int:oidc-code:*');
    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    expect(ttls.some((t) => t > 0 && t <= 30)).toBe(true);
    expect(loc).toContain('code=');
  });

  it('usuário inativo é barrado no callback e na troca', async () => {
    const org = await setup();
    const user = await makeUser(org.id, 'ATENDENTE', { email: 'off@tjto.jus.br' });
    await prisma.bvUser.update({ where: { id: user.id }, data: { active: false } });
    const r = await run(org.slug, { sub: 'off', email: 'off@tjto.jus.br' });
    expect(r.headers.location).toBe(`${FRONT}?error=user_inactive`);
    // ativo no callback mas desativado antes da troca
    const user2 = await makeUser(org.id, 'ATENDENTE', { email: 'on@tjto.jus.br' });
    const loc = (await run(org.slug, { sub: 'on', email: 'on@tjto.jus.br' })).headers.location as string;
    await prisma.bvUser.update({ where: { id: user2.id }, data: { active: false } });
    expect((await exchange(codeOf(loc))).statusCode).toBe(401);
  });

  it('state adulterado/replay e callback sem state: sem redirecionar tokens', async () => {
    const org = await setup();
    await makeUser(org.id, 'ATENDENTE', { email: 'x@tjto.jus.br' });
    const l = await login(org.slug);
    const back = idp.authorize(l.headers.location as string, { sub: 'x', email: 'x@tjto.jus.br' });
    const forged = new URL(back); forged.searchParams.set('state', forged.searchParams.get('state') + 'x');
    const f = await cb(forged.toString());
    expect(f.statusCode).toBe(400); expect(f.headers.location).toBeUndefined();
    expect((await cb(back)).statusCode).toBe(302);
    const replay = await cb(back);
    expect(replay.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/balcao/integrations/oidc/callback' })).statusCode).toBe(400);
  });

  it('PKCE: troca de code entre sessões falha no IdP', async () => {
    const org = await setup();
    await makeUser(org.id, 'ATENDENTE', { email: 'p@tjto.jus.br' });
    const a = new URL(idp.authorize((await login(org.slug)).headers.location as string, { sub: 'p', email: 'p@tjto.jus.br' }));
    const b = new URL(idp.authorize((await login(org.slug)).headers.location as string, { sub: 'p', email: 'p@tjto.jus.br' }));
    a.searchParams.set('code', b.searchParams.get('code')!);
    const r = await cb(a.toString());
    expect(r.headers.location).toBe(`${FRONT}?error=oidc_failed`);
  });

  it.each([['nonce', { wrongNonce: true }], ['aud', { wrongAud: true }], ['iss', { wrongIssuer: true }], ['exp', { expired: true }], ['assinatura', { otherKey: true }]])('id_token com %s inválido → oidc_failed', async (_n, o) => {
    idp.opts = o as any;
    const org = await setup();
    await makeUser(org.id, 'ATENDENTE', { email: 'z@tjto.jus.br' });
    const r = await run(org.slug, { sub: 'z', email: 'z@tjto.jus.br' });
    expect(r.headers.location).toBe(`${FRONT}?error=oidc_failed`);
  });

  it('usuário desconhecido sem autoProvision → user_not_found; com autoProvision cria com perfil mapeado (nunca ADMIN implícito)', async () => {
    const org = await setup();
    expect((await run(org.slug, { sub: 'n1', email: 'novo@tjto.jus.br' })).headers.location).toBe(`${FRONT}?error=user_not_found`);

    const org2 = await setup({ autoProvision: true, defaultRole: 'ATENDENTE', roleClaim: 'groups', roleMapping: { 'balcao-sup': 'SUPERVISOR', 'balcao-admin': 'ADMIN' } });
    const r1 = await run(org2.slug, { sub: 'p1', email: 'João@tjto.jus.br', name: 'João', groups: ['outros'] });
    const u1 = await prisma.bvUser.findFirst({ where: { orgId: org2.id, oidcSub: 'p1' } });
    expect(u1).toMatchObject({ role: 'ATENDENTE', email: 'joão@tjto.jus.br', passwordHash: null });
    expect((await exchange(codeOf(r1.headers.location as string))).statusCode).toBe(200);
    await run(org2.slug, { sub: 'p2', email: 'sup@tjto.jus.br', groups: ['balcao-sup'] });
    expect((await prisma.bvUser.findFirst({ where: { orgId: org2.id, oidcSub: 'p2' } }))!.role).toBe('SUPERVISOR');
    await run(org2.slug, { sub: 'p3', email: 'adm@tjto.jus.br', groups: ['balcao-sup', 'balcao-admin'] });
    expect((await prisma.bvUser.findFirst({ where: { orgId: org2.id, oidcSub: 'p3' } }))!.role).toBe('ADMIN');
    expect(await prisma.bvAuditLog.count({ where: { orgId: org2.id, action: 'user.oidc_provision' } })).toBe(3);
    // usuário auto-provisionado em um órgão não existe no outro
    expect(await prisma.bvUser.count({ where: { orgId: org.id, oidcSub: 'p1' } })).toBe(0);
  });

  it('defaultRole não aceita ADMIN; e-mail não verificado não vincula conta; conflito de oidcSub é recusado', async () => {
    const org = await setup();
    const put = await app.inject({ method: 'PUT', url: '/balcao/integrations/OIDC_TJTO', headers: authHeader(await makeUser(org.id, 'ADMIN')), payload: { config: { ...idp.cfg, redirectUri: CB, frontendRedirect: FRONT, defaultRole: 'ADMIN', clientSecret: 'x' } } });
    expect(put.statusCode).toBe(400);

    const victim = await makeUser(org.id, 'ADMIN', { email: 'chefe@tjto.jus.br' });
    const r = await run(org.slug, { sub: 'atacante', email: 'chefe@tjto.jus.br', email_verified: false });
    expect(r.headers.location).toBe(`${FRONT}?error=user_not_found`);
    expect((await prisma.bvUser.findUnique({ where: { id: victim.id } }))!.oidcSub).toBeNull();
    await prisma.bvUser.update({ where: { id: victim.id }, data: { oidcSub: 'legitimo' } });
    expect((await run(org.slug, { sub: 'outro-sub', email: 'chefe@tjto.jus.br' })).headers.location).toBe(`${FRONT}?error=account_conflict`);
  });

  it('allowedEmailDomains e requireAmr (MFA no IdP)', async () => {
    const org = await setup({ allowedEmailDomains: ['tjto.jus.br'], requireAmr: ['mfa', 'otp'] });
    await makeUser(org.id, 'ATENDENTE', { email: 'a@tjto.jus.br' }); await makeUser(org.id, 'ATENDENTE', { email: 'a@gmail.com' });
    expect((await run(org.slug, { sub: 'd1', email: 'a@gmail.com', amr: ['mfa'] })).headers.location).toBe(`${FRONT}?error=domain_not_allowed`);
    expect((await run(org.slug, { sub: 'd2', email: 'a@tjto.jus.br', amr: ['pwd'] })).headers.location).toBe(`${FRONT}?error=mfa_required`);
    expect((await run(org.slug, { sub: 'd2', email: 'a@tjto.jus.br', amr: ['pwd', 'otp'] })).headers.location).toContain('code=');
  });

  it('login sem integração / órgão inexistente', async () => {
    const org = await makeOrg();
    expect((await login(org.slug)).statusCode).toBe(409);
    expect((await login('nao-existe-xyz')).statusCode).toBe(404);
  });

  it('mapRole: maior privilégio entre grupos mapeados, string separada por vírgula', () => {
    const cfg = { roleClaim: 'g', roleMapping: { a: 'FISCAL', b: 'SUPERVISOR' } as any, defaultRole: 'ATENDENTE' as const };
    expect(mapRole(cfg, { g: 'a,b' })).toBe('SUPERVISOR');
    expect(mapRole(cfg, { g: ['zzz'] })).toBe('ATENDENTE');
    expect(mapRole(cfg, {})).toBe('ATENDENTE');
  });
});
