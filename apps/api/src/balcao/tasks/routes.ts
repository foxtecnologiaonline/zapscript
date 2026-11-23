import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditReq } from '../core/audit';
import { ConversationError } from '../core/conversations';
import { guard, idParam, parse, sendError } from '../core/http';
import { KINDS, LEVELS, loadActor, NOTIFY_CHANNELS, ORIGINS, PRIORITIES, STATUSES, actorHas, TaskError, type Actor } from './model';
import { computeIndicators, indicatorsToCsv, listServiceRequests, toCsv } from './indicators';
import { listNotifications, markAllRead, markRead, unreadCount } from './notifications';
import {
  addComment, assignTask, boardTasks, changeStatus, claimTask, createTask, createTaskFromConversation, getTaskDetail, listComments, listTasks,
  notifyContact, rateTask, serializeTasks, updateTask, type TaskFilters,
} from './service';

const actorOf = (req: FastifyRequest): Promise<Actor> => loadActor({ ...req.bv!, name: req.bv!.name });

/** Converte erros de domínio em respostas padronizadas. */
async function run(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err: any) {
    if (err instanceof TaskError || err instanceof ConversationError) return sendError(reply, err.status, err.code, err.message);
    throw err;
  }
}

const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const bool = z.union([z.boolean(), z.enum(['1', '0', 'true', 'false'])]).transform((v) => v === true || v === '1' || v === 'true');
const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.enum(values)).min(1));

const createSchema = z.object({
  kind: z.enum(KINDS).default('INTERNAL'),
  origin: z.enum(ORIGINS).optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().max(8000).nullish(),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  sectorId: z.string().max(64).nullish(),
  assigneeId: z.string().max(64).nullish(),
  dueAt: isoDate.nullish(),
  tags: tagsSchema.optional(),
  conversationId: z.string().max(64).nullish(),
  contactId: z.string().max(64).nullish(),
  notifyOnClose: z.boolean().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS).nullish(),
  supportLevel: z.enum(LEVELS).nullish(),
});

const fromConversationSchema = z.object({
  conversationId: z.string().min(1).max(64),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().max(8000).nullish(),
  kind: z.enum(['DEMAND', 'SERVICE_REQUEST']).default('DEMAND'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  sectorId: z.string().max(64).nullish(),
  assigneeId: z.string().max(64).nullish(),
  dueAt: isoDate.nullish(),
  tags: tagsSchema.optional(),
  notifyOnClose: z.boolean().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS).nullish(),
  supportLevel: z.enum(LEVELS).nullish(),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueAt: isoDate.nullable().optional(),
  tags: tagsSchema.optional(),
  notifyOnClose: z.boolean().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS).nullable().optional(),
  supportLevel: z.enum(LEVELS).nullable().optional(),
  externalRef: z.string().max(100).nullable().optional(),
});

const filtersSchema = z.object({
  status: csvOf(STATUSES).optional(),
  priority: csvOf(PRIORITIES).optional(),
  kind: csvOf(KINDS).optional(),
  origin: csvOf(ORIGINS).optional(),
  sectorId: z.string().max(64).optional(),
  assigneeId: z.string().max(64).optional(),
  conversationId: z.string().max(64).optional(),
  contactId: z.string().max(64).optional(),
  tag: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  overdue: bool.optional(),
  mine: bool.optional(),
  createdByMe: bool.optional(),
  unassigned: bool.optional(),
  inbox: bool.optional(),
});

const listQuery = filtersSchema.extend({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(200).optional() });
const boardQuery = filtersSchema.extend({ perColumn: z.coerce.number().int().min(0).max(100).default(20) });

const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), format: z.enum(['json', 'csv']).default('json') });
function range(q: z.infer<typeof rangeQuery>) {
  const now = new Date();
  return { from: q.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: q.to ?? new Date(now.getTime() + 1000) };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ── Notificações do usuário (rotas estáticas, antes de /:id) ───────────────
  app.get('/notifications', { preHandler: guard('task:read') }, async (req, reply) => {
    const q = parse(z.object({ unread: bool.optional(), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(64).optional() }), req.query, reply);
    if (!q) return;
    const { orgId, userId } = req.bv!;
    const [list, unread] = await Promise.all([listNotifications(orgId, userId, { unread: q.unread, limit: q.limit, cursor: q.cursor }), unreadCount(orgId, userId)]);
    return { ...list, unread };
  });
  app.get('/notifications/unread-count', { preHandler: guard('task:read') }, async (req) => ({ unread: await unreadCount(req.bv!.orgId, req.bv!.userId) }));
  app.post('/notifications/read-all', { preHandler: guard('task:read') }, async (req) => ({ updated: await markAllRead(req.bv!.orgId, req.bv!.userId) }));
  app.post('/notifications/:id/read', { preHandler: guard('task:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    if (!(await markRead(req.bv!.orgId, req.bv!.userId, p.id))) return sendError(reply, 404, 'notification.not_found', 'Notificação não encontrada');
    return { ok: true, unread: await unreadCount(req.bv!.orgId, req.bv!.userId) };
  });

  // ── Indicadores do service desk ─────────────────────────────────────────────
  app.get('/service-desk/indicators', { preHandler: guard('report:read') }, async (req, reply) => {
    const q = parse(rangeQuery, req.query, reply); if (!q) return;
    if (q.format === 'csv' && !actorHas(await actorOf(req), 'report:export')) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para exportar');
    const { from, to } = range(q);
    const r = await computeIndicators(req.bv!.orgId, from, to);
    await auditReq(req, 'task.indicators.read', { entityType: 'task', meta: { from, to, format: q.format } });
    if (q.format === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="indicadores-service-desk.csv"').send(indicatorsToCsv(r));
    return r;
  });

  app.get('/service-desk/requests', { preHandler: guard('report:read') }, async (req, reply) => {
    const q = parse(rangeQuery, req.query, reply); if (!q) return;
    if (q.format === 'csv' && !actorHas(await actorOf(req), 'report:export')) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para exportar');
    const { from, to } = range(q);
    const rows = await listServiceRequests(req.bv!.orgId, from, to);
    await auditReq(req, 'task.requests.export', { entityType: 'task', meta: { from, to, format: q.format, count: rows.length } });
    if (q.format === 'csv') {
      const csv = toCsv(['codigo', 'titulo', 'nivel', 'prioridade', 'status', 'criada_em', 'respondida_em', 'prazo', 'concluida_em', 'no_prazo', 'dias_de_atraso', 'avaliacao'],
        rows.map((r) => [r.code, r.title, r.level, r.priority, r.status, r.createdAt, r.respondedAt, r.dueAt, r.completedAt, r.onTime === null ? '' : r.onTime ? 'sim' : 'nao', r.lateDays, r.rating]));
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="solicitacoes-de-servico.csv"').send(csv);
    }
    return { items: rows, count: rows.length };
  });

  // ── Quadro, listagem e criação ──────────────────────────────────────────────
  app.get('/board', { preHandler: guard('task:read') }, async (req, reply) => {
    const q = parse(boardQuery, req.query, reply); if (!q) return;
    const { perColumn, ...f } = q;
    return boardTasks(await actorOf(req), f as TaskFilters, perColumn);
  });

  app.get('/', { preHandler: guard('task:read') }, async (req, reply) => {
    const q = parse(listQuery, req.query, reply); if (!q) return;
    const { limit, cursor, ...f } = q;
    return listTasks(await actorOf(req), f as TaskFilters, { limit, cursor });
  });

  app.post('/', { preHandler: guard('task:write') }, async (req, reply) => {
    const body = parse(createSchema, req.body, reply); if (!body) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await createTask(actor.orgId, actor, body);
      await auditReq(req, 'task.create', { entityType: 'task', entityId: task.id, meta: { code: task.code, kind: task.kind } });
      return reply.code(201).send((await serializeTasks(actor.orgId, [task]))[0]);
    });
  });

  app.post('/from-conversation', { preHandler: guard('task:write') }, async (req, reply) => {
    const body = parse(fromConversationSchema, req.body, reply); if (!body) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await createTaskFromConversation(actor.orgId, actor, body);
      await auditReq(req, 'task.create', { entityType: 'task', entityId: task.id, meta: { code: task.code, kind: task.kind, conversationId: body.conversationId } });
      return reply.code(201).send((await serializeTasks(actor.orgId, [task]))[0]);
    });
  });

  // ── Uma tarefa ──────────────────────────────────────────────────────────────
  app.get('/:id', { preHandler: guard('task:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    return run(reply, async () => getTaskDetail(req.bv!.orgId, await actorOf(req), p.id));
  });

  app.patch('/:id', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const body = parse(updateSchema, req.body, reply); if (!body) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await updateTask(actor.orgId, actor, p.id, body);
      await auditReq(req, 'task.update', { entityType: 'task', entityId: task.id, meta: { fields: Object.keys(body) } });
      return (await serializeTasks(actor.orgId, [task]))[0];
    });
  });

  app.post('/:id/status', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const body = parse(z.object({ status: z.enum(STATUSES), resolution: z.string().trim().max(2000).nullish() }), req.body, reply); if (!body) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await changeStatus(actor.orgId, actor, p.id, body.status, { resolution: body.resolution });
      await auditReq(req, 'task.status', { entityType: 'task', entityId: task.id, meta: { status: task.status } });
      return (await serializeTasks(actor.orgId, [task]))[0];
    });
  });

  app.post('/:id/assign', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const body = parse(z.object({ assigneeId: z.string().max(64).nullable().optional(), sectorId: z.string().max(64).nullable().optional() })
      .refine((b) => b.assigneeId !== undefined || b.sectorId !== undefined, { message: 'Informe assigneeId e/ou sectorId' }), req.body, reply);
    if (!body) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await assignTask(actor.orgId, actor, p.id, body);
      await auditReq(req, 'task.assign', { entityType: 'task', entityId: task.id, meta: { assigneeId: task.assigneeId, sectorId: task.sectorId } });
      return (await serializeTasks(actor.orgId, [task]))[0];
    });
  });

  app.post('/:id/claim', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const task = await claimTask(actor.orgId, actor, p.id);
      await auditReq(req, 'task.assign', { entityType: 'task', entityId: task.id, meta: { assigneeId: task.assigneeId, via: 'claim' } });
      return (await serializeTasks(actor.orgId, [task]))[0];
    });
  });

  app.get('/:id/comments', { preHandler: guard('task:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    return run(reply, async () => ({ items: await listComments(req.bv!.orgId, await actorOf(req), p.id) }));
  });

  app.post('/:id/comments', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const body = parse(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().optional(), mentions: z.array(z.string().max(64)).max(20).optional() }), req.body, reply);
    if (!body) return;
    return run(reply, async () => reply.code(201).send(await addComment(req.bv!.orgId, await actorOf(req), p.id, body)));
  });

  app.post('/:id/rating', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const body = parse(z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(1000).nullish() }), req.body, reply); if (!body) return;
    return run(reply, async () => {
      const r = await rateTask(req.bv!.orgId, await actorOf(req), p.id, body);
      await auditReq(req, 'task.rating', { entityType: 'task', entityId: p.id, meta: { score: body.score } });
      return r;
    });
  });

  /** Reenvia o aviso de encerramento ao cidadão (após uma falha). Idempotente. */
  app.post('/:id/resend-close-notice', { preHandler: guard('task:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    return run(reply, async () => {
      const actor = await actorOf(req);
      const t = await getTaskDetail(actor.orgId, actor, p.id); // checa acesso
      if (!t.permissions.canEdit) throw new TaskError('task.forbidden', 'Sem permissão para esta tarefa', 403);
      return notifyContact(actor.orgId, p.id);
    });
  });
}
