import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { addConversationEvent, assignConversation, ConversationError } from '../../core/conversations';
import { idParam, parse, sendError } from '../../core/http';
import { emitToUser } from '../../core/realtime';
import { convLockKey, withLock } from '../lock';
import { agentLoads } from './agents';
import { actor, guardUser, notFound, serializeConversation } from './common';
import { listConversations } from './conversations';
import { CHANNELS } from '../../core/types';
import { qbool } from './common';

const HANDLER_ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN'];

/** Janela padrão (minutos) do indicador "SLA em risco": `?slaRiskMin=` > `BV_ROUTING_SLA_RISK_MIN` > 10. */
export const defaultSlaRiskMin = (): number => {
  const n = Number(process.env.BV_ROUTING_SLA_RISK_MIN);
  return Number.isFinite(n) && n >= 1 ? Math.min(1440, Math.floor(n)) : 10;
};

/**
 * Conversas abertas (WAITING/ACTIVE) cujo prazo de 1ª resposta (ainda sem resposta humana) ou de resolução vence em até `minutes` minutos
 * e que ainda NÃO foram marcadas como violadas daquele tipo (o sweep marca em ≤ 15 s; as já violadas ficam em `slaBreaches`).
 * Uma conversa conta uma vez, mesmo com os dois prazos próximos. Agrupado por fila (`null` = sem fila). Calculado no servidor.
 */
export async function slaAtRiskByQueue(orgId: string, minutes: number, now = new Date()): Promise<Map<string | null, number>> {
  const limit = new Date(now.getTime() + minutes * 60_000).toISOString();
  const rows = await prisma.$queryRaw<Array<{ queueId: string | null; n: number }>>(Prisma.sql`
    SELECT "queueId", COUNT(*)::int AS n FROM "BvConversation"
    WHERE "orgId" = ${orgId} AND status IN ('WAITING', 'ACTIVE') AND (
      ("slaFirstResponseDueAt" <= ${limit}::timestamp AND "firstResponseAt" IS NULL AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('FIRST_RESPONSE'::text)))
      OR ("slaResolutionDueAt" <= ${limit}::timestamp AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('RESOLUTION'::text)))
    )
    GROUP BY "queueId"`);
  return new Map(rows.map((r) => [r.queueId, Number(r.n)]));
}

export async function supervisorRoutes(app: FastifyInstance): Promise<void> {
  /** Instantâneo em tempo real: por fila, por agente e conversas violando SLA. */
  app.get('/supervisor/overview', { preHandler: guardUser('conversation:monitor') }, async (req, reply) => {
    const rq = parse(z.object({ slaRiskMin: z.coerce.number().int().min(1).max(1440).default(defaultSlaRiskMin()) }), req.query, reply); if (!rq) return;
    const a = actor(req);
    const now = Date.now();
    const [queues, waiting, active, bot, users, members, breached, atRisk] = await Promise.all([
      prisma.bvQueue.findMany({ where: { orgId: a.orgId, active: true }, orderBy: [{ priority: 'desc' }, { name: 'asc' }], select: { id: true, name: true, slug: true, priority: true, maxWaitSec: true } }),
      prisma.bvConversation.groupBy({ by: ['queueId'], where: { orgId: a.orgId, status: 'WAITING' }, _count: { _all: true }, _min: { queuedAt: true } }),
      prisma.bvConversation.groupBy({ by: ['queueId'], where: { orgId: a.orgId, status: 'ACTIVE' }, _count: { _all: true } }),
      prisma.bvConversation.count({ where: { orgId: a.orgId, status: 'BOT' } }),
      prisma.bvUser.findMany({ where: { orgId: a.orgId, active: true, role: { in: HANDLER_ROLES } }, select: { id: true, name: true, role: true, presence: true, presenceAt: true, maxConcurrent: true }, orderBy: { name: 'asc' }, take: 1000 }),
      prisma.bvQueueMember.findMany({ where: { queue: { orgId: a.orgId } }, select: { queueId: true, userId: true } }),
      prisma.bvConversation.findMany({
        where: { orgId: a.orgId, slaBreached: true, status: { in: ['WAITING', 'ACTIVE'] } }, orderBy: { startedAt: 'asc' }, take: 100,
        select: { id: true, protocol: true, channel: true, status: true, queueId: true, assignedUserId: true, startedAt: true, queuedAt: true, slaFirstResponseDueAt: true, slaResolutionDueAt: true, priority: true },
      }),
      slaAtRiskByQueue(a.orgId, rq.slaRiskMin, new Date(now)),
    ]);
    const loads = await agentLoads(a.orgId, users.map((u) => u.id));
    const activeConvs = await prisma.bvConversation.findMany({
      where: { orgId: a.orgId, status: 'ACTIVE', assignedUserId: { not: null } }, orderBy: { assignedAt: 'asc' }, take: 3000,
      select: { id: true, protocol: true, channel: true, assignedUserId: true, startedAt: true, slaBreached: true, unreadForAgent: true },
    });
    const byAgent = new Map<string, typeof activeConvs>();
    for (const c of activeConvs) byAgent.set(c.assignedUserId!, [...(byAgent.get(c.assignedUserId!) ?? []), c]);
    const uBy = new Map(users.map((u) => [u.id, u]));
    const wBy = new Map(waiting.map((w) => [w.queueId, w]));
    const aBy = new Map(active.map((w) => [w.queueId, w._count._all]));

    const queueRows = [...queues.map((q) => ({ id: q.id as string | null, name: q.name, priority: q.priority, maxWaitSec: q.maxWaitSec })), { id: null, name: 'Sem fila', priority: 0, maxWaitSec: null }]
      .map((q) => {
        const w = wBy.get(q.id);
        const mem = members.filter((m) => m.queueId === q.id).map((m) => uBy.get(m.userId)).filter((u): u is NonNullable<typeof u> => !!u);
        const online = mem.filter((u) => u.presence === 'ONLINE' || u.presence === 'BUSY');
        return {
          queueId: q.id, name: q.name, waiting: w?._count._all ?? 0,
          longestWaitSec: w?._min.queuedAt ? Math.max(0, Math.floor((now - w._min.queuedAt.getTime()) / 1000)) : 0,
          active: aBy.get(q.id) ?? 0,
          agentsOnline: online.length,
          agentsBusy: online.filter((u) => u.presence === 'BUSY' || (loads.get(u.id) ?? 0) >= u.maxConcurrent).length,
          agentsAvailable: online.filter((u) => u.presence === 'ONLINE' && (loads.get(u.id) ?? 0) < u.maxConcurrent).length,
          maxWaitSec: q.maxWaitSec,
          slaAtRisk: atRisk.get(q.id) ?? 0,
        };
      })
      .filter((q) => q.queueId !== null || q.waiting > 0 || q.active > 0 || q.slaAtRisk > 0);

    return {
      generatedAt: new Date(now).toISOString(),
      slaRiskMin: rq.slaRiskMin,
      totals: {
        waiting: queueRows.reduce((s, q) => s + q.waiting, 0), active: queueRows.reduce((s, q) => s + q.active, 0), bot,
        agentsOnline: users.filter((u) => u.presence === 'ONLINE').length, slaBreached: breached.length,
        slaAtRisk: [...atRisk.values()].reduce((s, n) => s + n, 0),
      },
      queues: queueRows,
      agents: users.map((u) => ({
        userId: u.id, name: u.name, role: u.role, presence: u.presence, presenceAt: u.presenceAt, load: loads.get(u.id) ?? 0, maxConcurrent: u.maxConcurrent,
        conversations: (byAgent.get(u.id) ?? []).slice(0, 20),
      })),
      slaBreaches: breached,
    };
  });

  app.get('/supervisor/conversations', { preHandler: guardUser('conversation:monitor') }, async (req, reply) => {
    const q = parse(z.object({
      status: z.string().optional(), queueId: z.string().max(64).optional(), channel: z.enum(CHANNELS).optional(), unassigned: qbool, mine: qbool,
      protocol: z.string().trim().max(40).optional(), contact: z.string().max(64).optional(), category: z.string().max(60).optional(),
      assignedUserId: z.string().max(64).optional(), slaBreached: qbool, sort: z.enum(['recent', 'priority']).default('priority'),
      limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional(),
    }), req.query, reply); if (!q) return;
    // por padrão, só o que está vivo
    return listConversations(actor(req), { ...q, status: q.status ?? 'BOT,WAITING,ACTIVE' }, 'all');
  });

  app.post('/supervisor/conversations/:id/takeover', { preHandler: guardUser('conversation:monitor') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const conv = await prisma.bvConversation.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!conv) return notFound(reply, 'Conversa');
    if (conv.status === 'CLOSED') return sendError(reply, 409, 'conversation.not_assignable', 'Conversa encerrada');
    const res = await withLock(convLockKey(conv.id), async () => {
      try {
        const out = await assignConversation({ orgId: a.orgId, conversationId: conv.id, userId: a.userId, actorUserId: a.userId, via: 'MANUAL' });
        await addConversationEvent(a.orgId, conv.id, 'TAKEOVER', a.userId, { fromUserId: conv.assignedUserId });
        return { out };
      } catch (err) { return { err }; }
    }, { waitMs: 3000 });
    if (!res.ok) return sendError(reply, 503, 'busy', 'Conversa em processamento, tente novamente');
    if ('err' in res.value) {
      const e = res.value.err;
      if (e instanceof ConversationError) return sendError(reply, e.status, e.code, e.message);
      throw e;
    }
    if (conv.assignedUserId && conv.assignedUserId !== a.userId) emitToUser(conv.assignedUserId, 'conversation:taken_over', { id: conv.id, byUserId: a.userId });
    await auditReq(req, 'conversation.takeover', { entityType: 'conversation', entityId: conv.id, meta: { fromUserId: conv.assignedUserId } });
    return { conversation: serializeConversation(res.value.out) };
  });
}
