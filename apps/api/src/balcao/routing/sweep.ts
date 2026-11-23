import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { addConversationEvent, closeConversation } from '../core/conversations';
import { emitBvEvent } from '../core/events';
import { emitToSupervisors, emitToUser } from '../core/realtime';
import { getHolidays, getOrgSettings } from '../core/settings';
import { registerJob } from '../core/scheduler';
import { drainWaiting, getRoutingMeta, hoursOf, mergeRoutingMeta, prepareConversation, routeConversation } from './acd';
import { addBusinessSecondsFast } from './businessTime';
import { routingConfig, sweepBatchSize, sweepIntervalMs } from './config';
import { convLockKey, withLock } from './lock';
import { emitConversationUpdated } from './realtime';

/**
 * Job `balcao.routing.sweep` (~15 s): 1) roteia WAITING que perderam o evento; 2) overflow; 3) drena a fila;
 * 4) violação de SLA; 5) timeout de conversas inativas. Cada passo é isolado (falha em um não impede os outros).
 */
export interface SweepStats { routed: number; overflowed: number; boosted: number; assigned: number; breaches: number; timedOut: number }
export interface SweepOpts { orgId?: string; now?: Date; /** ignora o intervalo mínimo entre execuções do passo de timeout */ forceTimeouts?: boolean }

const orgFilter = (orgId?: string) => (orgId ? { orgId } : {});
const TIMEOUT_EVERY_MS = 60_000;
let lastTimeoutRun = 0;

/** WAITING sem metadata.routing.routedAt há > 20 s (evento perdido, reinício do processo): roteia agora. */
async function routeStale(o: SweepOpts, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 20_000).toISOString();
  const rows = o.orgId
    ? await prisma.$queryRaw<Array<{ id: string; orgId: string }>>`SELECT id, "orgId" FROM "BvConversation" WHERE status = 'WAITING' AND "assignedUserId" IS NULL AND (metadata->'routing'->>'routedAt') IS NULL AND COALESCE("queuedAt", "startedAt") < ${cutoff}::timestamp AND "orgId" = ${o.orgId} LIMIT 200`
    : await prisma.$queryRaw<Array<{ id: string; orgId: string }>>`SELECT id, "orgId" FROM "BvConversation" WHERE status = 'WAITING' AND "assignedUserId" IS NULL AND (metadata->'routing'->>'routedAt') IS NULL AND COALESCE("queuedAt", "startedAt") < ${cutoff}::timestamp LIMIT 200`;
  for (const r of rows) await routeConversation(r.orgId, r.id, 'NEW', now);
  return rows.length;
}

/**
 * Regras com `minWaitSec` (escalonamento por espera) só casam depois de algum tempo: reavalia as WAITING dos órgãos
 * que têm esse tipo de regra. A reavaliação é idempotente.
 */
async function reevaluateWaitRules(o: SweepOpts, now: Date): Promise<void> {
  const rules = await prisma.bvRoutingRule.findMany({ where: { active: true, ...orgFilter(o.orgId) }, select: { orgId: true, conditions: true } });
  const orgs = new Set(rules.filter((r) => Number((r.conditions as { minWaitSec?: number } | null)?.minWaitSec ?? 0) > 0).map((r) => r.orgId));
  for (const orgId of orgs) {
    const waiting = await prisma.bvConversation.findMany({ where: { orgId, status: 'WAITING', assignedUserId: null }, orderBy: { queuedAt: 'asc' }, take: 200, select: { id: true, metadata: true } });
    for (const c of waiting) {
      if (!getRoutingMeta(c).routedAt) continue;
      await withLock(convLockKey(c.id), async () => { await prepareConversation(orgId, c.id, 'AGENT_AVAILABLE', now); }, { waitMs: 0 });
    }
  }
}

/** Espera acima de `maxWaitSec` (em horário útil): move para `overflowQueueId` ou aumenta a prioridade. */
async function overflow(o: SweepOpts, now: Date): Promise<{ overflowed: number; boosted: number }> {
  const iso = now.toISOString();
  const rows = o.orgId
    ? await prisma.$queryRaw<Array<{ id: string; orgId: string }>>`SELECT id, "orgId" FROM "BvConversation" WHERE status = 'WAITING' AND "assignedUserId" IS NULL AND "queueId" IS NOT NULL AND (metadata->'routing'->>'overflowDueAt') IS NOT NULL AND (metadata->'routing'->>'overflowDueAt')::timestamptz <= ${iso}::timestamptz AND "orgId" = ${o.orgId} LIMIT ${sweepBatchSize()}`
    : await prisma.$queryRaw<Array<{ id: string; orgId: string }>>`SELECT id, "orgId" FROM "BvConversation" WHERE status = 'WAITING' AND "assignedUserId" IS NULL AND "queueId" IS NOT NULL AND (metadata->'routing'->>'overflowDueAt') IS NOT NULL AND (metadata->'routing'->>'overflowDueAt')::timestamptz <= ${iso}::timestamptz LIMIT ${sweepBatchSize()}`;
  let overflowed = 0; let boosted = 0;
  const reroute: Array<{ orgId: string; id: string }> = [];
  for (const r of rows) {
    const locked = await withLock(convLockKey(r.id), async () => {
      const conv = await prisma.bvConversation.findFirst({ where: { id: r.id, orgId: r.orgId, status: 'WAITING', assignedUserId: null } });
      if (!conv?.queueId) return null;
      const meta = getRoutingMeta(conv);
      if (!meta.overflowDueAt || new Date(meta.overflowDueAt) > now) return null;
      const queue = await prisma.bvQueue.findFirst({ where: { id: conv.queueId, orgId: r.orgId, active: true } });
      if (!queue?.maxWaitSec) return null;
      const chain = meta.overflowChain?.length ? meta.overflowChain : [queue.id];
      const target = queue.overflowQueueId && queue.overflowQueueId !== queue.id && !chain.includes(queue.overflowQueueId)
        ? await prisma.bvQueue.findFirst({ where: { id: queue.overflowQueueId, orgId: r.orgId, active: true } }) : null;
      if (target) {
        await prisma.bvConversation.updateMany({ where: { id: conv.id, status: 'WAITING', assignedUserId: null }, data: { queueId: target.id } });
        await mergeRoutingMeta(conv.id, { overflowChain: [...chain, target.id], queueEnteredAt: iso });
        await addConversationEvent(r.orgId, conv.id, 'OVERFLOW', null, { fromQueueId: queue.id, toQueueId: target.id });
        return 'moved' as const;
      }
      const settings = await getOrgSettings(r.orgId);
      const boost = routingConfig(settings).overflowPriorityBoost;
      const next = addBusinessSecondsFast({ timezone: settings.timezone, businessHours: settings.businessHours }, now, queue.maxWaitSec, await getHolidays(r.orgId), hoursOf(queue));
      const upd = await prisma.bvConversation.update({ where: { id: conv.id }, data: { priority: { increment: boost } } });
      await mergeRoutingMeta(conv.id, { extraPriority: (meta.extraPriority ?? 0) + boost, overflowDueAt: next.toISOString() });
      await addConversationEvent(r.orgId, conv.id, 'OVERFLOW', null, { queueId: queue.id, priorityBoost: boost, priority: upd.priority });
      emitConversationUpdated(r.orgId, upd);
      return 'boosted' as const;
    }, { waitMs: 0 });
    if (!locked.ok || !locked.value) continue;
    if (locked.value === 'moved') { overflowed++; reroute.push({ orgId: r.orgId, id: r.id }); } else boosted++;
  }
  for (const r of reroute) await routeConversation(r.orgId, r.id, 'OVERFLOW', now);
  return { overflowed, boosted };
}

/** Marca o SLA violado uma única vez por tipo (FIRST_RESPONSE | RESOLUTION) e avisa supervisores. */
async function slaBreaches(o: SweepOpts, now: Date): Promise<number> {
  const iso = now.toISOString();
  const rows = await prisma.$queryRaw<Array<{ id: string; orgId: string; first: boolean; res: boolean }>>`
    SELECT id, "orgId",
      ("slaFirstResponseDueAt" < ${iso}::timestamp AND "firstResponseAt" IS NULL AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('FIRST_RESPONSE'::text))) AS first,
      ("slaResolutionDueAt" < ${iso}::timestamp AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('RESOLUTION'::text))) AS res
    FROM "BvConversation"
    WHERE status IN ('WAITING', 'ACTIVE') ${o.orgId ? prismaSqlOrg(o.orgId) : prismaSqlNone()}
      AND (
        ("slaFirstResponseDueAt" < ${iso}::timestamp AND "firstResponseAt" IS NULL AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('FIRST_RESPONSE'::text)))
        OR ("slaResolutionDueAt" < ${iso}::timestamp AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb('RESOLUTION'::text)))
      )
    LIMIT ${sweepBatchSize()}`;
  let total = 0;
  for (const r of rows) {
    for (const [kind, due] of [['FIRST_RESPONSE', r.first], ['RESOLUTION', r.res]] as const) {
      if (!due) continue;
      const claimed = await prisma.$executeRaw`UPDATE "BvConversation" SET "slaBreached" = true, metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{routing}', COALESCE(metadata->'routing', '{}'::jsonb) || jsonb_build_object('breached', COALESCE(metadata->'routing'->'breached', '[]'::jsonb) || to_jsonb(${kind}::text)), true) WHERE id = ${r.id} AND NOT (COALESCE(metadata->'routing'->'breached', '[]'::jsonb) @> to_jsonb(${kind}::text))`;
      if (claimed === 0) continue;
      total++;
      await notifyBreach(r.orgId, r.id, kind);
    }
  }
  return total;
}

const prismaSqlOrg = (orgId: string) => Prisma.sql`AND "orgId" = ${orgId}`;
const prismaSqlNone = () => Prisma.empty;

async function notifyBreach(orgId: string, conversationId: string, kind: 'FIRST_RESPONSE' | 'RESOLUTION'): Promise<void> {
  const conv = await prisma.bvConversation.findUnique({ where: { id: conversationId }, select: { id: true, protocol: true, channel: true, queueId: true, assignedUserId: true, status: true } });
  if (!conv) return;
  await addConversationEvent(orgId, conv.id, 'SLA_BREACH', null, { kind });
  emitBvEvent('sla.breach', { orgId, conversationId: conv.id, kind });
  const label = kind === 'FIRST_RESPONSE' ? 'primeira resposta' : 'resolução';
  const title = `SLA de ${label} violado`;
  const body = `Conversa ${conv.protocol} (${conv.channel}) ultrapassou o prazo de ${label}.`;
  const data = { conversationId: conv.id, protocol: conv.protocol, queueId: conv.queueId, kind };
  const targets = await prisma.bvUser.findMany({ where: { orgId, active: true, role: { in: ['SUPERVISOR', 'ADMIN'] } }, select: { id: true } });
  const ids = new Set(targets.map((t) => t.id));
  if (conv.assignedUserId) ids.add(conv.assignedUserId);
  for (const userId of ids) {
    try {
      const n = await prisma.bvNotification.create({ data: { orgId, userId, type: 'SLA_BREACH', title, body, data } });
      emitToUser(userId, 'notification', { id: n.id, type: n.type, title, body, data, createdAt: n.createdAt });
    } catch (err: any) { logger.warn({ err: err?.message }, '[balcao/routing] falha ao gravar notificação de SLA'); }
  }
  const payload = { conversationId: conv.id, protocol: conv.protocol, queueId: conv.queueId, assignedUserId: conv.assignedUserId, kind };
  emitToSupervisors(orgId, 'sla:breach', payload);
  if (conv.assignedUserId) emitToUser(conv.assignedUserId, 'sla:breach', payload);
}

/** BOT/WAITING sem atividade há > timeoutHours: fecha com TIMEOUT. BOT = relógio corrido; WAITING = horário útil da fila. */
async function timeouts(o: SweepOpts, now: Date): Promise<number> {
  if (!o.forceTimeouts && now.getTime() - lastTimeoutRun < TIMEOUT_EVERY_MS) return 0;
  lastTimeoutRun = now.getTime();
  const orgs = o.orgId ? [{ id: o.orgId }] : await prisma.bvOrg.findMany({ select: { id: true } });
  let closed = 0;
  for (const { id: orgId } of orgs) {
    const settings = await getOrgSettings(orgId);
    const cfg = routingConfig(settings);
    if (cfg.timeoutHours <= 0) continue;
    const cutoff = new Date(now.getTime() - cfg.timeoutHours * 3600_000);
    const stale = await prisma.bvConversation.findMany({
      where: { orgId, status: { in: ['BOT', 'WAITING'] }, OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, startedAt: { lt: cutoff } }] },
      orderBy: { startedAt: 'asc' }, take: 200,
      include: { queue: { select: { businessHours: true } } },
    });
    if (!stale.length) continue;
    const holidays = await getHolidays(orgId);
    for (const c of stale) {
      if (c.status === 'WAITING') {
        const last = [c.lastMessageAt, c.queuedAt, c.startedAt].filter((d): d is Date => !!d).reduce((a, b) => (a > b ? a : b));
        const due = addBusinessSecondsFast({ timezone: settings.timezone, businessHours: settings.businessHours }, last, cfg.timeoutHours * 3600, holidays, hoursOf(c.queue));
        if (due > now) continue;
      }
      try {
        await closeConversation({ orgId, conversationId: c.id, reason: 'TIMEOUT', requestCsat: false });
        await addConversationEvent(orgId, c.id, 'TIMEOUT', null, { status: c.status, hours: cfg.timeoutHours });
        closed++;
      } catch (err: any) { logger.warn({ err: err?.message, conversationId: c.id }, '[balcao/routing] falha ao encerrar por timeout'); }
    }
  }
  return closed;
}

export async function runRoutingSweep(o: SweepOpts = {}): Promise<SweepStats> {
  const now = o.now ?? new Date();
  const stats: SweepStats = { routed: 0, overflowed: 0, boosted: 0, assigned: 0, breaches: 0, timedOut: 0 };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err: any) { logger.error({ err: err?.message, step: name }, '[balcao/routing] passo do sweep falhou'); }
  };
  await step('routeStale', async () => { stats.routed = await routeStale(o, now); });
  await step('waitRules', () => reevaluateWaitRules(o, now));
  await step('overflow', async () => { const r = await overflow(o, now); stats.overflowed = r.overflowed; stats.boosted = r.boosted; });
  await step('drain', async () => { stats.assigned = await drainWaiting({ orgId: o.orgId, now, limit: sweepBatchSize() }); });
  await step('sla', async () => { stats.breaches = await slaBreaches(o, now); });
  await step('timeouts', async () => { stats.timedOut = await timeouts(o, now); });
  return stats;
}

/** Registra o job no agendador do núcleo (idempotente por nome). */
export function registerRoutingJobs(): void {
  registerJob('balcao.routing.sweep', { intervalMs: sweepIntervalMs(), lockTtlSec: 120 }, async () => { await runRoutingSweep(); });
}
