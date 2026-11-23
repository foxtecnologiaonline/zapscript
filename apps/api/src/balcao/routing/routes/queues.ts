import type { FastifyInstance } from 'fastify';
import type { BvQueue } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { recordConfigVersion } from '../../core/configVersion';
import { emitBvEvent } from '../../core/events';
import { idParam, parse, sendError } from '../../core/http';
import { can } from '../../core/permissions';
import { CHANNELS } from '../../core/types';
import { actor, guardUser, isUniqueViolation, notFound } from './common';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const businessHoursSchema = z.partialRecord(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']), z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, { message: 'Início deve ser anterior ao fim' })).max(6));
const strs = z.array(z.string().trim().min(1).max(60)).max(50);

const queueFields = {
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'Use letras minúsculas, números e hífen'),
  categories: strs, channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length), requiredSkills: strs,
  priority: z.number().int().min(-1000).max(1000),
  strategy: z.enum(['LEAST_BUSY', 'ROUND_ROBIN', 'LONGEST_IDLE']),
  slaFirstResponseSec: z.number().int().min(10).max(30 * 86400),
  slaResolutionSec: z.number().int().min(60).max(365 * 86400).nullable(),
  maxWaitSec: z.number().int().min(10).max(30 * 86400).nullable(),
  overflowQueueId: z.string().min(1).max(64).nullable(),
  businessHours: businessHoursSchema.nullable(),
  sectorId: z.string().min(1).max(64).nullable(),
  active: z.boolean(),
};
const createSchema = z.strictObject({ ...queueFields, slug: queueFields.slug.optional() }).partial().required({ name: true }).extend({ memberIds: z.array(z.string().max(64)).max(500).optional() });
const patchSchema = z.strictObject(queueFields).partial();

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'fila';

const snapshot = (q: BvQueue, memberIds?: string[]) => ({ ...q, ...(memberIds ? { memberIds } : {}) });

/** O overflow criaria ciclo (a fila `queueId` acabaria em si mesma)? Segue a cadeia a partir de `target`. */
export async function overflowCreatesCycle(orgId: string, queueId: string | null, target: string): Promise<boolean> {
  const queues = await prisma.bvQueue.findMany({ where: { orgId }, select: { id: true, overflowQueueId: true } });
  const next = new Map(queues.map((q) => [q.id, q.overflowQueueId]));
  const seen = new Set<string>();
  let cur: string | null | undefined = target;
  while (cur) {
    if (cur === queueId || seen.has(cur)) return true;
    seen.add(cur);
    cur = next.get(cur);
  }
  return false;
}

async function validateOverflow(orgId: string, selfId: string | null, target: string | null | undefined) {
  if (!target) return null;
  if (target === selfId) return 'A fila não pode ser o próprio overflow';
  const q = await prisma.bvQueue.findFirst({ where: { id: target, orgId }, select: { id: true } });
  if (!q) return 'Fila de overflow não encontrada';
  if (await overflowCreatesCycle(orgId, selfId, target)) return 'Overflow criaria um ciclo entre filas';
  return null;
}

async function validateMembers(orgId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const n = await prisma.bvUser.count({ where: { orgId, id: { in: ids }, active: true } });
  return n === new Set(ids).size;
}

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/queues', { preHandler: guardUser('conversation:read') }, async (req) => {
    const a = actor(req);
    const rows = await prisma.bvQueue.findMany({ where: { orgId: a.orgId }, orderBy: [{ priority: 'desc' }, { name: 'asc' }], include: { _count: { select: { members: true } } } });
    return { items: rows.map(({ _count, ...q }) => ({ ...q, memberCount: _count.members })) };
  });

  app.get('/queues/:id', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const q = await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId }, include: { members: true } });
    if (!q) return notFound(reply, 'Fila');
    const { members, ...rest } = q;
    if (!can(a.role, 'queue:manage')) return { queue: { ...rest, memberCount: members.length } };
    const users = await prisma.bvUser.findMany({ where: { orgId: a.orgId, id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, presence: true, skills: true } });
    return { queue: { ...rest, memberCount: members.length, members: users } };
  });

  app.post('/queues', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const b = parse(createSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    const err = await validateOverflow(a.orgId, null, b.overflowQueueId);
    if (err) return sendError(reply, 400, 'queue.invalid_overflow', err);
    if (b.memberIds && !(await validateMembers(a.orgId, b.memberIds))) return sendError(reply, 400, 'queue.invalid_members', 'Há atendentes inexistentes ou inativos');
    const { memberIds, ...data } = b;
    try {
      const q = await prisma.bvQueue.create({ data: { ...data, slug: b.slug ?? slugify(b.name), orgId: a.orgId, businessHours: (b.businessHours ?? undefined) as never } });
      if (memberIds?.length) await prisma.bvQueueMember.createMany({ data: [...new Set(memberIds)].map((userId) => ({ queueId: q.id, userId })), skipDuplicates: true });
      await recordConfigVersion(a.orgId, 'queue', q.id, snapshot(q, memberIds), a.userId);
      await auditReq(req, 'queue.create', { entityType: 'queue', entityId: q.id, after: snapshot(q, memberIds) });
      for (const userId of memberIds ?? []) emitBvEvent('agent.available', { orgId: a.orgId, userId });
      return reply.code(201).send({ queue: q });
    } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'queue.slug_taken', 'Já existe fila com este identificador');
      throw e;
    }
  });

  app.patch('/queues/:id', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(patchSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    const before = await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!before) return notFound(reply, 'Fila');
    const err = await validateOverflow(a.orgId, before.id, b.overflowQueueId);
    if (err) return sendError(reply, 400, 'queue.invalid_overflow', err);
    try {
      const q = await prisma.bvQueue.update({ where: { id: before.id }, data: { ...b, businessHours: b.businessHours === undefined ? undefined : ((b.businessHours ?? null) as never) } as never });
      await recordConfigVersion(a.orgId, 'queue', q.id, snapshot(q), a.userId);
      await auditReq(req, 'queue.update', { entityType: 'queue', entityId: q.id, before, after: q });
      return { queue: q };
    } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'queue.slug_taken', 'Já existe fila com este identificador');
      throw e;
    }
  });

  app.delete('/queues/:id', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const q = await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!q) return notFound(reply, 'Fila');
    const [open, overflowRefs, rules] = await Promise.all([
      prisma.bvConversation.count({ where: { orgId: a.orgId, queueId: q.id, status: { in: ['WAITING', 'ACTIVE'] } } }),
      prisma.bvQueue.count({ where: { orgId: a.orgId, overflowQueueId: q.id } }),
      prisma.bvRoutingRule.findMany({ where: { orgId: a.orgId }, select: { id: true, action: true } }),
    ]);
    const ruleRefs = rules.filter((r) => (r.action as { queueId?: string } | null)?.queueId === q.id).length;
    if (open || overflowRefs || ruleRefs) return sendError(reply, 409, 'queue.in_use', 'Fila em uso: desative-a em vez de excluir', { openConversations: open, overflowRefs, ruleRefs });
    await prisma.bvQueue.delete({ where: { id: q.id } });
    await recordConfigVersion(a.orgId, 'queue', q.id, { deleted: true, ...q }, a.userId);
    await auditReq(req, 'queue.delete', { entityType: 'queue', entityId: q.id, before: q });
    return reply.code(204).send();
  });

  // ── membros ────────────────────────────────────────────────────────────────
  app.get('/queues/:id/members', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    if (!(await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId }, select: { id: true } }))) return notFound(reply, 'Fila');
    const m = await prisma.bvQueueMember.findMany({ where: { queueId: p.id }, select: { userId: true } });
    const users = await prisma.bvUser.findMany({ where: { orgId: a.orgId, id: { in: m.map((x) => x.userId) } }, select: { id: true, name: true, email: true, role: true, presence: true, skills: true, maxConcurrent: true }, orderBy: { name: 'asc' } });
    return { items: users };
  });

  async function setMembers(req: Parameters<typeof actor>[0], queueId: string, mutate: (current: Set<string>) => Set<string>) {
    const a = actor(req);
    const current = new Set((await prisma.bvQueueMember.findMany({ where: { queueId }, select: { userId: true } })).map((x) => x.userId));
    const next = mutate(new Set(current));
    const add = [...next].filter((x) => !current.has(x)); const remove = [...current].filter((x) => !next.has(x));
    if (remove.length) await prisma.bvQueueMember.deleteMany({ where: { queueId, userId: { in: remove } } });
    if (add.length) await prisma.bvQueueMember.createMany({ data: add.map((userId) => ({ queueId, userId })), skipDuplicates: true });
    const q = await prisma.bvQueue.findUniqueOrThrow({ where: { id: queueId } });
    await recordConfigVersion(a.orgId, 'queue', queueId, snapshot(q, [...next]), a.userId);
    await auditReq(req, 'queue.members', { entityType: 'queue', entityId: queueId, meta: { added: add, removed: remove } });
    for (const userId of add) emitBvEvent('agent.available', { orgId: a.orgId, userId }); // novo membro online já puxa a fila
    return [...next];
  }

  app.put('/queues/:id/members', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ userIds: z.array(z.string().min(1).max(64)).max(500) }), req.body, reply); if (!b) return;
    const a = actor(req);
    if (!(await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId }, select: { id: true } }))) return notFound(reply, 'Fila');
    if (!(await validateMembers(a.orgId, b.userIds))) return sendError(reply, 400, 'queue.invalid_members', 'Há atendentes inexistentes ou inativos');
    return { userIds: await setMembers(req, p.id, () => new Set(b.userIds)) };
  });

  app.post('/queues/:id/members', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ userId: z.string().min(1).max(64) }), req.body, reply); if (!b) return;
    const a = actor(req);
    if (!(await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId }, select: { id: true } }))) return notFound(reply, 'Fila');
    if (!(await validateMembers(a.orgId, [b.userId]))) return sendError(reply, 400, 'queue.invalid_members', 'Atendente inexistente ou inativo');
    return reply.code(201).send({ userIds: await setMembers(req, p.id, (s) => s.add(b.userId)) });
  });

  app.delete('/queues/:id/members/:userId', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam.extend({ userId: z.string().min(1).max(64) }), req.params, reply); if (!p) return;
    const a = actor(req);
    if (!(await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId }, select: { id: true } }))) return notFound(reply, 'Fila');
    await setMembers(req, p.id, (s) => { s.delete(p.userId); return s; });
    return reply.code(204).send();
  });
}
