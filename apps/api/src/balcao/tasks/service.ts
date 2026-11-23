import type { BvTask, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { nextTaskCode } from '../core/counters';
import { addConversationEvent, canAccessConversation, sendMessage } from '../core/conversations';
import { emitBvEvent } from '../core/events';
import { getOrgSettings } from '../core/settings';
import type { BvAuthContext } from '../core/types';
import {
  actorHas, canEditTask, canViewTask, computeSla, histValue, isClosed, isValidTransition, levelFromPriority, OPEN_STATUSES, scopeOf,
  SYSTEM_ACTOR, TaskError, visibilityWhere, type Actor, type Kind, type Level, type Origin, type Priority, type Status,
} from './model';
import { notifyUsers, sectorUserIds, supervisorIds } from './notifications';

/** Regras de negócio das tarefas. As rotas (routes.ts), o bot e o job de varredura só chamam daqui. */

// ── E-mail injetável (testes não tocam em rede) ───────────────────────────────
export type TaskMailer = (to: string, subject: string, html: string) => Promise<void>;
let mailer: TaskMailer | null = null;
export const setTaskMailer = (fn: TaskMailer | null) => { mailer = fn; };
async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (mailer) return mailer(to, subject, html);
  const { sendEmail } = await import('../../lib/mailer');
  return sendEmail(to, subject, html);
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const hist = (taskId: string, actorId: string | null, field: string, from: unknown, to: unknown): Prisma.BvTaskHistoryCreateManyInput =>
  ({ taskId, actorId, field, fromValue: histValue(from), toValue: histValue(to) });

// ── Criação ───────────────────────────────────────────────────────────────────
export interface CreateTaskInput {
  kind?: Kind;
  origin?: Origin;
  title: string;
  description?: string | null;
  priority?: Priority;
  sectorId?: string | null;
  assigneeId?: string | null;
  dueAt?: Date | null;
  tags?: string[];
  conversationId?: string | null;
  contactId?: string | null;
  notifyOnClose?: boolean;
  notifyChannel?: 'EMAIL' | 'WHATSAPP' | null;
  supportLevel?: Level | null;
}

const asAuth = (a: Actor): BvAuthContext => ({ userId: a.userId ?? '', orgId: a.orgId, role: a.role, name: a.name ?? '', email: '', via: 'jwt' });

async function assertAssignable(orgId: string, assigneeId?: string | null, sectorId?: string | null) {
  if (assigneeId) {
    const u = await prisma.bvUser.findFirst({ where: { id: assigneeId, orgId, active: true }, select: { id: true } });
    if (!u) throw new TaskError('task.assignee_invalid', 'Responsável inexistente ou inativo', 404);
  }
  if (sectorId) {
    const s = await prisma.bvSector.findFirst({ where: { id: sectorId, orgId, active: true }, select: { id: true } });
    if (!s) throw new TaskError('task.sector_invalid', 'Setor inexistente ou inativo', 404);
  }
}

export async function createTask(orgId: string, actor: Actor, input: CreateTaskInput): Promise<BvTask> {
  const kind: Kind = input.kind ?? 'INTERNAL';
  const scope = scopeOf(actor);
  if (!actorHas(actor, 'task:write')) throw new TaskError('task.forbidden', 'Sem permissão para criar tarefas', 403);
  if (scope === 'fiscal') {
    if (kind !== 'SERVICE_REQUEST') throw new TaskError('task.forbidden_kind', 'O perfil Fiscal só cria solicitações de serviço (SERVICE_REQUEST)', 403);
    if (input.assigneeId || input.sectorId || input.conversationId) throw new TaskError('task.forbidden', 'O perfil Fiscal não atribui tarefas nem vincula atendimentos', 403);
  }
  if (kind === 'INTERNAL' && (input.conversationId || input.contactId)) {
    throw new TaskError('task.internal_no_link', 'Tarefa interna não pode ser vinculada a atendimento/contato (use kind DEMAND)');
  }
  await assertAssignable(orgId, input.assigneeId, input.sectorId);

  let conversation: { id: string; contactId: string; protocol: string } | null = null;
  if (input.conversationId) {
    const c = await prisma.bvConversation.findFirst({ where: { id: input.conversationId, orgId } });
    if (!c) throw new TaskError('conversation.not_found', 'Conversa não encontrada', 404);
    if (actor.via !== 'system' && !(await canAccessConversation(asAuth(actor), c))) throw new TaskError('conversation.forbidden', 'Sem acesso a esta conversa', 403);
    conversation = { id: c.id, contactId: c.contactId, protocol: c.protocol };
  }
  let contactId = input.contactId ?? conversation?.contactId ?? null;
  if (contactId) {
    const ct = await prisma.bvContact.findFirst({ where: { id: contactId, orgId }, select: { id: true } });
    if (!ct) throw new TaskError('contact.not_found', 'Contato não encontrado', 404);
  } else contactId = null;
  if (input.notifyOnClose && !contactId) throw new TaskError('task.notify_requires_contact', 'Notificar o cidadão exige uma conversa ou contato vinculado');

  const origin: Origin = actor.via === 'system'
    ? (input.origin ?? 'SYSTEM')
    : (input.origin === 'AGENT' || input.origin === 'BACKOFFICE' ? input.origin : actor.via === 'api-token' ? 'BACKOFFICE' : 'AGENT');
  const priority = input.priority ?? 'NORMAL';
  const supportLevel = kind === 'SERVICE_REQUEST' ? (input.supportLevel ?? levelFromPriority(priority)) : null;
  const createdAt = new Date();
  const sla = await computeSla(orgId, { kind, priority, supportLevel, dueAt: input.dueAt ?? null, createdAt });
  const dueAt = input.dueAt ?? (kind === 'SERVICE_REQUEST' ? sla.slaResolutionDueAt : null);

  const code = await nextTaskCode(orgId);
  const task = await prisma.bvTask.create({
    data: {
      orgId, code, kind, title: input.title.trim(), description: input.description ?? null, priority, origin,
      sectorId: input.sectorId ?? null, assigneeId: input.assigneeId ?? null, creatorId: actor.userId,
      conversationId: conversation?.id ?? null, contactId, dueAt, notifyOnClose: input.notifyOnClose ?? false,
      notifyChannel: input.notifyChannel ?? null, supportLevel, tags: [...new Set(input.tags ?? [])],
      slaResponseDueAt: sla.slaResponseDueAt, slaResolutionDueAt: sla.slaResolutionDueAt, createdAt,
    },
  });
  await prisma.bvTaskHistory.createMany({
    data: [
      hist(task.id, actor.userId, 'status', null, 'OPEN'),
      ...(task.assigneeId ? [hist(task.id, actor.userId, 'assigneeId', null, task.assigneeId)] : []),
      ...(task.sectorId ? [hist(task.id, actor.userId, 'sectorId', null, task.sectorId)] : []),
    ],
  });

  if (conversation) await addConversationEvent(orgId, conversation.id, 'TASK_CREATED', actor.userId, { taskId: task.id, code }).catch(() => undefined);
  await notifyAssignment(orgId, task, actor.userId, null);
  emitBvEvent('task.created', { orgId, taskId: task.id });
  return task;
}

/** Avisa o novo responsável (ou a caixa do setor / supervisores, se for demanda do bot sem destino). */
async function notifyAssignment(orgId: string, task: BvTask, actorId: string | null, prev: { assigneeId: string | null; sectorId: string | null } | null) {
  const data = { taskId: task.id, code: task.code };
  const base = { type: 'task.assigned', title: `Tarefa ${task.code} atribuída a você`, body: task.title, data };
  if (task.assigneeId && task.assigneeId !== prev?.assigneeId && task.assigneeId !== actorId) {
    await notifyUsers(orgId, [task.assigneeId], base);
  } else if (!task.assigneeId && task.sectorId && task.sectorId !== prev?.sectorId) {
    const ids = (await sectorUserIds(orgId, task.sectorId)).filter((id) => id !== actorId);
    await notifyUsers(orgId, ids, { type: 'task.sector_inbox', title: `Nova tarefa na caixa do setor: ${task.code}`, body: task.title, data });
  } else if (!task.assigneeId && !task.sectorId && !prev && task.origin === 'CHATBOT') {
    await notifyUsers(orgId, await supervisorIds(orgId), { type: 'task.new_demand', title: `Nova demanda do chatbot: ${task.code}`, body: task.title, data });
  }
}

export interface FromConversationInput extends Omit<CreateTaskInput, 'conversationId' | 'title' | 'kind'> {
  conversationId: string;
  title?: string;
  kind?: Kind;
}

/** Pré-preenche contato, assunto e protocolo do atendimento. */
export async function createTaskFromConversation(orgId: string, actor: Actor, input: FromConversationInput): Promise<BvTask> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: input.conversationId, orgId } });
  if (!conv) throw new TaskError('conversation.not_found', 'Conversa não encontrada', 404);
  const kind = input.kind ?? 'DEMAND';
  if (kind === 'INTERNAL') throw new TaskError('task.internal_no_link', 'Tarefa a partir de atendimento deve ser DEMAND ou SERVICE_REQUEST');
  const title = input.title?.trim() || (conv.subject ? `${conv.subject} (${conv.protocol})` : `Demanda do atendimento ${conv.protocol}`);
  const description = input.description ?? [`Origem: atendimento ${conv.protocol} (${conv.channel})`, conv.category ? `Categoria: ${conv.category}` : null, conv.subject ? `Assunto: ${conv.subject}` : null].filter(Boolean).join('\n');
  return createTask(orgId, actor, {
    ...input, kind, title, description, conversationId: conv.id, contactId: conv.contactId, origin: input.origin ?? 'AGENT',
    notifyOnClose: input.notifyOnClose ?? true,
    notifyChannel: input.notifyChannel ?? null,
  });
}

/** Chatbot → demanda (origin CHATBOT). Idempotente: o mesmo título aberto na mesma conversa devolve a tarefa existente. */
export async function createTaskFromBot(
  orgId: string,
  input: { conversationId: string; title: string; description: string; category?: string | null; priority?: Priority },
): Promise<BvTask & { duplicate?: boolean }> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new TaskError('validation.failed', 'Título obrigatório');
  const existing = await prisma.bvTask.findFirst({
    where: { orgId, conversationId: input.conversationId, origin: 'CHATBOT', title, status: { in: OPEN_STATUSES } },
  });
  if (existing) return { ...existing, duplicate: true };
  let sectorId: string | null = null;
  const category = input.category?.trim();
  if (category) {
    const sector = await prisma.bvSector.findFirst({ where: { orgId, active: true, name: { equals: category, mode: 'insensitive' } }, select: { id: true } });
    sectorId = sector?.id ?? null;
  }
  // O bot nunca abre URGENT sozinho (evita escalonamento artificial por prompt).
  const priority: Priority = input.priority === 'URGENT' ? 'HIGH' : (input.priority ?? 'NORMAL');
  return createTask(orgId, SYSTEM_ACTOR(orgId), {
    kind: 'DEMAND', origin: 'CHATBOT', title, description: input.description.slice(0, 8000), priority, sectorId,
    conversationId: input.conversationId, notifyOnClose: true, tags: category ? [`categoria:${category.slice(0, 40)}`] : [],
  });
}

// ── Consulta ──────────────────────────────────────────────────────────────────
export interface TaskFilters {
  status?: Status[]; priority?: Priority[]; sectorId?: string; assigneeId?: string; kind?: Kind[]; origin?: Origin[];
  overdue?: boolean; q?: string; mine?: boolean; createdByMe?: boolean; unassigned?: boolean; inbox?: boolean;
  conversationId?: string; contactId?: string; tag?: string;
}

export function buildWhere(actor: Actor, f: TaskFilters, now = new Date()): Prisma.BvTaskWhereInput {
  const and: Prisma.BvTaskWhereInput[] = [visibilityWhere(actor) as Prisma.BvTaskWhereInput];
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.priority?.length) and.push({ priority: { in: f.priority } });
  if (f.kind?.length) and.push({ kind: { in: f.kind } });
  if (f.origin?.length) and.push({ origin: { in: f.origin } });
  if (f.sectorId) and.push({ sectorId: f.sectorId });
  if (f.assigneeId) and.push({ assigneeId: f.assigneeId });
  if (f.conversationId) and.push({ conversationId: f.conversationId });
  if (f.contactId) and.push({ contactId: f.contactId });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.overdue) and.push({ dueAt: { lt: now }, status: { in: OPEN_STATUSES } });
  if (f.mine) and.push({ assigneeId: actor.userId ?? '__none__' });
  if (f.createdByMe) and.push({ creatorId: actor.userId ?? '__none__' });
  if (f.unassigned) and.push({ assigneeId: null });
  if (f.inbox) and.push(actor.sectorId ? { sectorId: actor.sectorId, assigneeId: null } : { id: '__none__' });
  if (f.q?.trim()) and.push({ OR: [{ code: { contains: f.q.trim(), mode: 'insensitive' } }, { title: { contains: f.q.trim(), mode: 'insensitive' } }] });
  return { AND: and };
}

const encodeCursor = (t: { createdAt: Date; id: string }) => Buffer.from(`${t.createdAt.toISOString()}|${t.id}`).toString('base64url');
function decodeCursor(c?: string): { createdAt: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
    const d = new Date(iso);
    return id && !Number.isNaN(d.getTime()) ? { createdAt: d, id } : null;
  } catch { return null; }
}

/** Resumo de SLA calculado (não persistido). */
export function slaState(t: BvTask, now = new Date()) {
  const closed = isClosed(t.status);
  const respondedOrNow = t.respondedAt ?? (closed ? t.completedAt : null) ?? now;
  const endOrNow = t.completedAt ?? now;
  return {
    responseDueAt: t.slaResponseDueAt, resolutionDueAt: t.slaResolutionDueAt,
    responseBreached: !!t.slaResponseDueAt && respondedOrNow > t.slaResponseDueAt,
    resolutionBreached: !!t.slaResolutionDueAt && t.status !== 'CANCELLED' && endOrNow > t.slaResolutionDueAt,
    overdue: !!t.dueAt && !closed && t.dueAt < now,
    remainingSec: t.slaResolutionDueAt && !closed ? Math.round((t.slaResolutionDueAt.getTime() - now.getTime()) / 1000) : null,
  };
}

async function names(orgId: string, users: Array<string | null>, sectors: Array<string | null>) {
  const uIds = [...new Set(users.filter((x): x is string => !!x && !x.startsWith('token:')))];
  const sIds = [...new Set(sectors.filter((x): x is string => !!x))];
  const [u, s] = await Promise.all([
    uIds.length ? prisma.bvUser.findMany({ where: { orgId, id: { in: uIds } }, select: { id: true, name: true } }) : [],
    sIds.length ? prisma.bvSector.findMany({ where: { orgId, id: { in: sIds } }, select: { id: true, name: true } }) : [],
  ]);
  return { users: new Map(u.map((x) => [x.id, x.name])), sectors: new Map(s.map((x) => [x.id, x.name])) };
}

export async function serializeTasks(orgId: string, tasks: BvTask[]) {
  const n = await names(orgId, tasks.flatMap((t) => [t.assigneeId, t.creatorId]), tasks.map((t) => t.sectorId));
  const now = new Date();
  const ref = (id: string | null, m: Map<string, string>) => (id ? { id, name: m.get(id) ?? null } : null);
  return tasks.map((t) => ({
    ...t, assignee: ref(t.assigneeId, n.users), creator: ref(t.creatorId, n.users), sector: ref(t.sectorId, n.sectors), sla: slaState(t, now),
  }));
}

export async function listTasks(actor: Actor, f: TaskFilters, o: { limit: number; cursor?: string }) {
  const where = buildWhere(actor, f);
  const cur = decodeCursor(o.cursor);
  const rows = await prisma.bvTask.findMany({
    where: cur ? { AND: [where, { OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }] }] } : where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: o.limit + 1,
  });
  const hasMore = rows.length > o.limit;
  const items = hasMore ? rows.slice(0, o.limit) : rows;
  return { items: await serializeTasks(actor.orgId, items), nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

/** Quadro (kanban): contagem por status + os cartões mais recentes de cada coluna. */
export async function boardTasks(actor: Actor, f: TaskFilters, perColumn = 20) {
  const where = buildWhere(actor, { ...f, status: undefined });
  const groups = await prisma.bvTask.groupBy({ by: ['status'], where, _count: { _all: true } });
  const counts = new Map(groups.map((g) => [g.status, g._count._all]));
  const columns = await Promise.all((['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'] as Status[]).map(async (status) => {
    const rows = perColumn > 0
      ? await prisma.bvTask.findMany({ where: { AND: [where, { status }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: perColumn })
      : [];
    return { status, count: counts.get(status) ?? 0, items: await serializeTasks(actor.orgId, rows) };
  }));
  return { columns, total: [...counts.values()].reduce((a, b) => a + b, 0) };
}

export async function getTaskRow(orgId: string, actor: Actor, id: string): Promise<BvTask> {
  const t = await prisma.bvTask.findFirst({ where: { id, orgId } });
  // Tarefa de que o ator não pode ver responde 404 (não revela a existência).
  if (!t || !canViewTask(actor, t)) throw new TaskError('task.not_found', 'Tarefa não encontrada', 404);
  return t;
}

export async function getTaskDetail(orgId: string, actor: Actor, id: string) {
  const t = await getTaskRow(orgId, actor, id);
  const fiscal = scopeOf(actor) === 'fiscal';
  const [comments, history, conversation, contact] = await Promise.all([
    prisma.bvTaskComment.findMany({ where: { taskId: t.id, ...(fiscal ? { internal: false } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 }),
    prisma.bvTaskHistory.findMany({ where: { taskId: t.id, NOT: { field: { startsWith: 'sys.' } } }, orderBy: { createdAt: 'asc' }, take: 1000 }),
    t.conversationId ? prisma.bvConversation.findFirst({ where: { id: t.conversationId, orgId }, select: { id: true, protocol: true, channel: true, status: true, subject: true } }) : null,
    t.contactId && actorHas(actor, 'contact:read') ? prisma.bvContact.findFirst({ where: { id: t.contactId, orgId }, select: { id: true, name: true, category: true } }) : null,
  ]);
  const n = await names(orgId, [...comments.map((c) => c.userId), ...history.map((h) => h.actorId)], []);
  const [ser] = await serializeTasks(orgId, [t]);
  const rating = [...history].reverse().find((h) => h.field === 'rating');
  return {
    ...ser, conversation, contact, rating: rating ? Number(rating.toValue) : null,
    comments: comments.map((c) => ({ ...c, user: { id: c.userId, name: n.users.get(c.userId) ?? null } })),
    history: history.map((h) => ({ ...h, actor: h.actorId ? { id: h.actorId, name: n.users.get(h.actorId) ?? null } : null })),
    permissions: { canEdit: canEditTask(actor, t), canReopen: actorHas(actor, 'task:manage'), canRate: t.kind === 'SERVICE_REQUEST' && scopeOf(actor) !== 'agent' },
  };
}

// ── Edição ────────────────────────────────────────────────────────────────────
export interface UpdateTaskInput {
  title?: string; description?: string | null; priority?: Priority; dueAt?: Date | null; tags?: string[];
  notifyOnClose?: boolean; notifyChannel?: 'EMAIL' | 'WHATSAPP' | null; supportLevel?: Level | null; externalRef?: string | null;
}

export async function updateTask(orgId: string, actor: Actor, id: string, patch: UpdateTaskInput): Promise<BvTask> {
  const task = await getTaskRow(orgId, actor, id);
  if (!canEditTask(actor, task)) throw new TaskError('task.forbidden', 'Sem permissão para editar esta tarefa', 403);
  if (isClosed(task.status)) throw new TaskError('task.closed', 'Tarefa encerrada: reabra antes de editar', 409);
  const manager = scopeOf(actor) === 'all';
  if ((patch.supportLevel !== undefined || patch.externalRef !== undefined) && !manager) throw new TaskError('task.forbidden', 'Apenas supervisor/admin altera nível de suporte e referência externa', 403);
  if (patch.supportLevel && task.kind !== 'SERVICE_REQUEST') throw new TaskError('task.invalid', 'Nível de suporte só se aplica a SERVICE_REQUEST');

  const data: Prisma.BvTaskUncheckedUpdateInput = {};
  const rows: Prisma.BvTaskHistoryCreateManyInput[] = [];
  const set = (field: keyof BvTask, to: unknown) => {
    const from = task[field];
    if (histValue(from) === histValue(to)) return;
    (data as any)[field] = to; rows.push(hist(task.id, actor.userId, field, from, to));
  };
  if (patch.title !== undefined) set('title', patch.title.trim());
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.dueAt !== undefined) set('dueAt', patch.dueAt);
  if (patch.tags !== undefined) set('tags', [...new Set(patch.tags)]);
  if (patch.notifyChannel !== undefined) set('notifyChannel', patch.notifyChannel);
  if (patch.supportLevel !== undefined) set('supportLevel', patch.supportLevel);
  if (patch.externalRef !== undefined) set('externalRef', patch.externalRef);
  if (patch.notifyOnClose !== undefined) {
    if (patch.notifyOnClose && !task.contactId) throw new TaskError('task.notify_requires_contact', 'Notificar o cidadão exige uma conversa ou contato vinculado');
    set('notifyOnClose', patch.notifyOnClose);
  }
  if (!rows.length) return task;

  const slaRelevant = 'priority' in data || 'dueAt' in data || 'supportLevel' in data;
  if (slaRelevant) {
    const merged = { ...task, ...(data as Partial<BvTask>) } as BvTask;
    if (merged.kind === 'SERVICE_REQUEST' && !merged.supportLevel) merged.supportLevel = levelFromPriority(merged.priority);
    const sla = await computeSla(orgId, merged);
    data.slaResponseDueAt = sla.slaResponseDueAt; data.slaResolutionDueAt = sla.slaResolutionDueAt;
    // SR: o prazo contratual (ANS) acompanha nível/prioridade; `dueAt` só muda se o usuário informou.
    if (merged.kind === 'SERVICE_REQUEST' && !('dueAt' in data) && ('priority' in data || 'supportLevel' in data)) data.dueAt = sla.slaResolutionDueAt;
  }
  const [updated] = await prisma.$transaction([
    prisma.bvTask.update({ where: { id: task.id }, data }),
    prisma.bvTaskHistory.createMany({ data: rows }),
  ]);
  return updated;
}

// ── Atribuição ────────────────────────────────────────────────────────────────
export async function assignTask(orgId: string, actor: Actor, id: string, body: { assigneeId?: string | null; sectorId?: string | null }): Promise<BvTask> {
  const task = await getTaskRow(orgId, actor, id);
  if (scopeOf(actor) === 'fiscal' || !canEditTask(actor, task)) throw new TaskError('task.forbidden', 'Sem permissão para atribuir esta tarefa', 403);
  if (isClosed(task.status)) throw new TaskError('task.closed', 'Tarefa encerrada: reabra antes de atribuir', 409);
  let assignee = task.assigneeId; let sector = task.sectorId;
  if (body.sectorId !== undefined) { sector = body.sectorId; if (body.assigneeId === undefined && sector !== task.sectorId) assignee = null; }
  if (body.assigneeId !== undefined) assignee = body.assigneeId;
  await assertAssignable(orgId, assignee !== task.assigneeId ? assignee : null, sector !== task.sectorId ? sector : null);
  if (assignee === task.assigneeId && sector === task.sectorId) return task;
  const rows: Prisma.BvTaskHistoryCreateManyInput[] = [];
  if (assignee !== task.assigneeId) rows.push(hist(task.id, actor.userId, 'assigneeId', task.assigneeId, assignee));
  if (sector !== task.sectorId) rows.push(hist(task.id, actor.userId, 'sectorId', task.sectorId, sector));
  const [updated] = await prisma.$transaction([
    prisma.bvTask.update({ where: { id: task.id }, data: { assigneeId: assignee, sectorId: sector } }),
    prisma.bvTaskHistory.createMany({ data: rows }),
  ]);
  await notifyAssignment(orgId, updated, actor.userId, { assigneeId: task.assigneeId, sectorId: task.sectorId });
  return updated;
}

/** "Assumir": pega para si uma tarefa visível e sem responsável (caixa do setor / caixa geral). */
export async function claimTask(orgId: string, actor: Actor, id: string): Promise<BvTask> {
  const task = await getTaskRow(orgId, actor, id);
  if (!actor.userId || actor.via !== 'jwt' || scopeOf(actor) === 'fiscal' || !actorHas(actor, 'task:write')) throw new TaskError('task.forbidden', 'Sem permissão para assumir tarefas', 403);
  if (isClosed(task.status)) throw new TaskError('task.closed', 'Tarefa encerrada', 409);
  const r = await prisma.bvTask.updateMany({ where: { id: task.id, orgId, assigneeId: null }, data: { assigneeId: actor.userId } });
  if (r.count === 0) throw new TaskError('task.already_assigned', 'A tarefa já tem responsável', 409);
  await prisma.bvTaskHistory.create({ data: hist(task.id, actor.userId, 'assigneeId', null, actor.userId) });
  return prisma.bvTask.findFirstOrThrow({ where: { id: task.id, orgId } });
}

// ── Máquina de estados ────────────────────────────────────────────────────────
export async function changeStatus(orgId: string, actor: Actor, id: string, to: Status, opts: { resolution?: string | null } = {}): Promise<BvTask> {
  const task = await getTaskRow(orgId, actor, id);
  if (!canEditTask(actor, task)) throw new TaskError('task.forbidden', 'Sem permissão para alterar esta tarefa', 403);
  const from = task.status as Status;
  if (!isValidTransition(from, to)) throw new TaskError('task.invalid_transition', `Transição inválida: ${from} → ${to}`, 409);
  if (isClosed(from) && !actorHas(actor, 'task:manage')) throw new TaskError('task.reopen_forbidden', 'Reabrir tarefa exige permissão task:manage', 403);
  if (scopeOf(actor) === 'fiscal' && to !== 'CANCELLED') throw new TaskError('task.forbidden', 'O perfil Fiscal só pode cancelar as suas solicitações', 403);

  const now = new Date();
  const data: Prisma.BvTaskUncheckedUpdateManyInput = { status: to };
  const rows: Prisma.BvTaskHistoryCreateManyInput[] = [hist(task.id, actor.userId, 'status', from, to)];
  if (!task.respondedAt && to !== 'OPEN' && to !== 'CANCELLED') data.respondedAt = now;
  if (isClosed(to)) data.completedAt = now;
  if (isClosed(from)) { data.completedAt = null; data.closeNoticeSentAt = null; }
  if (to === 'IN_PROGRESS' && !task.assigneeId && actor.userId && actor.via === 'jwt' && scopeOf(actor) === 'agent') {
    data.assigneeId = actor.userId; rows.push(hist(task.id, actor.userId, 'assigneeId', null, actor.userId));
  }
  const resolution = isClosed(to) ? opts.resolution?.trim() || null : null;
  if (resolution) rows.push(hist(task.id, actor.userId, 'resolution', null, resolution));

  // Guarda otimista: duas requisições simultâneas não fecham (nem notificam) duas vezes.
  const r = await prisma.bvTask.updateMany({ where: { id: task.id, orgId, status: from }, data });
  if (r.count === 0) throw new TaskError('task.conflict', 'A tarefa foi alterada por outra pessoa; recarregue', 409);
  await prisma.bvTaskHistory.createMany({ data: rows });
  if (resolution) await prisma.bvTaskComment.create({ data: { taskId: task.id, userId: actor.userId ?? 'system', body: resolution, internal: false } });

  const updated = await prisma.bvTask.findFirstOrThrow({ where: { id: task.id, orgId } });
  if (isClosed(to)) {
    if (task.creatorId && task.creatorId !== actor.userId) {
      await notifyUsers(orgId, [task.creatorId], { type: 'task.closed', title: `Tarefa ${task.code} ${to === 'DONE' ? 'concluída' : 'cancelada'}`, body: task.title, data: { taskId: task.id, code: task.code, status: to } });
    }
    await notifyContact(orgId, task.id).catch((err) => logger.error({ err: err?.message, taskId: task.id }, '[balcao/tasks] notifyContact falhou'));
    emitBvEvent('task.closed', { orgId, taskId: task.id });
    return prisma.bvTask.findFirstOrThrow({ where: { id: task.id, orgId } });
  }
  return updated;
}

// ── Notificação de encerramento ao cidadão ────────────────────────────────────
export interface NoticeResult { status: 'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY_SENT'; route?: 'CONVERSATION' | 'EMAIL' | 'WHATSAPP'; reason?: string }

/** WebChat: o visitante provavelmente só vê a mensagem se ainda estiver na página. */
const WEBCHAT_WINDOW_SEC = 30 * 60;

function windowOpen(c: { channel: string; lastInboundAt: Date | null }, whatsappWindowHours: number, now: Date): boolean {
  const age = c.lastInboundAt ? (now.getTime() - c.lastInboundAt.getTime()) / 1000 : Infinity;
  switch (c.channel) {
    case 'WHATSAPP': return age < whatsappWindowHours * 3600;
    case 'WEBCHAT': return age < WEBCHAT_WINDOW_SEC;
    case 'EMAIL': return true;
    default: return false; // VOICE: não há como enviar texto
  }
}

/**
 * Avisa o cidadão que a tarefa foi encerrada (TR 1.1.3.1.10.3). Idempotente (`closeNoticeSentAt`) e NUNCA silenciosa:
 * se nenhuma rota funcionar, registra a falha no histórico e cria BvNotification para o responsável.
 *
 * Rotas por `notifyChannel`:
 *   null       → conversa vinculada (janela válida) → e-mail do contato
 *   EMAIL      → e-mail do contato → conversa vinculada (janela válida)
 *   WHATSAPP   → conversa de WhatsApp (a vinculada ou a mais recente do contato) com janela de 24 h aberta
 */
export async function notifyContact(orgId: string, taskId: string, now = new Date()): Promise<NoticeResult> {
  const task = await prisma.bvTask.findFirst({ where: { id: taskId, orgId } });
  if (!task) throw new TaskError('task.not_found', 'Tarefa não encontrada', 404);
  if (!isClosed(task.status)) return { status: 'SKIPPED', reason: 'not_closed' };
  if (!task.notifyOnClose) return { status: 'SKIPPED', reason: 'notify_disabled' };
  if (task.closeNoticeSentAt) return { status: 'ALREADY_SENT' };

  const [conv, settings, resolutionRow] = await Promise.all([
    task.conversationId ? prisma.bvConversation.findFirst({ where: { id: task.conversationId, orgId } }) : null,
    getOrgSettings(orgId),
    prisma.bvTaskHistory.findFirst({ where: { taskId: task.id, field: 'resolution' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const contactId = task.contactId ?? conv?.contactId ?? null;
  const contact = contactId ? await prisma.bvContact.findFirst({ where: { id: contactId, orgId }, select: { id: true, name: true, email: true } }) : null;

  const done = task.status === 'DONE';
  const text = [
    `Atualização da sua solicitação${conv ? ` (protocolo ${conv.protocol})` : ''}: a tarefa ${task.code} - ${task.title} foi ${done ? 'concluída' : 'encerrada sem execução (cancelada)'}.`,
    resolutionRow?.toValue ? `Resultado: ${resolutionRow.toValue}` : null,
  ].filter(Boolean).join('\n');

  const reasons: string[] = [];
  const tryConversation = async (c: NonNullable<typeof conv>, route: 'CONVERSATION' | 'WHATSAPP'): Promise<boolean> => {
    if (!windowOpen(c, settings.whatsapp.windowHours, now)) { reasons.push(`${route.toLowerCase()}:janela_fechada`); return false; }
    try {
      const r = await sendMessage({ orgId, conversationId: c.id, senderType: 'SYSTEM', body: text });
      if (r.error) { reasons.push(`${route.toLowerCase()}:${r.error}`); return false; }
      return true;
    } catch (err: any) { reasons.push(`${route.toLowerCase()}:${err?.code ?? 'erro'}`); return false; }
  };
  const tryEmail = async (): Promise<boolean> => {
    if (!contact?.email) { reasons.push('email:contato_sem_email'); return false; }
    try {
      await sendMail(contact.email, `Solicitação ${task.code} ${done ? 'concluída' : 'encerrada'}`,
        `<p>${esc(text).replace(/\n/g, '<br>')}</p><p>Balcão Virtual</p>`);
      return true;
    } catch (err: any) { reasons.push(`email:${String(err?.message ?? 'erro').slice(0, 120)}`); return false; }
  };

  let route: NoticeResult['route'];
  if (task.notifyChannel === 'WHATSAPP') {
    const wa = conv?.channel === 'WHATSAPP' ? conv
      : contactId ? await prisma.bvConversation.findFirst({ where: { orgId, contactId, channel: 'WHATSAPP' }, orderBy: { lastInboundAt: { sort: 'desc', nulls: 'last' } } }) : null;
    if (!wa) reasons.push('whatsapp:sem_conversa');
    else if (await tryConversation(wa, 'WHATSAPP')) route = 'WHATSAPP';
  } else if (task.notifyChannel === 'EMAIL') {
    if (await tryEmail()) route = 'EMAIL';
    else if (conv && await tryConversation(conv, 'CONVERSATION')) route = 'CONVERSATION';
  } else {
    if (conv && await tryConversation(conv, 'CONVERSATION')) route = 'CONVERSATION';
    else if (await tryEmail()) route = 'EMAIL';
  }

  if (route) {
    await prisma.bvTask.updateMany({ where: { id: task.id, orgId, closeNoticeSentAt: null }, data: { closeNoticeSentAt: now } });
    await prisma.bvTaskHistory.create({ data: hist(task.id, null, 'closeNotice', null, `SENT:${route}`) });
    return { status: 'SENT', route };
  }

  const reason = reasons.join('; ') || 'sem_destino';
  await prisma.bvTaskHistory.create({ data: hist(task.id, null, 'closeNotice', null, `FAILED:${reason}`) });
  const who = task.assigneeId ?? task.creatorId;
  await notifyUsers(orgId, who ? [who] : await supervisorIds(orgId), {
    type: 'task.close_notice_failed', title: `Não foi possível avisar o cidadão sobre ${task.code}`,
    body: `Aviso de encerramento não enviado (${reason}). Entre em contato manualmente.`, data: { taskId: task.id, code: task.code, reason },
  });
  return { status: 'FAILED', reason };
}

// ── Comentários ───────────────────────────────────────────────────────────────
const MENTION_RE = /@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

export async function addComment(orgId: string, actor: Actor, id: string, input: { body: string; internal?: boolean; mentions?: string[] }) {
  const task = await getTaskRow(orgId, actor, id);
  if (!actorHas(actor, 'task:write')) throw new TaskError('task.forbidden', 'Sem permissão para comentar', 403);
  const fiscal = scopeOf(actor) === 'fiscal';
  const internal = fiscal ? false : (input.internal ?? true); // o Fiscal é o solicitante: nunca escreve nota interna
  const comment = await prisma.bvTaskComment.create({ data: { taskId: task.id, userId: actor.userId ?? 'system', body: input.body, internal } });

  if (!task.respondedAt && !internal && !fiscal && actor.userId && actor.userId !== task.creatorId) {
    await prisma.bvTask.updateMany({ where: { id: task.id, orgId, respondedAt: null }, data: { respondedAt: comment.createdAt } });
    await prisma.bvTaskHistory.create({ data: hist(task.id, actor.userId, 'respondedAt', null, comment.createdAt) });
  }

  const mentioned = new Set(input.mentions ?? []);
  const emails = [...input.body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase());
  if (emails.length) (await prisma.bvUser.findMany({ where: { orgId, active: true, email: { in: emails } }, select: { id: true } })).forEach((u) => mentioned.add(u.id));
  mentioned.delete(actor.userId ?? '');
  const data = { taskId: task.id, code: task.code, commentId: comment.id };
  const preview = input.body.slice(0, 200);
  await notifyUsers(orgId, [...mentioned], { type: 'task.mention', title: `Você foi mencionado em ${task.code}`, body: preview, data });
  const others = [task.assigneeId, internal ? null : task.creatorId].filter((x): x is string => !!x && x !== actor.userId && !mentioned.has(x));
  await notifyUsers(orgId, others, { type: 'task.comment', title: `Novo comentário em ${task.code}`, body: preview, data });
  return comment;
}

export async function listComments(orgId: string, actor: Actor, id: string) {
  const task = await getTaskRow(orgId, actor, id);
  const comments = await prisma.bvTaskComment.findMany({ where: { taskId: task.id, ...(scopeOf(actor) === 'fiscal' ? { internal: false } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 });
  const n = await names(orgId, comments.map((c) => c.userId), []);
  return comments.map((c) => ({ ...c, user: { id: c.userId, name: n.users.get(c.userId) ?? null } }));
}

// ── Avaliação (IR) ────────────────────────────────────────────────────────────
/** A tabela não tem campo de nota: guardamos em BvTaskHistory (field 'rating'); vale a mais recente. */
export async function rateTask(orgId: string, actor: Actor, id: string, input: { score: number; comment?: string | null }) {
  const task = await getTaskRow(orgId, actor, id);
  if (scopeOf(actor) === 'agent' || !actorHas(actor, 'task:write')) throw new TaskError('task.forbidden', 'Apenas Fiscal ou supervisor/admin avaliam solicitações', 403);
  if (task.kind !== 'SERVICE_REQUEST') throw new TaskError('task.rating_not_applicable', 'Só solicitações de serviço (SERVICE_REQUEST) são avaliadas', 409);
  if (task.status !== 'DONE') throw new TaskError('task.rating_requires_done', 'A avaliação só é possível após a conclusão', 409);
  const prev = await prisma.bvTaskHistory.findFirst({ where: { taskId: task.id, field: 'rating' }, orderBy: { createdAt: 'desc' } });
  await prisma.bvTaskHistory.create({ data: hist(task.id, actor.userId, 'rating', prev?.toValue ?? null, String(input.score)) });
  if (input.comment?.trim()) await prisma.bvTaskComment.create({ data: { taskId: task.id, userId: actor.userId ?? 'system', body: `Avaliação (nota ${input.score}/10): ${input.comment.trim()}`, internal: false } });
  return { taskId: task.id, score: input.score };
}
