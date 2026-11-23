import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { hashToken } from './crypto';
import { verifyJwt } from './jwt';
import { can, type Permission } from './permissions';
import type { BvAuthContext, Role } from './types';

declare module 'fastify' {
  interface FastifyRequest { bv?: BvAuthContext }
}

/** Erro padronizado do Balcão: { error: { code, message, details? } }. */
export function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  return reply.code(status).send({ error: { code, message, ...(details ? { details } : {}) } });
}

/** Valida com zod; em caso de erro responde 400 e retorna null. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.infer<S> | null {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  sendError(reply, 400, 'validation.failed', 'Dados inválidos', r.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
  return null;
}

const userCache = new Map<string, { at: number; ctx: Omit<BvAuthContext, 'sessionId' | 'via'> | null }>();
const USER_TTL_MS = 10_000;
const sessionCache = new Map<string, { at: number; ok: boolean }>();
export const clearAuthCache = () => { userCache.clear(); sessionCache.clear(); };

/** Sessão (sid do JWT) ainda válida? Logout/troca de senha/reuso de refresh revogam a sessão → o access token deixa de valer em ≤ 10 s. */
async function sessionActive(sid: string): Promise<boolean> {
  const hit = sessionCache.get(sid);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.ok;
  const row = await prisma.bvSession.findUnique({ where: { id: sid }, select: { revokedAt: true, expiresAt: true } });
  const ok = !!row && !row.revokedAt && row.expiresAt > new Date();
  sessionCache.set(sid, { at: Date.now(), ok });
  return ok;
}

async function loadUser(userId: string): Promise<Omit<BvAuthContext, 'sessionId' | 'via'> | null> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.ctx;
  const u = await prisma.bvUser.findUnique({ where: { id: userId }, select: { id: true, orgId: true, role: true, active: true, name: true, email: true } });
  const ctx = u && u.active ? { userId: u.id, orgId: u.orgId, role: u.role as Role, name: u.name, email: u.email } : null;
  userCache.set(userId, { at: Date.now(), ctx });
  return ctx;
}

/**
 * preHandler: exige `Authorization: Bearer <JWT do Balcão>` (usuário ativo) OU token de API (`bvt_…`, com escopos).
 * Preenche `req.bv`.
 */
export async function bvAuth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return sendError(reply, 401, 'auth.missing_token', 'Autenticação necessária');

  if (token.startsWith('bvt_')) {
    const row = await prisma.bvApiToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.revokedAt) return sendError(reply, 401, 'auth.invalid_token', 'Token inválido');
    void prisma.bvApiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    req.bv = { userId: `token:${row.id}`, orgId: row.orgId, role: 'FISCAL', name: row.name, email: '', via: 'api-token', scopes: row.scopes };
    return;
  }

  const p = verifyJwt(token, 'access');
  if (!p) return sendError(reply, 401, 'auth.invalid_token', 'Sessão inválida ou expirada');
  const u = await loadUser(p.sub);
  if (!u) return sendError(reply, 401, 'auth.user_inactive', 'Usuário inativo');
  if (p.sid && !(await sessionActive(p.sid))) return sendError(reply, 401, 'auth.session_revoked', 'Sessão encerrada');
  req.bv = { ...u, sessionId: p.sid, via: 'jwt' };
}

/**
 * preHandler de autorização por permissão (use APÓS bvAuth). Token de API só passa se tiver o escopo
 * `perm` (ou `*`), e nunca para permissões de gestão de usuários/segurança.
 */
export function requirePerm(...perms: Permission[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.bv;
    if (!ctx) return sendError(reply, 401, 'auth.missing_token', 'Autenticação necessária');
    const ok = ctx.via === 'api-token'
      ? perms.every((p) => (ctx.scopes ?? []).includes(p) || (ctx.scopes ?? []).includes('*')) && !perms.some((p) => p === 'user:manage' || p === 'security:manage' || p === 'org:manage')
      : perms.every((p) => can(ctx.role, p));
    if (!ok) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para esta ação');
  };
}

/** Atalho: `[bvAuth, requirePerm(...)]` para `preHandler`. */
export const guard = (...perms: Permission[]) => [bvAuth, requirePerm(...perms)];

export const idParam = z.object({ id: z.string().min(1).max(64) });
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
