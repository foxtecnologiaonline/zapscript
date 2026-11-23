import { prisma } from '../../lib/prisma';

/**
 * Conjunto de atendentes aptos a receber conversas (presença ONLINE) com carga e histórico recentes.
 * Montado em poucas consultas (independe do nº de conversas) e atualizado em memória a cada atribuição,
 * para o sweep distribuir várias conversas sem reconsultar.
 */
export type Strategy = 'LEAST_BUSY' | 'ROUND_ROBIN' | 'LONGEST_IDLE';

export interface PoolAgent {
  id: string;
  name: string;
  role: string;
  skills: string[];
  maxConcurrent: number;
  load: number;
  queueIds: Set<string>;
  /** Epoch ms da última atribuição recebida (0 = nenhuma na janela). */
  lastAssignedAt: number;
  /** Epoch ms da última atividade (atribuição, encerramento ou mudança de presença). */
  lastActivityAt: number;
}

export interface AgentPool { orgId: string; agents: PoolAgent[] }

const HANDLER_ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN'];
const STATS_WINDOW_MS = 7 * 86400_000;

export async function loadPool(orgId: string, opts: { userIds?: string[]; now?: Date } = {}): Promise<AgentPool> {
  const now = opts.now ?? new Date();
  const users = await prisma.bvUser.findMany({
    where: { orgId, active: true, presence: 'ONLINE', role: { in: HANDLER_ROLES }, ...(opts.userIds ? { id: { in: opts.userIds } } : {}) },
    select: { id: true, name: true, role: true, skills: true, maxConcurrent: true, presenceAt: true },
  });
  if (users.length === 0) return { orgId, agents: [] };
  const ids = users.map((u) => u.id);
  const [loads, stats, members] = await Promise.all([
    prisma.bvConversation.groupBy({ by: ['assignedUserId'], where: { orgId, assignedUserId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.bvConversation.groupBy({
      by: ['assignedUserId'], where: { orgId, assignedUserId: { in: ids }, assignedAt: { gte: new Date(now.getTime() - STATS_WINDOW_MS) } },
      _max: { assignedAt: true, closedAt: true },
    }),
    prisma.bvQueueMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, queueId: true } }),
  ]);
  const loadBy = new Map(loads.map((l) => [l.assignedUserId!, l._count._all]));
  const statBy = new Map(stats.map((s) => [s.assignedUserId!, s._max]));
  const qBy = new Map<string, Set<string>>();
  for (const m of members) { if (!qBy.has(m.userId)) qBy.set(m.userId, new Set()); qBy.get(m.userId)!.add(m.queueId); }
  return {
    orgId,
    agents: users.map((u) => {
      const s = statBy.get(u.id);
      const lastAssignedAt = s?.assignedAt?.getTime() ?? 0;
      return {
        id: u.id, name: u.name, role: u.role, skills: u.skills, maxConcurrent: u.maxConcurrent, load: loadBy.get(u.id) ?? 0,
        queueIds: qBy.get(u.id) ?? new Set<string>(), lastAssignedAt,
        lastActivityAt: Math.max(lastAssignedAt, s?.closedAt?.getTime() ?? 0, u.presenceAt?.getTime() ?? 0),
      };
    }),
  };
}

export interface QueueLike { id: string; requiredSkills: string[]; strategy: string }

export const hasSkills = (agent: Pick<PoolAgent, 'skills'>, required: string[]): boolean =>
  required.every((s) => agent.skills.some((x) => x.toLowerCase() === s.toLowerCase()));

/** Atendente pode receber conversa desta fila? (membro, skills e capacidade). Sem fila: só perfil ATENDENTE. */
export function canTake(agent: PoolAgent, queue: QueueLike | null): boolean {
  if (agent.load >= agent.maxConcurrent) return false;
  if (!queue) return agent.role === 'ATENDENTE';
  return agent.queueIds.has(queue.id) && hasSkills(agent, queue.requiredSkills);
}

/** Ordena os candidatos pela estratégia da fila (o primeiro é o preferido). Desempate estável por id. */
export function rankAgents(agents: PoolAgent[], strategy: string): PoolAgent[] {
  const cmp: Record<Strategy, (a: PoolAgent, b: PoolAgent) => number> = {
    LEAST_BUSY: (a, b) => a.load - b.load || a.lastActivityAt - b.lastActivityAt,
    ROUND_ROBIN: (a, b) => a.lastAssignedAt - b.lastAssignedAt,
    LONGEST_IDLE: (a, b) => a.lastActivityAt - b.lastActivityAt || a.load - b.load,
  };
  const fn = cmp[strategy as Strategy] ?? cmp.LEAST_BUSY;
  return [...agents].sort((a, b) => fn(a, b) || a.id.localeCompare(b.id));
}

export function candidatesFor(pool: AgentPool, queue: QueueLike | null): PoolAgent[] {
  return rankAgents(pool.agents.filter((a) => canTake(a, queue)), queue?.strategy ?? 'LEAST_BUSY');
}

/** Reflete uma atribuição no pool (carga +1 e marcas de tempo). */
export function noteAssigned(agent: PoolAgent, at: number = Date.now()): void {
  agent.load += 1; agent.lastAssignedAt = at; agent.lastActivityAt = at;
}
