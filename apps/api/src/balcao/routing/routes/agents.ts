import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { parse } from '../../core/http';
import { setAgentPresence } from '../../core/presence';
import { actor, guardUser, qbool } from './common';

const PRESENCES = ['OFFLINE', 'ONLINE', 'AWAY', 'BUSY'] as const;
const HANDLER_ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN'];

export async function agentLoads(orgId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const g = await prisma.bvConversation.groupBy({ by: ['assignedUserId'], where: { orgId, assignedUserId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } });
  return new Map(g.map((x) => [x.assignedUserId!, x._count._all]));
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', { preHandler: guardUser('conversation:monitor') }, async (req, reply) => {
    const q = parse(z.object({ presence: z.enum(PRESENCES).optional(), queueId: z.string().max(64).optional(), available: qbool }), req.query, reply); if (!q) return;
    const a = actor(req);
    const memberIds = q.queueId ? (await prisma.bvQueueMember.findMany({ where: { queueId: q.queueId }, select: { userId: true } })).map((m) => m.userId) : null;
    const users = await prisma.bvUser.findMany({
      where: { orgId: a.orgId, active: true, role: { in: HANDLER_ROLES }, ...(q.presence ? { presence: q.presence } : {}), ...(memberIds ? { id: { in: memberIds } } : {}) },
      select: { id: true, name: true, email: true, role: true, presence: true, presenceAt: true, skills: true, maxConcurrent: true, sectorId: true },
      orderBy: { name: 'asc' }, take: 1000,
    });
    const [loads, members] = await Promise.all([
      agentLoads(a.orgId, users.map((u) => u.id)),
      prisma.bvQueueMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, queueId: true } }),
    ]);
    const qBy = new Map<string, string[]>();
    for (const m of members) qBy.set(m.userId, [...(qBy.get(m.userId) ?? []), m.queueId]);
    let items = users.map((u) => ({ ...u, load: loads.get(u.id) ?? 0, queueIds: qBy.get(u.id) ?? [] }));
    if (q.available) items = items.filter((u) => u.presence === 'ONLINE' && u.load < u.maxConcurrent);
    return { items };
  });

  // Diretório enxuto para o atendente escolher o destino de uma transferência (sem e-mail/dados de gestão).
  app.get('/agents/directory', { preHandler: guardUser('conversation:transfer') }, async (req) => {
    const a = actor(req);
    const users = await prisma.bvUser.findMany({
      where: { orgId: a.orgId, active: true, role: { in: HANDLER_ROLES }, id: { not: a.userId } },
      select: { id: true, name: true, presence: true, maxConcurrent: true, skills: true, sectorId: true }, orderBy: { name: 'asc' }, take: 1000,
    });
    const loads = await agentLoads(a.orgId, users.map((u) => u.id));
    return { items: users.map((u) => ({ ...u, load: loads.get(u.id) ?? 0 })) };
  });

  app.get('/agents/me', { preHandler: guardUser('conversation:read') }, async (req) => {
    const a = actor(req);
    const u = await prisma.bvUser.findUniqueOrThrow({ where: { id: a.userId }, select: { id: true, name: true, presence: true, presenceAt: true, maxConcurrent: true, skills: true } });
    return { agent: { ...u, load: (await agentLoads(a.orgId, [a.userId])).get(a.userId) ?? 0 } };
  });

  app.put('/agents/me/presence', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const b = parse(z.strictObject({ presence: z.enum(PRESENCES) }), req.body, reply); if (!b) return;
    const a = actor(req);
    await setAgentPresence(a.orgId, a.userId, b.presence);
    return { presence: b.presence };
  });
}
