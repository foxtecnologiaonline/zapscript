import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BvConversation, Prisma } from '@prisma/client';
import { z } from 'zod';
import { bvAuth, requirePerm, sendError } from '../../core/http';
import { memberQueueIds } from '../../core/conversations';
import { can, type Permission } from '../../core/permissions';
import type { BvAuthContext } from '../../core/types';

/** Token de API (BI) não opera o console: só usuários reais (JWT). */
async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (req.bv?.via !== 'jwt') return sendError(reply, 403, 'auth.forbidden', 'Operação exclusiva de usuários do Balcão');
}

/** `[bvAuth, requirePerm(...), requireUser]` para `preHandler`. */
export const guardUser = (...perms: Permission[]) => [bvAuth, requirePerm(...perms), requireUser];

export const actor = (req: FastifyRequest): BvAuthContext => req.bv!;
export const isSupervisor = (a: BvAuthContext): boolean => can(a.role, 'conversation:monitor');
export const canReadAll = (a: BvAuthContext): boolean => can(a.role, 'conversation:read_all');

/** Booleano vindo de query string ("true"/"1"). */
export const qbool = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v), z.boolean().optional());

/** Filtro Prisma equivalente a `canAccessConversation` (o atendente só vê as suas e as WAITING das filas de que é membro). */
export async function accessWhere(a: BvAuthContext): Promise<Prisma.BvConversationWhereInput> {
  if (canReadAll(a)) return { orgId: a.orgId };
  const qids = await memberQueueIds(a.userId);
  return {
    orgId: a.orgId,
    OR: [
      { assignedUserId: a.userId },
      { assignedUserId: null, status: 'WAITING', OR: [{ queueId: null }, { queueId: { in: qids } }] },
    ],
  };
}

export const CONVERSATION_FIELDS = [
  'id', 'protocol', 'channel', 'status', 'priority', 'category', 'intent', 'subject', 'contactId', 'queueId', 'assignedUserId',
  'startedAt', 'queuedAt', 'assignedAt', 'firstResponseAt', 'closedAt', 'closeReason', 'slaFirstResponseDueAt', 'slaResolutionDueAt',
  'slaBreached', 'transferCount', 'lastMessageAt', 'lastInboundAt', 'unreadForAgent', 'botHandled', 'csatScore',
] as const satisfies readonly (keyof BvConversation)[];

/** Só campos explícitos (sem `metadata`, que guarda dados internos de canais/roteamento). */
export function serializeConversation(c: BvConversation, now = Date.now()) {
  const out: Record<string, unknown> = {};
  for (const k of CONVERSATION_FIELDS) out[k] = c[k];
  const since = c.status === 'WAITING' ? (c.queuedAt ?? c.startedAt) : null;
  out.waitSec = since ? Math.max(0, Math.floor((now - since.getTime()) / 1000)) : null;
  return out;
}

export function encodeCursor(v: unknown): string { return Buffer.from(JSON.stringify(v)).toString('base64url'); }
export function decodeCursor<T>(s: string | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(Buffer.from(s, 'base64url').toString()) as T; } catch { return null; }
}

export const notFound = (reply: FastifyReply, what = 'Recurso') => sendError(reply, 404, 'not_found', `${what} não encontrado`);

export function isUniqueViolation(err: unknown): boolean { return (err as { code?: string })?.code === 'P2002'; }
