import { prisma } from '../../lib/prisma';
import { hashToken, randomToken } from './crypto';
import { signJwt } from './jwt';
import { clearAuthCache } from './http';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 12 * 60 * 60;

export interface SessionTokens { accessToken: string; refreshToken: string; expiresIn: number; sessionId: string }
interface UserLite { id: string; orgId: string; role: string }
interface Meta { ip?: string | null; userAgent?: string | null }

/** Cria sessão (refresh token opaco guardado só como hash) e devolve o par de tokens. */
export async function createSession(user: UserLite, meta: Meta = {}): Promise<SessionTokens> {
  const refreshToken = `bvr_${randomToken(32)}`;
  const s = await prisma.bvSession.create({
    data: { userId: user.id, refreshHash: hashToken(refreshToken), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000) },
  });
  return { accessToken: signJwt({ sub: user.id, org: user.orgId, role: user.role, sid: s.id, typ: 'access' }, ACCESS_TTL_SEC), refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: s.id };
}

/**
 * Rotação do refresh token. Reapresentar um token já rotacionado (revogado) indica roubo → revoga TODAS as sessões do usuário.
 * Retorna null se inválido/expirado.
 */
export async function rotateSession(refreshToken: string, meta: Meta = {}): Promise<SessionTokens | null> {
  const s = await prisma.bvSession.findUnique({ where: { refreshHash: hashToken(refreshToken) }, include: { user: true } });
  if (!s) return null;
  if (s.revokedAt) { await revokeAllSessions(s.userId); return null; }
  if (s.expiresAt < new Date() || !s.user.active) return null;
  await prisma.bvSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  return createSession(s.user, meta);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.bvSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.bvSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  clearAuthCache();
}
