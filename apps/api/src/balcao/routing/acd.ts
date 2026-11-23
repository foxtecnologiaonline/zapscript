import type { BvConversation, BvQueue } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { addConversationEvent, assignConversation, ConversationError, sendMessage } from '../core/conversations';
import type { BvEventMap } from '../core/events';
import { agentLoad } from '../core/presence';
import { getHolidays, getOrgSettings, isWithinBusinessHours, localParts, type BusinessHours, type BvOrgSettings } from '../core/settings';
import { addBusinessSecondsFast } from './businessTime';
import { routingConfig } from './config';
import { agentLockKey, convLockKey, withLock } from './lock';
import { candidatesFor, loadPool, noteAssigned, type AgentPool, type PoolAgent } from './pool';
import { emitConversationQueued, emitConversationUpdated } from './realtime';
import { matchingRules, parseRules, type RuleContext } from './rules';

/**
 * Motor de roteamento (ACD) do Balcão. Fluxo de uma conversa WAITING:
 *  1. `prepareConversation`: escolhe a fila (regras → categoria/canal → 'geral' → 1ª ativa), grava fila/prioridade/SLA e
 *     avisa (uma única vez) se estiver fora do horário comercial;
 *  2. `attemptAssign`: escolhe o atendente (ONLINE, membro, skills, capacidade, estratégia) e chama `assignConversation`.
 * Atomicidade: lock por conversa (e por atendente na checagem de capacidade). Idempotente: reexecutar não duplica
 * atribuição, aviso de fora de horário nem eventos.
 */
export type RouteReason = BvEventMap['conversation.needs_routing']['reason'];
const KEEP_QUEUE: RouteReason[] = ['TRANSFER', 'OVERFLOW'];

export interface RoutingMeta {
  routedAt?: string;
  /** `queuedAt` da "geração" roteada: muda em reabertura/escalonamento/transferência e reinicia o ciclo. */
  generation?: string;
  ruleId?: string | null;
  queueEnteredAt?: string;
  overflowDueAt?: string | null;
  overflowChain?: string[];
  extraPriority?: number;
  outsideHoursNoticeFor?: string;
  breached?: string[];
}

export const getRoutingMeta = (c: Pick<BvConversation, 'metadata'>): RoutingMeta => {
  const m = c.metadata as Record<string, unknown> | null;
  return ((m && typeof m === 'object' ? m.routing : null) ?? {}) as RoutingMeta;
};

/** Mescla `patch` em metadata.routing sem tocar nas demais chaves de metadata (outros módulos escrevem lá). */
export async function mergeRoutingMeta(conversationId: string, patch: Record<string, unknown>): Promise<void> {
  await prisma.$executeRaw`UPDATE "BvConversation" SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{routing}', COALESCE(metadata->'routing', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, true) WHERE id = ${conversationId}`;
}

export const hoursOf = (q: Pick<BvQueue, 'businessHours'> | null): BusinessHours | null => {
  const h = q?.businessHours as unknown;
  return h && typeof h === 'object' && !Array.isArray(h) ? (h as BusinessHours) : null;
};
const bizOf = (s: BvOrgSettings) => ({ timezone: s.timezone, businessHours: s.businessHours });
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** Fila "natural" sem regra: categoria/canal → slug 'geral' → 1ª ativa. */
export function defaultQueue(queues: BvQueue[], conv: Pick<BvConversation, 'category' | 'channel'>): BvQueue | null {
  const fits = queues.filter((q) => q.channels.length === 0 || q.channels.includes(conv.channel));
  const scored = fits
    .map((q) => ({ q, score: (conv.category && q.categories.some((c) => norm(c) === norm(conv.category)) ? 2 : 0) + (q.channels.length ? 1 : 0) }))
    .filter((x) => x.score >= 2 || (x.score === 1 && x.q.categories.length === 0));
  scored.sort((a, b) => b.score - a.score || b.q.priority - a.q.priority || a.q.createdAt.getTime() - b.q.createdAt.getTime());
  if (scored[0]) return scored[0].q;
  const byOrder = (a: BvQueue, b: BvQueue) => a.createdAt.getTime() - b.createdAt.getTime();
  return queues.find((q) => q.slug === 'geral') ?? [...fits].sort(byOrder)[0] ?? [...queues].sort(byOrder)[0] ?? null;
}

export interface Prepared { conv: BvConversation; queue: BvQueue | null; outsideHours: boolean; ruleId: string | null }

/** Passos 1–3: fila, prioridade, SLA e aviso de fora do horário. Idempotente. Retorna null se a conversa não está mais WAITING. */
export async function prepareConversation(orgId: string, conversationId: string, reason: RouteReason, now: Date = new Date()): Promise<Prepared | null> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId, status: 'WAITING' }, include: { contact: { select: { category: true } } } });
  if (!conv) return null;
  const [settings, holidays, queues, ruleRows] = await Promise.all([
    getOrgSettings(orgId), getHolidays(orgId),
    prisma.bvQueue.findMany({ where: { orgId, active: true } }),
    prisma.bvRoutingRule.findMany({ where: { orgId, active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  const cfg = routingConfig(settings);
  const meta = getRoutingMeta(conv);
  const nowIso = now.toISOString();
  const qIso = (conv.queuedAt ?? conv.startedAt).toISOString();
  const newGen = !meta.routedAt || meta.generation !== qIso;
  const keep = KEEP_QUEUE.includes(reason);
  const resetCycle = newGen && !keep;
  const byId = new Map(queues.map((q) => [q.id, q]));

  // 1) fila
  let queue: BvQueue | null = null;
  let ruleId: string | null = null;
  let boost = 0;
  let setCategory: string | undefined;
  if (keep && conv.queueId && byId.has(conv.queueId)) queue = byId.get(conv.queueId)!;
  if (!queue) {
    const ctx: RuleContext = {
      channel: conv.channel, contactCategory: conv.contact.category, category: conv.category, intent: conv.intent,
      outsideHours: !isWithinBusinessHours(settings, now, holidays), weekday: localParts(now, settings.timezone).day,
      waitSec: conv.queuedAt ? Math.max(0, Math.floor((now.getTime() - conv.queuedAt.getTime()) / 1000)) : 0,
    };
    for (const r of matchingRules(parseRules(ruleRows), ctx)) {
      const q = byId.get(r.action.queueId);
      if (q) { queue = q; ruleId = r.id; boost = r.action.priorityBoost ?? 0; setCategory = r.action.setCategory; break; }
    }
  }
  if (!queue) queue = defaultQueue(queues, conv);

  // 2) prioridade e SLA
  const weight = cfg.categoryWeights[(conv.contact.category ?? '').toUpperCase()] ?? 0;
  const extra = newGen ? 0 : (meta.extraPriority ?? 0);
  const priority = (queue?.priority ?? 0) + boost + weight + extra;
  const queueChanged = conv.queueId !== (queue?.id ?? null);
  const hours = hoursOf(queue);
  const biz = bizOf(settings);
  const data: Prisma.BvConversationUpdateManyMutationInput & { queueId?: string | null } = { priority };
  data.queueId = queue?.id ?? null;
  if (setCategory) data.category = setCategory;
  if (resetCycle || (!conv.slaFirstResponseDueAt && !conv.firstResponseAt)) {
    data.slaFirstResponseDueAt = conv.firstResponseAt ? null : addBusinessSecondsFast(biz, conv.queuedAt ?? now, queue?.slaFirstResponseSec ?? settings.sla.firstResponseSec, holidays, hours);
  }
  if (resetCycle || !conv.slaResolutionDueAt) {
    const base = reason === 'REOPEN' ? (conv.queuedAt ?? now) : conv.startedAt;
    data.slaResolutionDueAt = addBusinessSecondsFast(biz, base, queue?.slaResolutionSec ?? settings.sla.resolutionSec, holidays, hours);
  }
  if (resetCycle) data.slaBreached = false;
  const upd = await prisma.bvConversation.updateMany({ where: { id: conv.id, orgId, status: 'WAITING' }, data: data as Prisma.BvConversationUpdateManyMutationInput });
  if (upd.count === 0) return null;

  const patch: Record<string, unknown> = { routedAt: nowIso, generation: qIso, ruleId };
  if (newGen || queueChanged) {
    patch.queueEnteredAt = nowIso;
    patch.overflowDueAt = queue?.maxWaitSec ? addBusinessSecondsFast(biz, now, queue.maxWaitSec, holidays, hours).toISOString() : null;
  }
  if (newGen) { patch.extraPriority = 0; patch.overflowChain = []; }
  if (resetCycle) patch.breached = [];
  await mergeRoutingMeta(conv.id, patch);

  const fresh = await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv.id } });
  if (newGen || queueChanged) {
    await addConversationEvent(orgId, conv.id, 'QUEUED', null, { queueId: queue?.id ?? null, ruleId, priority, reason });
    await emitConversationQueued({ id: fresh.id, protocol: fresh.protocol, channel: fresh.channel, status: fresh.status, queueId: fresh.queueId, priority: fresh.priority }).catch(() => undefined);
  }
  emitConversationUpdated(orgId, fresh, { slaFirstResponseDueAt: fresh.slaFirstResponseDueAt, slaResolutionDueAt: fresh.slaResolutionDueAt });

  // 3) fora do horário: avisa o cidadão uma única vez por "geração" e mantém WAITING
  const outsideHours = !isWithinBusinessHours(settings, now, holidays, hours);
  if (outsideHours && fresh.channel !== 'VOICE' && settings.outsideHoursMessage?.trim()) {
    const claimed = await prisma.$executeRaw`UPDATE "BvConversation" SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{routing}', COALESCE(metadata->'routing', '{}'::jsonb) || jsonb_build_object('outsideHoursNoticeFor', ${qIso}::text), true) WHERE id = ${conv.id} AND (metadata->'routing'->>'outsideHoursNoticeFor') IS DISTINCT FROM ${qIso}::text`;
    if (claimed > 0) {
      await sendMessage({ orgId, conversationId: conv.id, senderType: 'SYSTEM', body: settings.outsideHoursMessage }).catch((err) =>
        logger.warn({ err: err?.message, conversationId: conv.id }, '[balcao/routing] falha ao enviar aviso de fora do horário'));
    }
  }
  return { conv: fresh, queue, outsideHours, ruleId };
}

// ── Atribuição ───────────────────────────────────────────────────────────────
type AgentOutcome = 'assigned' | 'full' | 'unavailable' | 'gone';

/** Checa capacidade/presença sob lock do atendente e atribui. */
async function assignToAgent(orgId: string, conversationId: string, agent: PoolAgent): Promise<AgentOutcome> {
  const res = await withLock(agentLockKey(agent.id), async (): Promise<AgentOutcome> => {
    const u = await prisma.bvUser.findFirst({ where: { id: agent.id, orgId, active: true, presence: 'ONLINE' }, select: { maxConcurrent: true } });
    if (!u) return 'unavailable';
    agent.maxConcurrent = u.maxConcurrent;
    agent.load = await agentLoad(agent.id);
    if (agent.load >= u.maxConcurrent) return 'full';
    try {
      await assignConversation({ orgId, conversationId, userId: agent.id, via: 'AUTO' });
      return 'assigned';
    } catch (err) {
      if (err instanceof ConversationError && err.code === 'conversation.not_assignable') return 'gone';
      if (err instanceof ConversationError && err.code === 'user.not_found') return 'unavailable';
      throw err;
    }
  }, { waitMs: 3000 });
  return res.ok ? res.value : 'full';
}

export type AttemptResult =
  | { result: 'assigned'; userId: string }
  | { result: 'outside_hours' | 'no_agent' | 'skipped' | 'busy' };

export interface AttemptOpts {
  reason: RouteReason;
  /** true: reexecuta fila/prioridade/SLA (evento de roteamento); false: usa o que já foi gravado (drenagem). */
  prepare: boolean;
  /** Restringe a um atendente (drenagem ao ficar disponível). */
  onlyAgentId?: string;
  now?: Date;
  queueCache?: Map<string, BvQueue | null>;
}

/** Tenta atribuir UMA conversa WAITING a um atendente do `pool`. Seguro para chamadas concorrentes (lock por conversa). */
export async function attemptAssign(orgId: string, conversationId: string, pool: AgentPool, opts: AttemptOpts): Promise<AttemptResult> {
  const now = opts.now ?? new Date();
  const locked = await withLock(convLockKey(conversationId), async (): Promise<AttemptResult> => {
    let conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId, status: 'WAITING', assignedUserId: null } });
    if (!conv) return { result: 'skipped' };
    let queue: BvQueue | null = null;
    let outside = false;
    const needPrepare = async () => {
      const p = await prepareConversation(orgId, conversationId, opts.reason, now);
      if (!p) return false;
      conv = p.conv; queue = p.queue; outside = p.outsideHours;
      return true;
    };
    if (opts.prepare || !getRoutingMeta(conv).routedAt) {
      if (!(await needPrepare())) return { result: 'skipped' };
    } else {
      if (conv.queueId) {
        const cache = opts.queueCache;
        if (cache?.has(conv.queueId)) queue = cache.get(conv.queueId) ?? null;
        else { queue = await prisma.bvQueue.findFirst({ where: { id: conv.queueId, orgId, active: true } }); cache?.set(conv.queueId, queue); }
        if (!queue && !(await needPrepare())) return { result: 'skipped' }; // fila removida/desativada → reavalia
      }
      if (queue) {
        const [settings, holidays] = await Promise.all([getOrgSettings(orgId), getHolidays(orgId)]);
        outside = !isWithinBusinessHours(settings, now, holidays, hoursOf(queue));
      }
    }
    if (outside) return { result: 'outside_hours' };
    const cands = candidatesFor(pool, queue).filter((a) => !opts.onlyAgentId || a.id === opts.onlyAgentId);
    for (const a of cands) {
      const r = await assignToAgent(orgId, conversationId, a);
      if (r === 'assigned') { noteAssigned(a); return { result: 'assigned', userId: a.id }; }
      if (r === 'gone') return { result: 'skipped' };
      // 'full' | 'unavailable': a carga real foi relida em `a`; tenta o próximo candidato
    }
    return { result: 'no_agent' };
  }, { waitMs: opts.prepare ? 3000 : 0 });
  return locked.ok ? locked.value : { result: 'busy' };
}

/** Evento `conversation.needs_routing`: prepara e tenta atribuir. */
export async function routeConversation(orgId: string, conversationId: string, reason: RouteReason, now?: Date): Promise<AttemptResult> {
  const pool = await loadPool(orgId, { now });
  return attemptAssign(orgId, conversationId, pool, { reason, prepare: true, now });
}

/** Evento `agent.available`: o atendente puxa, por prioridade e espera, as conversas WAITING das suas filas até esgotar a capacidade. */
export async function drainForAgent(orgId: string, userId: string, now?: Date): Promise<number> {
  const pool = await loadPool(orgId, { userIds: [userId], now });
  const agent = pool.agents[0];
  if (!agent) return 0;
  const tried = new Set<string>();
  const queueCache = new Map<string, BvQueue | null>();
  let assigned = 0;
  while (agent.load < agent.maxConcurrent && tried.size < 200) {
    const batch = await prisma.bvConversation.findMany({
      where: {
        orgId, status: 'WAITING', assignedUserId: null, id: { notIn: [...tried] },
        OR: [{ queueId: { in: [...agent.queueIds] } }, ...(agent.role === 'ATENDENTE' ? [{ queueId: null }] : [])],
      },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }, { id: 'asc' }], take: 25, select: { id: true },
    });
    if (batch.length === 0) break;
    for (const c of batch) {
      tried.add(c.id);
      const r = await attemptAssign(orgId, c.id, pool, { reason: 'AGENT_AVAILABLE', prepare: false, onlyAgentId: agent.id, now, queueCache });
      if (r.result === 'assigned') assigned++;
      if (agent.load >= agent.maxConcurrent) break;
    }
  }
  return assigned;
}

/** Drenagem orientada à conversa (sweep): distribui as WAITING já roteadas (prioridade desc, espera desc). */
export async function drainWaiting(opts: { orgId?: string; now?: Date; limit?: number } = {}): Promise<number> {
  const rows = await prisma.bvConversation.findMany({
    where: { status: 'WAITING', assignedUserId: null, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }, { id: 'asc' }], take: opts.limit ?? 500,
    select: { id: true, orgId: true, metadata: true },
  });
  const pools = new Map<string, AgentPool>();
  const caches = new Map<string, Map<string, BvQueue | null>>();
  let assigned = 0;
  for (const r of rows) {
    if (!getRoutingMeta(r as Pick<BvConversation, 'metadata'>).routedAt) continue; // não roteada: o passo "prepareStale" cuida
    let pool = pools.get(r.orgId);
    if (!pool) { pool = await loadPool(r.orgId, { now: opts.now }); pools.set(r.orgId, pool); caches.set(r.orgId, new Map()); }
    if (!pool.agents.some((a) => a.load < a.maxConcurrent)) continue;
    const res = await attemptAssign(r.orgId, r.id, pool, { reason: 'AGENT_AVAILABLE', prepare: false, now: opts.now, queueCache: caches.get(r.orgId) });
    if (res.result === 'assigned') assigned++;
  }
  return assigned;
}
