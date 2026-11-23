import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { recordConfigVersion } from '../../core/configVersion';
import { idParam, parse, sendError } from '../../core/http';
import { getHolidays, getOrgSettings, isWithinBusinessHours, localParts } from '../../core/settings';
import { CHANNELS } from '../../core/types';
import { routingConfig } from '../config';
import { defaultQueue } from '../acd';
import { matchingRules, parseRules, ruleActionSchema, ruleConditionsSchema } from '../rules';
import { actor, guardUser, notFound } from './common';

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), active: z.boolean().default(true),
  conditions: ruleConditionsSchema.default({}), action: ruleActionSchema,
  position: z.number().int().min(0).max(100000).optional(),
});
const patchSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), active: z.boolean(), conditions: ruleConditionsSchema, action: ruleActionSchema,
  position: z.number().int().min(0).max(100000),
}).partial();

async function queueOk(orgId: string, queueId: string): Promise<boolean> {
  return !!(await prisma.bvQueue.findFirst({ where: { id: queueId, orgId }, select: { id: true } }));
}

/** Regrava `position` como 0..n-1 na ordem atual (evita lacunas/empates após inserções e remoções). */
async function compact(orgId: string): Promise<void> {
  const rows = await prisma.bvRoutingRule.findMany({ where: { orgId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, position: true } });
  await prisma.$transaction(rows.flatMap((r, i) => (r.position === i ? [] : [prisma.bvRoutingRule.update({ where: { id: r.id }, data: { position: i } })])));
}

export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/routing-rules', { preHandler: guardUser('routing:manage') }, async (req) => {
    const rows = await prisma.bvRoutingRule.findMany({ where: { orgId: actor(req).orgId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return { items: rows };
  });

  app.get('/routing-rules/:id', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const r = await prisma.bvRoutingRule.findFirst({ where: { id: p.id, orgId: actor(req).orgId } });
    return r ? { rule: r } : notFound(reply, 'Regra');
  });

  app.post('/routing-rules', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const b = parse(createSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    if (!(await queueOk(a.orgId, b.action.queueId))) return sendError(reply, 400, 'rule.invalid_queue', 'Fila da ação não encontrada');
    const last = await prisma.bvRoutingRule.aggregate({ where: { orgId: a.orgId }, _max: { position: true } });
    const position = b.position ?? ((last._max.position ?? -1) + 1);
    // abre espaço: quem estava em `position` ou depois desce uma posição
    await prisma.bvRoutingRule.updateMany({ where: { orgId: a.orgId, position: { gte: position } }, data: { position: { increment: 1 } } });
    const r = await prisma.bvRoutingRule.create({ data: { orgId: a.orgId, name: b.name, active: b.active, conditions: b.conditions, action: b.action, position } });
    await compact(a.orgId);
    const fresh = await prisma.bvRoutingRule.findUniqueOrThrow({ where: { id: r.id } });
    await recordConfigVersion(a.orgId, 'routing-rule', r.id, fresh, a.userId);
    await auditReq(req, 'routing-rule.create', { entityType: 'routing-rule', entityId: r.id, after: fresh });
    return reply.code(201).send({ rule: fresh });
  });

  app.patch('/routing-rules/:id', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(patchSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    const before = await prisma.bvRoutingRule.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!before) return notFound(reply, 'Regra');
    if (b.action && !(await queueOk(a.orgId, b.action.queueId))) return sendError(reply, 400, 'rule.invalid_queue', 'Fila da ação não encontrada');
    const { position, ...rest } = b;
    await prisma.bvRoutingRule.update({ where: { id: before.id }, data: rest });
    if (position !== undefined && position !== before.position) {
      const others = (await prisma.bvRoutingRule.findMany({ where: { orgId: a.orgId, id: { not: before.id } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } })).map((x) => x.id);
      others.splice(Math.min(position, others.length), 0, before.id);
      await prisma.$transaction(others.map((id, i) => prisma.bvRoutingRule.update({ where: { id }, data: { position: i } })));
    }
    const after = await prisma.bvRoutingRule.findUniqueOrThrow({ where: { id: before.id } });
    await recordConfigVersion(a.orgId, 'routing-rule', after.id, after, a.userId);
    await auditReq(req, 'routing-rule.update', { entityType: 'routing-rule', entityId: after.id, before, after });
    return { rule: after };
  });

  app.delete('/routing-rules/:id', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const before = await prisma.bvRoutingRule.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!before) return notFound(reply, 'Regra');
    await prisma.bvRoutingRule.delete({ where: { id: before.id } });
    await compact(a.orgId);
    await recordConfigVersion(a.orgId, 'routing-rule', before.id, { deleted: true, ...before }, a.userId);
    await auditReq(req, 'routing-rule.delete', { entityType: 'routing-rule', entityId: before.id, before });
    return reply.code(204).send();
  });

  /** Reordenação: `ids` deve conter TODAS as regras do órgão, uma vez cada, na nova ordem. */
  app.post('/routing-rules/reorder', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const b = parse(z.strictObject({ ids: z.array(z.string().min(1).max(64)).max(500) }), req.body, reply); if (!b) return;
    const a = actor(req);
    const existing = await prisma.bvRoutingRule.findMany({ where: { orgId: a.orgId }, select: { id: true } });
    const same = existing.length === b.ids.length && new Set(b.ids).size === b.ids.length && existing.every((e) => b.ids.includes(e.id));
    if (!same) return sendError(reply, 400, 'rule.invalid_order', 'Informe todas as regras do órgão, sem repetir');
    await prisma.$transaction(b.ids.map((id, i) => prisma.bvRoutingRule.update({ where: { id }, data: { position: i } })));
    await auditReq(req, 'routing-rule.reorder', { entityType: 'routing-rule', meta: { ids: b.ids } });
    for (const id of b.ids) {
      const r = await prisma.bvRoutingRule.findUniqueOrThrow({ where: { id } });
      await recordConfigVersion(a.orgId, 'routing-rule', id, r, a.userId);
    }
    return { items: await prisma.bvRoutingRule.findMany({ where: { orgId: a.orgId }, orderBy: { position: 'asc' } }) };
  });

  /** Simulação (não grava nada): em qual fila e com qual prioridade uma conversa hipotética cairia. */
  app.post('/routing-rules/test', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const b = parse(z.strictObject({
      channel: z.enum(CHANNELS), contactCategory: z.string().max(60).optional(), category: z.string().max(60).optional(), intent: z.string().max(60).optional(),
      waitSec: z.number().int().min(0).optional(), at: z.coerce.date().optional(),
    }), req.body, reply); if (!b) return;
    const a = actor(req);
    const at = b.at ?? new Date();
    const [settings, holidays, queues, rows] = await Promise.all([
      getOrgSettings(a.orgId), getHolidays(a.orgId),
      prisma.bvQueue.findMany({ where: { orgId: a.orgId, active: true } }),
      prisma.bvRoutingRule.findMany({ where: { orgId: a.orgId, active: true } }),
    ]);
    const byId = new Map(queues.map((q) => [q.id, q]));
    const ctx = { channel: b.channel, contactCategory: b.contactCategory, category: b.category, intent: b.intent, outsideHours: !isWithinBusinessHours(settings, at, holidays), weekday: localParts(at, settings.timezone).day, waitSec: b.waitSec ?? 0 };
    const hit = matchingRules(parseRules(rows), ctx).find((r) => byId.has(r.action.queueId));
    const queue = hit ? byId.get(hit.action.queueId)! : defaultQueue(queues, { channel: b.channel, category: b.category ?? null });
    const weight = routingConfig(settings).categoryWeights[(b.contactCategory ?? '').toUpperCase()] ?? 0;
    return { ruleId: hit?.id ?? null, queueId: queue?.id ?? null, queueName: queue?.name ?? null, priority: (queue?.priority ?? 0) + (hit?.action.priorityBoost ?? 0) + weight, outsideHours: ctx.outsideHours };
  });
}
