import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { auditReq, audit } from '../core/audit';
import { randomToken } from '../core/crypto';
import { getIntegration } from '../core/integrations';
import { normalizeEmail } from '../core/contacts';
import { createSession } from '../core/session';
import { parse, sendError } from '../core/http';
import { ROLES, type Role } from '../core/types';
import {
  buildAuthorizeUrl, exchangeCode, hitLimit, htmlPage, logged, newPkce, putOnce, SECURITY_HEADERS, takeOnce, verifyIdToken,
  type Deps, type OidcClientConfig,
} from './common';
import { httpClientFor, IntegrationError, parseJsonSafe } from './http-client';

/**
 * Login da EQUIPE pelo provedor de identidade do TJTO (OpenID Connect, authorization code + PKCE).
 * O callback NUNCA devolve tokens na URL: gera um código de troca de uso único (30 s) que o frontend
 * troca por sessão em POST /oidc/exchange.
 */

export const oidcConfigSchema = z.object({
  clientId: z.string().min(1).max(300),
  clientSecret: z.string().min(1).max(500),
  redirectUri: z.string().url().max(500),
  issuer: z.string().min(1).max(500),
  authorizeUrl: z.string().url().max(500),
  tokenUrl: z.string().url().max(500),
  jwksUri: z.string().url().max(500),
  userinfoUrl: z.string().url().max(500).optional(),
  scopes: z.array(z.string().max(100)).max(20).default(['openid', 'email', 'profile']),
  tokenAuthMethod: z.enum(['basic', 'post']).default('basic'),
  /** Página do frontend que recebe `?code=…` (ou `?error=…`). */
  frontendRedirect: z.string().url().max(500),
  autoProvision: z.boolean().default(false),
  /** Perfil de quem é auto-provisionado sem grupo mapeado (ADMIN só via roleMapping explícito). */
  defaultRole: z.enum(['ATENDENTE', 'SUPERVISOR', 'FISCAL']).default('ATENDENTE'),
  roleClaim: z.string().max(100).default('groups'),
  roleMapping: z.record(z.enum(ROLES)).default({}),
  emailClaim: z.string().max(100).default('email'),
  nameClaim: z.string().max(100).default('name'),
  allowedEmailDomains: z.array(z.string().max(200)).max(50).optional(),
  /** MFA no IdP: exige um destes valores no claim `amr` (ex.: ["mfa","otp"]). */
  requireAmr: z.array(z.string().max(50)).max(10).optional(),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  allowPrivateHosts: z.boolean().optional(),
});
export type OidcConfig = z.infer<typeof oidcConfigSchema>;
export const OIDC_SECRETS = ['clientSecret'];

const NS_STATE = 'oidc';
const NS_CODE = 'oidc-code';
const STATE_TTL_SEC = 10 * 60;
const CODE_TTL_SEC = 30;
const ROLE_ORDER: Role[] = ['ADMIN', 'SUPERVISOR', 'FISCAL', 'ATENDENTE'];

const loginQuery = z.object({ org: z.string().min(1).max(100) });
const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().min(8).max(200).optional(), error: z.string().max(100).optional() });
const exchangeBody = z.object({ code: z.string().min(8).max(200) });

async function loadConfig(orgId: string): Promise<OidcConfig> {
  const row = await getIntegration<Record<string, any>>(orgId, 'OIDC_TJTO');
  if (!row?.enabled) throw new IntegrationError('oidc.not_configured', 'Login corporativo não configurado');
  const p = oidcConfigSchema.safeParse(row.config);
  if (!p.success) throw new IntegrationError('oidc.not_configured', 'Configuração do IdP inválida');
  return p.data;
}

/** Perfil a partir dos grupos do IdP; maior privilégio entre os mapeados; senão o padrão (nunca ADMIN). */
export function mapRole(cfg: Pick<OidcConfig, 'roleClaim' | 'roleMapping' | 'defaultRole'>, claims: Record<string, unknown>): Role {
  const raw = claims[cfg.roleClaim];
  const groups = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []).map(String);
  const matched = groups.map((g) => cfg.roleMapping[g]).filter((r): r is Role => !!r);
  for (const r of ROLE_ORDER) if (matched.includes(r)) return r;
  return cfg.defaultRole;
}

function failRedirect(reply: FastifyReply, cfg: OidcConfig | null, code: string) {
  if (!cfg) return reply.code(400).headers({ ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }).send(htmlPage('Não foi possível entrar', 'A solicitação de login expirou ou é inválida. Volte e tente entrar novamente.', 'error'));
  const u = new URL(cfg.frontendRedirect);
  u.searchParams.set('error', code);
  return reply.header('cache-control', 'no-store').redirect(u.toString());
}

type Resolve = { user: { id: string; orgId: string; active: boolean }; created: boolean } | { error: string };

async function resolveUser(orgId: string, cfg: OidcConfig, claims: Record<string, unknown>): Promise<Resolve> {
  const sub = String(claims.sub);
  const email = normalizeEmail(typeof claims[cfg.emailClaim] === 'string' ? (claims[cfg.emailClaim] as string) : null);
  const emailVerified = claims.email_verified !== false && claims.email_verified !== 'false';
  const name = (typeof claims[cfg.nameClaim] === 'string' && (claims[cfg.nameClaim] as string).trim()) || email || 'Usuário';

  if (email && cfg.allowedEmailDomains?.length && !cfg.allowedEmailDomains.map((d) => d.toLowerCase()).includes(email.split('@')[1] ?? '')) return { error: 'domain_not_allowed' };

  let user = await prisma.bvUser.findFirst({ where: { orgId, oidcSub: sub }, select: { id: true, orgId: true, active: true, oidcSub: true } });
  if (!user && email && emailVerified) {
    const byEmail = await prisma.bvUser.findUnique({ where: { orgId_email: { orgId, email } }, select: { id: true, orgId: true, active: true, oidcSub: true } });
    if (byEmail) {
      if (byEmail.oidcSub && byEmail.oidcSub !== sub) return { error: 'account_conflict' }; // já vinculado a outra identidade
      await prisma.bvUser.update({ where: { id: byEmail.id }, data: { oidcSub: sub } });
      user = byEmail;
    }
  }
  if (user) return { user, created: false };
  if (!cfg.autoProvision || !email || !emailVerified) return { error: 'user_not_found' };
  const role = mapRole(cfg, claims);
  try {
    const created = await prisma.bvUser.create({ data: { orgId, email, name: name.slice(0, 200), role, oidcSub: sub, passwordHash: null }, select: { id: true, orgId: true, active: true } });
    await audit({ orgId, actorType: 'SYSTEM', action: 'user.oidc_provision', entityType: 'user', entityId: created.id, meta: { role } });
    return { user: created, created: true };
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    const again = await prisma.bvUser.findFirst({ where: { orgId, OR: [{ oidcSub: sub }, { email }] }, select: { id: true, orgId: true, active: true } });
    return again ? { user: again, created: false } : { error: 'user_not_found' };
  }
}

export function registerOidcRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.get('/oidc/login', async (req, reply) => {
    if (!(await hitLimit('oidc-login', req.ip, 60, 600))) return sendError(reply, 429, 'rate_limited', 'Muitas tentativas');
    const q = parse(loginQuery, req.query, reply);
    if (!q) return;
    const org = await prisma.bvOrg.findUnique({ where: { slug: q.org }, select: { id: true } });
    if (!org) return sendError(reply, 404, 'oidc.org_not_found', 'Órgão não encontrado');
    try {
      const cfg = await loadConfig(org.id);
      const { verifier, challenge } = newPkce();
      const state = randomToken(24), nonce = randomToken(24);
      await putOnce(NS_STATE, state, { orgId: org.id, nonce, verifier }, STATE_TTL_SEC);
      return reply.header('cache-control', 'no-store').redirect(buildAuthorizeUrl(cfg as OidcClientConfig, { state, nonce, challenge }));
    } catch (err: any) {
      return sendError(reply, 409, err?.code ?? 'oidc.not_configured', 'Login corporativo indisponível');
    }
  });

  app.get('/oidc/callback', async (req, reply) => {
    if (!(await hitLimit('oidc-cb', req.ip, 60, 600))) return sendError(reply, 429, 'rate_limited', 'Muitas tentativas');
    const q = callbackQuery.safeParse(req.query);
    if (!q.success || !q.data.state) return failRedirect(reply, null, 'invalid_state');
    const rec = await takeOnce<{ orgId: string; nonce: string; verifier: string }>(NS_STATE, q.data.state);
    if (!rec) return failRedirect(reply, null, 'invalid_state'); // adulterado, expirado ou replay
    let cfg: OidcConfig;
    try { cfg = await loadConfig(rec.orgId); } catch { return failRedirect(reply, null, 'not_configured'); }
    if (q.data.error || !q.data.code) return failRedirect(reply, cfg, 'oidc_failed');

    try {
      const http = deps.http ?? httpClientFor(cfg);
      const claims = await logged(rec.orgId, 'OIDC_TJTO', 'login', async () => {
        const tokens = await exchangeCode(cfg as OidcClientConfig, http, q.data.code!, rec.verifier);
        const c = await verifyIdToken(cfg as OidcClientConfig, http, tokens.idToken, rec.nonce);
        // userinfo opcional completa e-mail/grupos quando o id_token vem enxuto.
        if (cfg.userinfoUrl && tokens.accessToken && !c[cfg.emailClaim]) {
          const r = await http.request({ url: cfg.userinfoUrl, headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json' }, timeoutMs: cfg.timeoutMs });
          const ui = r.status === 200 ? parseJsonSafe<Record<string, unknown>>(r.text) : null;
          if (ui && ui.sub === c.sub) return { ...ui, ...c } as Record<string, unknown>;
        }
        return c as Record<string, unknown>;
      });

      if (cfg.requireAmr?.length) {
        const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : [];
        if (!cfg.requireAmr.some((a) => amr.includes(a))) return failRedirect(reply, cfg, 'mfa_required');
      }
      const res = await resolveUser(rec.orgId, cfg, claims);
      if ('error' in res) return failRedirect(reply, cfg, res.error);
      if (!res.user.active) return failRedirect(reply, cfg, 'user_inactive');

      const code = randomToken(32);
      await putOnce(NS_CODE, code, { userId: res.user.id, orgId: rec.orgId }, CODE_TTL_SEC);
      const u = new URL(cfg.frontendRedirect);
      u.searchParams.set('code', code);
      return reply.header('cache-control', 'no-store').redirect(u.toString());
    } catch (err: any) {
      logger.warn({ code: err?.code ?? 'unexpected' }, '[balcao] oidc/callback falhou');
      return failRedirect(reply, cfg, 'oidc_failed');
    }
  });

  app.post('/oidc/exchange', async (req, reply) => {
    if (!(await hitLimit('oidc-ex', req.ip, 30, 600))) return sendError(reply, 429, 'rate_limited', 'Muitas tentativas');
    const b = parse(exchangeBody, req.body, reply);
    if (!b) return;
    const rec = await takeOnce<{ userId: string; orgId: string }>(NS_CODE, b.code);
    if (!rec) return sendError(reply, 401, 'oidc.invalid_code', 'Código inválido, expirado ou já utilizado');
    const user = await prisma.bvUser.findFirst({ where: { id: rec.userId, orgId: rec.orgId, active: true }, select: { id: true, orgId: true, role: true, name: true, email: true } });
    if (!user) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    const tokens = await createSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });
    await prisma.bvUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0 } });
    req.bv = { userId: user.id, orgId: user.orgId, role: user.role as Role, name: user.name, email: user.email, via: 'jwt' };
    await auditReq(req, 'auth.oidc_login', { entityType: 'user', entityId: user.id });
    return { ...tokens, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });
}

/** Teste de conexão: JWKS válido e tela de login acessível. */
export async function testOidc(cfg: OidcConfig, deps: Deps = {}): Promise<{ ok: boolean; message: string }> {
  const http = deps.http ?? httpClientFor(cfg);
  try {
    const j = await http.request({ url: cfg.jwksUri, timeoutMs: cfg.timeoutMs });
    const keys = parseJsonSafe<{ keys?: unknown[] }>(j.text)?.keys;
    if (j.status !== 200 || !Array.isArray(keys) || !keys.length) return { ok: false, message: 'JWKS indisponível ou vazio' };
    const a = await http.request({ url: cfg.authorizeUrl, timeoutMs: cfg.timeoutMs });
    if (a.status >= 500) return { ok: false, message: `Endpoint de autorização com erro (HTTP ${a.status})` };
    return { ok: true, message: `JWKS com ${keys.length} chave(s); autorização acessível` };
  } catch (err: any) {
    return { ok: false, message: err instanceof IntegrationError ? err.code : 'Falha de rede' };
  }
}
