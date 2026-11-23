import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getIo } from '../core/realtime';
import { emitToSupervisors } from '../core/realtime';
import { registerJob } from '../core/scheduler';
import { round } from './util';

/**
 * Instantâneo operacional (sem período): fila, atendimento, agentes, maior espera, SLA em risco, chamadas ativas.
 * Fonte única para GET /reports/realtime e para a emissão periódica por socket (evento `report:realtime`).
 */
export interface RealtimeOptions { atRiskSec?: number; now?: Date }

export async function realtimeSnapshot(orgId: string, opts: RealtimeOptions = {}) {
  const now = opts.now ?? new Date();
  const atRisk = Math.max(0, opts.atRiskSec ?? 120);
  const risk = new Date(now.getTime() + atRisk * 1000);
  const [conv, byQueue, agents, calls, load] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT
        (COUNT(*) FILTER (WHERE c."status" = 'WAITING'))::int AS "waiting",
        (COUNT(*) FILTER (WHERE c."status" = 'ACTIVE'))::int AS "active",
        (COUNT(*) FILTER (WHERE c."status" = 'BOT'))::int AS "bot",
        MAX(EXTRACT(EPOCH FROM (${now.toISOString()}::timestamp - c."queuedAt"))) FILTER (WHERE c."status" = 'WAITING' AND c."queuedAt" IS NOT NULL)::float8 AS "longestWaitSec",
        (COUNT(*) FILTER (WHERE c."status" IN ('WAITING','ACTIVE') AND c."firstResponseAt" IS NULL AND c."slaFirstResponseDueAt" > ${now.toISOString()}::timestamp AND c."slaFirstResponseDueAt" <= ${risk.toISOString()}::timestamp))::int AS "slaAtRisk",
        (COUNT(*) FILTER (WHERE c."status" IN ('WAITING','ACTIVE') AND c."firstResponseAt" IS NULL AND c."slaFirstResponseDueAt" <= ${now.toISOString()}::timestamp))::int AS "slaBreachedOpen"
      FROM "BvConversation" c WHERE c."orgId" = ${orgId} AND c."status" <> 'CLOSED'`),
    prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT c."queueId" AS "queue", (COUNT(*) FILTER (WHERE c."status" = 'WAITING'))::int AS "waiting", (COUNT(*) FILTER (WHERE c."status" = 'ACTIVE'))::int AS "active",
        MAX(EXTRACT(EPOCH FROM (${now.toISOString()}::timestamp - c."queuedAt"))) FILTER (WHERE c."status" = 'WAITING' AND c."queuedAt" IS NOT NULL)::float8 AS "longestWaitSec"
      FROM "BvConversation" c WHERE c."orgId" = ${orgId} AND c."status" IN ('WAITING','ACTIVE') GROUP BY 1`),
    prisma.bvUser.findMany({ where: { orgId, active: true, role: { in: ['ATENDENTE', 'SUPERVISOR'] } }, select: { id: true, name: true, role: true, presence: true, presenceAt: true, maxConcurrent: true }, take: 500 }),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "BvCall" k WHERE k."orgId" = ${orgId} AND k."status" IN ('RINGING','IVR','QUEUED','ACTIVE') AND k."endedAt" IS NULL AND k."startedAt" > ${new Date(now.getTime() - 6 * 3600_000).toISOString()}::timestamp`),
    prisma.bvConversation.groupBy({ by: ['assignedUserId'], where: { orgId, status: 'ACTIVE', assignedUserId: { not: null } }, _count: { _all: true } }),
  ]);
  const queueIds = byQueue.map((q) => q.queue).filter(Boolean) as string[];
  const qs = queueIds.length ? await prisma.bvQueue.findMany({ where: { orgId, id: { in: queueIds } }, select: { id: true, name: true } }) : [];
  const qn = new Map(qs.map((q) => [q.id, q.name]));
  const loadMap = new Map(load.map((l) => [l.assignedUserId as string, l._count._all]));
  const c = conv[0];
  const onlineAgents = agents.filter((a) => a.role === 'ATENDENTE' && a.presence !== 'OFFLINE');
  return {
    at: now.toISOString(),
    waiting: c.waiting, inService: c.active, withBot: c.bot,
    longestWaitSec: round(c.longestWaitSec, 0) ?? 0,
    slaAtRisk: c.slaAtRisk, slaBreachedOpen: c.slaBreachedOpen, atRiskWindowSec: atRisk,
    activeCalls: calls[0]?.n ?? 0,
    agents: {
      online: onlineAgents.filter((a) => a.presence === 'ONLINE').length,
      busy: onlineAgents.filter((a) => a.presence === 'BUSY').length,
      away: onlineAgents.filter((a) => a.presence === 'AWAY').length,
      totalActive: agents.filter((a) => a.role === 'ATENDENTE').length,
      list: onlineAgents.map((a) => ({ id: a.id, name: a.name, presence: a.presence, presenceAt: a.presenceAt, activeConversations: loadMap.get(a.id) ?? 0, maxConcurrent: a.maxConcurrent })),
    },
    queues: byQueue.map((q) => ({ queue: q.queue, queueName: q.queue ? qn.get(q.queue) ?? null : null, waiting: q.waiting, active: q.active, longestWaitSec: round(q.longestWaitSec, 0) ?? 0 })),
  };
}

/** Emissão periódica opcional: BV_REPORTS_REALTIME_MS > 0 liga; só para órgãos com supervisor conectado. */
export function registerRealtimeEmitter(): void {
  const ms = Number(process.env.BV_REPORTS_REALTIME_MS || 0);
  if (!(ms >= 1000)) return;
  registerJob('balcao.reports.realtime', { intervalMs: ms, lockTtlSec: Math.max(5, Math.ceil(ms / 1000)) }, async () => { await emitRealtimeOnce(); });
}

export async function emitRealtimeOnce(): Promise<number> {
  const io = getIo();
  if (!io) return 0;
  const rooms = io.of('/bv').adapter.rooms;
  let n = 0;
  for (const [room, members] of rooms) {
    if (!room.startsWith('bv:sup:') || !members.size) continue;
    const orgId = room.slice('bv:sup:'.length);
    try { emitToSupervisors(orgId, 'report:realtime', await realtimeSnapshot(orgId)); n++; } catch (err: any) { logger.warn({ err: err?.message }, '[balcao] emissão realtime falhou'); }
  }
  return n;
}
