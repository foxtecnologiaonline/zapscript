import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit, auditReq } from '../core/audit';
import { decryptField, encryptField, hashToken } from '../core/crypto';
import { bvAuth, clearAuthCache, parse, sendError } from '../core/http';
import { signJwt, verifyJwt } from '../core/jwt';
import { passwordPolicyError } from '../core/passwords';
import { permissionsOf } from '../core/permissions';
import { createSession, revokeSession, rotateSession, type SessionTokens } from '../core/session';
import type { Role } from '../core/types';
import { dummyVerify, hashPasswordAsync, verifyPasswordAsync } from './passwordAsync';
import { consumeTotpCode, hitLoginRateLimit } from './ratelimit';
import { getRequireMfaRoles, normalizeEmail, userView } from './service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

const MAX_FAILS = Number(process.env.BV_LOGIN_MAX_FAILS) > 0 ? Number(process.env.BV_LOGIN_MAX_FAILS) : 5;
const LOCK_MIN = Number(process.env.BV_LOGIN_LOCK_MIN) > 0 ? Number(process.env.BV_LOGIN_LOCK_MIN) : 15;
const MFA_TOKEN_TTL_SEC = 5 * 60;
const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos.';

const loginBody = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  orgSlug: z.string().trim().min(1).max(80).optional(),
});
const mfaLoginBody = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().trim().regex(/^\d{6}$/, 'Informe os 6 dígitos do código.') });
const refreshBody = z.object({ refreshToken: z.string().min(10).max(500) });
const logoutBody = z.object({ refreshToken: z.string().min(10).max(500).optional() }).optional();
const passwordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const codeBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Informe os 6 dígitos do código.') });
const disableBody = z.object({ password: z.string().min(1).max(200), code: z.string().trim().regex(/^\d{6}$/, 'Informe os 6 dígitos do código.') });

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.bvUser.findFirst>>>;

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined });

/** Registra falha de autenticação; ao atingir o limite bloqueia a conta por LOCK_MIN minutos. Retorna true se bloqueou agora. */
async function registerFailure(user: DbUser): Promise<boolean> {
  const r = await prisma.bvUser.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
  if (r.failedLogins >= MAX_FAILS) {
    await prisma.bvUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60_000) } });
    return true;
  }
  return false;
}

const lockedRemainingSec = (u: { lockedUntil: Date | null }) => (u.lockedUntil && u.lockedUntil.getTime() > Date.now() ? Math.ceil((u.lockedUntil.getTime() - Date.now()) / 1000) : 0);

function sendLocked(reply: FastifyReply, remainingSec: number) {
  reply.header('retry-after', String(remainingSec));
  return sendError(reply, 423, 'auth.locked', 'Conta temporariamente bloqueada por tentativas inválidas. Tente novamente mais tarde.');
}

async function sessionPayload(user: DbUser, tokens: SessionTokens) {
  const requireMfa = await getRequireMfaRoles(user.orgId);
  const mfaSetupRequired = !user.totpEnabled && requireMfa.includes(user.role as Role);
  return {
    accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn,
    mustChangePassword: user.mustChangePassword, mfaSetupRequired, totpEnabled: user.totpEnabled,
    user: { id: user.id, orgId: user.orgId, name: user.name, email: user.email, role: user.role },
  };
}

/** Conclui um login (senha OK e, se houver, MFA OK): zera contadores, cria sessão, audita. */
async function completeLogin(req: FastifyRequest, reply: FastifyReply, user: DbUser, via: 'password' | 'mfa') {
  await prisma.bvUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const tokens = await createSession(user, meta(req));
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, meta: { via, sessionId: tokens.sessionId }, ...meta(req) });
  return reply.send(await sessionPayload(user, tokens));
}

/** Usuário humano autenticado (bloqueia token de API, que não tem usuário). */
function requireHumanUser(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.bv || req.bv.via !== 'jwt') { sendError(reply, 403, 'auth.forbidden', 'Disponível apenas para usuários autenticados por sessão.'); return null; }
  return req.bv.userId;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── Login ───────────────────────────────────────────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const body = parse(loginBody, req.body, reply); if (!body) return;
    const email = normalizeEmail(body.email);

    const rl = await hitLoginRateLimit(req.ip, body.orgSlug ?? '-');
    if (!rl.allowed) {
      reply.header('retry-after', String(rl.retryAfterSec));
      return sendError(reply, 429, 'auth.rate_limited', 'Muitas tentativas de acesso. Tente novamente em alguns minutos.');
    }

    let candidates: Array<DbUser & { org: { slug: string; name: string } }>;
    if (body.orgSlug) {
      const org = await prisma.bvOrg.findUnique({ where: { slug: body.orgSlug }, select: { id: true } });
      candidates = org ? await prisma.bvUser.findMany({ where: { orgId: org.id, email: { equals: email, mode: 'insensitive' } }, include: { org: { select: { slug: true, name: true } } }, take: 1 }) : [];
    } else {
      candidates = await prisma.bvUser.findMany({ where: { email: { equals: email, mode: 'insensitive' }, active: true }, include: { org: { select: { slug: true, name: true } } }, take: 10 });
    }

    if (candidates.length === 0) {
      await dummyVerify(body.password);
      if (body.orgSlug) {
        const org = await prisma.bvOrg.findUnique({ where: { slug: body.orgSlug }, select: { id: true } });
        if (org) await audit({ orgId: org.id, actorType: 'SYSTEM', action: 'auth.login_failed', entityType: 'user', meta: { reason: 'unknown_user', email }, ...meta(req) });
      }
      return sendError(reply, 401, 'auth.invalid_credentials', GENERIC_LOGIN_ERROR);
    }

    // E-mail em mais de um órgão sem orgSlug: só revela a ambiguidade depois de a senha conferir em algum deles.
    if (candidates.length > 1) {
      const ok: typeof candidates = [];
      for (const c of candidates) if (!c.lockedUntil || lockedRemainingSec(c) === 0) if (await verifyPasswordAsync(body.password, c.passwordHash)) ok.push(c);
      if (ok.length === 0) {
        for (const c of candidates) if (lockedRemainingSec(c) === 0) await registerFailure(c);
        return sendError(reply, 401, 'auth.invalid_credentials', GENERIC_LOGIN_ERROR);
      }
      return sendError(reply, 409, 'auth.org_required', 'Este e-mail está cadastrado em mais de um órgão. Informe o órgão (orgSlug).', { orgs: ok.map((c) => ({ slug: c.org.slug, name: c.org.name })) });
    }

    const user = candidates[0];
    const locked = lockedRemainingSec(user);
    if (locked > 0) {
      await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.login_blocked', entityType: 'user', entityId: user.id, meta: { reason: 'locked' }, ...meta(req) });
      return sendLocked(reply, locked);
    }
    if (!user.active) {
      await dummyVerify(body.password);
      await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, meta: { reason: 'inactive' }, ...meta(req) });
      return sendError(reply, 401, 'auth.invalid_credentials', GENERIC_LOGIN_ERROR);
    }
    if (!(await verifyPasswordAsync(body.password, user.passwordHash))) {
      const nowLocked = await registerFailure(user);
      await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, meta: { reason: 'bad_password' }, ...meta(req) });
      if (nowLocked) await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.lockout', entityType: 'user', entityId: user.id, meta: { minutes: LOCK_MIN }, ...meta(req) });
      return sendError(reply, 401, 'auth.invalid_credentials', GENERIC_LOGIN_ERROR);
    }

    if (user.totpEnabled && user.totpSecretEnc) {
      // Contador de falhas só é zerado após o 2º fator (impede alternar senha certa/código errado sem limite).
      const mfaToken = signJwt({ sub: user.id, org: user.orgId, role: user.role, typ: 'mfa' }, MFA_TOKEN_TTL_SEC);
      return reply.send({ mfaRequired: true, mfaToken, expiresIn: MFA_TOKEN_TTL_SEC });
    }
    return completeLogin(req, reply, user, 'password');
  });

  // ── 2º fator do login ───────────────────────────────────────────────────────
  app.post('/auth/login/mfa', async (req, reply) => {
    const body = parse(mfaLoginBody, req.body, reply); if (!body) return;
    const rl = await hitLoginRateLimit(req.ip, 'mfa');
    if (!rl.allowed) {
      reply.header('retry-after', String(rl.retryAfterSec));
      return sendError(reply, 429, 'auth.rate_limited', 'Muitas tentativas de acesso. Tente novamente em alguns minutos.');
    }
    const p = verifyJwt(body.mfaToken, 'mfa');
    if (!p) return sendError(reply, 401, 'auth.invalid_mfa_token', 'Verificação expirada. Faça login novamente.');
    const user = await prisma.bvUser.findFirst({ where: { id: p.sub, orgId: p.org } });
    if (!user || !user.active || !user.totpEnabled || !user.totpSecretEnc) return sendError(reply, 401, 'auth.invalid_mfa_token', 'Verificação expirada. Faça login novamente.');
    const locked = lockedRemainingSec(user);
    if (locked > 0) return sendLocked(reply, locked);

    const valid = verifyTotp(decryptField(user.totpSecretEnc), body.code) && (await consumeTotpCode(user.id, body.code));
    if (!valid) {
      const nowLocked = await registerFailure(user);
      await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.mfa_failed', entityType: 'user', entityId: user.id, ...meta(req) });
      if (nowLocked) await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.lockout', entityType: 'user', entityId: user.id, meta: { minutes: LOCK_MIN, step: 'mfa' }, ...meta(req) });
      return sendError(reply, 401, 'auth.invalid_mfa_code', 'Código de verificação inválido.');
    }
    return completeLogin(req, reply, user, 'mfa');
  });

  // ── Refresh / logout ────────────────────────────────────────────────────────
  app.post('/auth/refresh', async (req, reply) => {
    const body = parse(refreshBody, req.body, reply); if (!body) return;
    const prev = await prisma.bvSession.findUnique({ where: { refreshHash: hashToken(body.refreshToken) }, select: { revokedAt: true, userId: true, user: { select: { orgId: true } } } });
    const tokens = await rotateSession(body.refreshToken, meta(req));
    if (!tokens) {
      if (prev?.revokedAt) {
        // Reuso de refresh token já rotacionado/revogado: o core revogou TODAS as sessões do usuário.
        await audit({ orgId: prev.user.orgId, actorType: 'SYSTEM', actorId: prev.userId, action: 'auth.refresh_reuse', entityType: 'user', entityId: prev.userId, meta: { allSessionsRevoked: true }, ...meta(req) });
      }
      return sendError(reply, 401, 'auth.invalid_refresh', 'Sessão expirada. Faça login novamente.');
    }
    const user = await prisma.bvUser.findFirstOrThrow({ where: { id: prev!.userId } });
    return reply.send(await sessionPayload(user, tokens));
  });

  // Aceita o access token (Authorization) e/ou o refresh token no corpo — funciona mesmo com o access expirado.
  app.post('/auth/logout', async (req, reply) => {
    const body = logoutBody.safeParse(req.body ?? {});
    const h = req.headers.authorization;
    const access = h?.startsWith('Bearer ') && !h.startsWith('Bearer bvt_') ? verifyJwt(h.slice(7).trim(), 'access') : null;
    let sessionId = access?.sid ?? null;
    let orgId = access?.org ?? null;
    let userId = access?.sub ?? null;
    const rt = body.success ? body.data?.refreshToken : undefined;
    if (rt) {
      const s = await prisma.bvSession.findUnique({ where: { refreshHash: hashToken(rt) }, select: { id: true, userId: true, user: { select: { orgId: true } } } });
      if (s) { sessionId = s.id; userId = s.userId; orgId = s.user.orgId; }
    }
    if (sessionId) await revokeSession(sessionId);
    if (orgId && userId) await audit({ orgId, actorId: userId, action: 'auth.logout', entityType: 'user', entityId: userId, meta: { sessionId }, ...meta(req) });
    return reply.send({ ok: true });
  });

  // ── Perfil ──────────────────────────────────────────────────────────────────
  app.get('/auth/me', { preHandler: bvAuth }, async (req, reply) => {
    const userId = requireHumanUser(req, reply); if (!userId) return;
    const u = await prisma.bvUser.findFirst({ where: { id: userId, orgId: req.bv!.orgId }, include: { org: { select: { name: true, slug: true } } } });
    if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    const requireMfa = await getRequireMfaRoles(u.orgId);
    return reply.send({
      user: { ...userView(u), orgName: u.org.name, orgSlug: u.org.slug },
      permissions: permissionsOf(u.role as Role),
      mustChangePassword: u.mustChangePassword,
      totpEnabled: u.totpEnabled,
      mfaSetupRequired: !u.totpEnabled && requireMfa.includes(u.role as Role),
    });
  });

  // ── Troca de senha ──────────────────────────────────────────────────────────
  app.post('/auth/password', { preHandler: bvAuth }, async (req, reply) => {
    const userId = requireHumanUser(req, reply); if (!userId) return;
    const body = parse(passwordBody, req.body, reply); if (!body) return;
    const u = await prisma.bvUser.findFirst({ where: { id: userId, orgId: req.bv!.orgId } });
    if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    if (!(await verifyPasswordAsync(body.currentPassword, u.passwordHash))) {
      await auditReq(req, 'auth.password_change_failed', { entityType: 'user', entityId: u.id });
      return sendError(reply, 403, 'auth.invalid_credentials', 'Senha atual incorreta.');
    }
    const policy = passwordPolicyError(body.newPassword);
    if (policy) return sendError(reply, 400, 'password.weak', policy);
    if (body.newPassword === body.currentPassword) return sendError(reply, 400, 'password.same', 'A nova senha deve ser diferente da atual.');
    await prisma.bvUser.update({ where: { id: u.id }, data: { passwordHash: await hashPasswordAsync(body.newPassword), mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    // Revoga todas as outras sessões (a atual continua).
    const revoked = await prisma.bvSession.updateMany({ where: { userId: u.id, revokedAt: null, ...(req.bv!.sessionId ? { id: { not: req.bv!.sessionId } } : {}) }, data: { revokedAt: new Date() } });
    clearAuthCache();
    await auditReq(req, 'auth.password_change', { entityType: 'user', entityId: u.id, meta: { otherSessionsRevoked: revoked.count } });
    return reply.send({ ok: true, otherSessionsRevoked: revoked.count });
  });

  // ── MFA (TOTP) ──────────────────────────────────────────────────────────────
  app.post('/auth/mfa/setup', { preHandler: bvAuth }, async (req, reply) => {
    const userId = requireHumanUser(req, reply); if (!userId) return;
    const u = await prisma.bvUser.findFirst({ where: { id: userId, orgId: req.bv!.orgId }, include: { org: { select: { name: true } } } });
    if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    if (u.totpEnabled) return sendError(reply, 409, 'mfa.already_enabled', 'A verificação em duas etapas já está ativa. Desative-a antes de reconfigurar.');
    const secret = generateTotpSecret();
    await prisma.bvUser.update({ where: { id: u.id }, data: { totpSecretEnc: encryptField(secret), totpEnabled: false } });
    await auditReq(req, 'auth.mfa_setup', { entityType: 'user', entityId: u.id });
    return reply.send({ secret, otpauthUrl: otpauthUrl(secret, u.email, `Balcão Virtual (${u.org.name})`), digits: 6, period: 30, algorithm: 'SHA1' });
  });

  app.post('/auth/mfa/enable', { preHandler: bvAuth }, async (req, reply) => {
    const userId = requireHumanUser(req, reply); if (!userId) return;
    const body = parse(codeBody, req.body, reply); if (!body) return;
    const u = await prisma.bvUser.findFirst({ where: { id: userId, orgId: req.bv!.orgId } });
    if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    if (u.totpEnabled) return sendError(reply, 409, 'mfa.already_enabled', 'A verificação em duas etapas já está ativa.');
    if (!u.totpSecretEnc) return sendError(reply, 409, 'mfa.not_set_up', 'Inicie a configuração em /auth/mfa/setup.');
    if (!verifyTotp(decryptField(u.totpSecretEnc), body.code)) {
      await auditReq(req, 'auth.mfa_enable_failed', { entityType: 'user', entityId: u.id });
      return sendError(reply, 400, 'mfa.invalid_code', 'Código inválido. Confira o horário do dispositivo e tente de novo.');
    }
    await prisma.bvUser.update({ where: { id: u.id }, data: { totpEnabled: true } });
    clearAuthCache();
    await auditReq(req, 'auth.mfa_enable', { entityType: 'user', entityId: u.id });
    return reply.send({ ok: true, totpEnabled: true });
  });

  app.post('/auth/mfa/disable', { preHandler: bvAuth }, async (req, reply) => {
    const userId = requireHumanUser(req, reply); if (!userId) return;
    const body = parse(disableBody, req.body, reply); if (!body) return;
    const u = await prisma.bvUser.findFirst({ where: { id: userId, orgId: req.bv!.orgId } });
    if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
    if (!u.totpEnabled || !u.totpSecretEnc) return sendError(reply, 409, 'mfa.not_enabled', 'A verificação em duas etapas não está ativa.');
    const pwOk = await verifyPasswordAsync(body.password, u.passwordHash);
    const codeOk = pwOk && verifyTotp(decryptField(u.totpSecretEnc), body.code) && (await consumeTotpCode(u.id, body.code));
    if (!pwOk || !codeOk) {
      await auditReq(req, 'auth.mfa_disable_failed', { entityType: 'user', entityId: u.id });
      return sendError(reply, 403, 'auth.invalid_credentials', 'Senha ou código inválidos.');
    }
    await prisma.bvUser.update({ where: { id: u.id }, data: { totpEnabled: false, totpSecretEnc: null } });
    clearAuthCache();
    await auditReq(req, 'auth.mfa_disable', { entityType: 'user', entityId: u.id });
    return reply.send({ ok: true, totpEnabled: false });
  });
}
