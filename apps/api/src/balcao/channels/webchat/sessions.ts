import type { BvWebchatSession } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { hashToken, randomToken } from '../../core/crypto';
import { env } from './config';

/** Sessões do visitante: token opaco `bvv_…` (só o hash é guardado), expiração por inatividade. */

export const TOKEN_RE = /^bvv_[A-Za-z0-9_-]{20,80}$/;

export const newVisitorToken = (): string => `bvv_${randomToken(32)}`;

export async function createSession(i: { orgId: string; contactId?: string | null; origin?: string | null; ip?: string | null; userAgent?: string | null }) {
  const token = newVisitorToken();
  const session = await prisma.bvWebchatSession.create({
    data: {
      orgId: i.orgId, tokenHash: hashToken(token), contactId: i.contactId ?? null,
      origin: i.origin ? i.origin.slice(0, 200) : null, ip: i.ip ? i.ip.slice(0, 64) : null, userAgent: i.userAgent ? i.userAgent.slice(0, 300) : null,
    },
  });
  return { token, session };
}

export const isExpired = (s: Pick<BvWebchatSession, 'lastSeenAt' | 'endedAt'>, now = Date.now()): boolean =>
  !!s.endedAt || now - s.lastSeenAt.getTime() > env.sessionTtlSec() * 1000;

/** Sessão válida pelo token (null para inexistente, encerrada ou expirada — o chamador responde sempre igual). */
export async function findSessionByToken(token: string | undefined): Promise<BvWebchatSession | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const s = await prisma.bvWebchatSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!s || isExpired(s)) return null;
  return s;
}

/** Renova lastSeenAt (no máximo a cada 15 s, para não gerar escrita a cada poll). */
export async function touchSession(s: BvWebchatSession): Promise<void> {
  if (Date.now() - s.lastSeenAt.getTime() < 15_000) return;
  s.lastSeenAt = new Date();
  await prisma.bvWebchatSession.update({ where: { id: s.id }, data: { lastSeenAt: s.lastSeenAt } }).catch(() => undefined);
}

export async function setSessionConversation(s: BvWebchatSession, conversationId: string, contactId?: string | null): Promise<void> {
  s.conversationId = conversationId;
  if (contactId) s.contactId = contactId;
  await prisma.bvWebchatSession.update({
    where: { id: s.id },
    data: { conversationId, ...(contactId ? { contactId } : {}), lastSeenAt: new Date() },
  });
}

/** Exclusão mútua local por chave (evita duas conversas para duas mensagens simultâneas da mesma sessão). */
const chains = new Map<string, Promise<unknown>>();
export async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  try { return await run; } finally { if (chains.get(key) === tail) chains.delete(key); }
}
