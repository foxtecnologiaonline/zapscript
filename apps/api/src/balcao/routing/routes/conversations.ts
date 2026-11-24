import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BvConversation, Prisma } from '@prisma/client';
import path from 'path';
import { logger } from '../../../lib/logger';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import {
  addConversationEvent, addNote, assignConversation, canAccessConversation, closeConversation, ConversationError, sendMessage, transferConversation,
} from '../../core/conversations';
import { getContactDocument, maskDocument } from '../../core/contacts';
import { idParam, parse, sendError } from '../../core/http';
import { AttachmentRejectedError } from '../../core/antivirus';
import { ChannelSendError, getChannelSender } from '../../core/channels';
import { emitBvEvent } from '../../core/events';
import { toPlain, type Attachment } from '../../core/messages';
import { agentLoad } from '../../core/presence';
import { emitToConversation, emitToUser } from '../../core/realtime';
import { getObjectStream, newKey, parseRange, putObject, statObject } from '../../core/storage';
import { CLOSE_REASONS, CHANNELS, type Channel, type MessageKind } from '../../core/types';
import { agentLockKey, convLockKey, withLock } from '../lock';
import { emitConversationUpdated } from '../realtime';
import { accessWhere, actor, decodeCursor, encodeCursor, guardUser, isSupervisor, isUniqueViolation, notFound, qbool, serializeConversation } from './common';

const MAX_UPLOAD = 15 * 1024 * 1024;

/** Tipos permitidos em anexos do atendente (nunca HTML/SVG/executáveis). */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods',
};
const INLINE_OK = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

/** Confere assinatura (magic bytes) dos formatos que a validam; os demais confiam no tipo declarado + lista de permitidos. */
export function magicOk(mime: string, b: Buffer): boolean {
  const s = (from: number, str: string) => b.length >= from + str.length && b.toString('latin1', from, from + str.length) === str;
  switch (mime) {
    case 'image/jpeg': return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return s(1, 'PNG');
    case 'image/gif': return s(0, 'GIF8');
    case 'image/webp': return s(0, 'RIFF') && s(8, 'WEBP');
    case 'application/pdf': return s(0, '%PDF');
    default: return true;
  }
}

const kindOfMime = (mime: string) => mime.startsWith('image/') ? 'IMAGE' as const : mime.startsWith('audio/') ? 'AUDIO' as const : mime.startsWith('video/') ? 'VIDEO' as const : 'DOCUMENT' as const;
const safeName = (n: string) => path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f"<>|?*]/g, '_').trim().slice(0, 120) || 'arquivo';

const listQuery = z.object({
  mine: qbool, unassigned: qbool,
  status: z.string().optional(), queueId: z.string().max(64).optional(), channel: z.enum(CHANNELS).optional(),
  protocol: z.string().trim().max(40).optional(), contact: z.string().max(64).optional(), category: z.string().max(60).optional(),
  assignedUserId: z.string().max(64).optional(), slaBreached: qbool,
  sort: z.enum(['recent', 'priority']).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

const LIST_INCLUDE = {
  contact: { select: { id: true, name: true, category: true } },
  queue: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

/** Listagem com filtros + paginação por cursor. `scope: 'all'` (supervisão) ignora a restrição de acesso do atendente. */
export async function listConversations(a: ReturnType<typeof actor>, q: ListQuery, scope: 'inbox' | 'all') {
  const and: Prisma.BvConversationWhereInput[] = [scope === 'all' ? { orgId: a.orgId } : await accessWhere(a)];
  if (q.mine) and.push({ assignedUserId: a.userId });
  if (q.unassigned) and.push({ assignedUserId: null });
  if (q.status) and.push({ status: { in: q.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } });
  if (q.queueId) and.push({ queueId: q.queueId });
  if (q.channel) and.push({ channel: q.channel });
  if (q.protocol) and.push({ protocol: { contains: q.protocol, mode: 'insensitive' } });
  if (q.contact) and.push({ contactId: q.contact });
  if (q.category) and.push({ category: q.category });
  if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
  if (q.slaBreached !== undefined) and.push({ slaBreached: q.slaBreached });
  const cur = decodeCursor<{ t?: string; id?: string; o?: number }>(q.cursor);

  let rows: Array<BvConversation & { contact: { id: string; name: string | null; category: string }; queue: { id: string; name: string } | null; assignee: { id: string; name: string } | null }>;
  if (q.sort === 'priority') {
    rows = await prisma.bvConversation.findMany({ where: { AND: and }, orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }, { id: 'asc' }], skip: cur?.o ?? 0, take: q.limit + 1, include: LIST_INCLUDE });
  } else {
    if (cur?.t && cur.id) and.push({ OR: [{ startedAt: { lt: new Date(cur.t) } }, { startedAt: new Date(cur.t), id: { lt: cur.id } }] });
    rows = await prisma.bvConversation.findMany({ where: { AND: and }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include: LIST_INCLUDE });
  }
  const more = rows.length > q.limit;
  const page = more ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = !more || !last ? null : q.sort === 'priority' ? encodeCursor({ o: (cur?.o ?? 0) + q.limit }) : encodeCursor({ t: last.startedAt.toISOString(), id: last.id });
  const now = Date.now();
  return {
    items: page.map((c) => ({ ...serializeConversation(c, now), contact: c.contact, queue: c.queue, assignee: c.assignee })),
    nextCursor,
  };
}

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof ConversationError) return sendError(reply, err.status, err.code, err.message);
  throw err;
}

/** Carrega a conversa do órgão e confere o acesso; responde 404/403 e retorna null se negado. */
async function loadAccessible(req: Parameters<typeof actor>[0], reply: FastifyReply, id: string) {
  const a = actor(req);
  const conv = await prisma.bvConversation.findFirst({ where: { id, orgId: a.orgId } });
  if (!conv) { notFound(reply, 'Conversa'); return null; }
  if (!(await canAccessConversation(a, conv))) { sendError(reply, 403, 'conversation.forbidden', 'Sem acesso a esta conversa'); return null; }
  return conv;
}

/** Quem pode agir (responder/encerrar/transferir): o atribuído ou a supervisão. */
const mayAct = (a: ReturnType<typeof actor>, c: Pick<BvConversation, 'assignedUserId'>) => c.assignedUserId === a.userId || isSupervisor(a);

const attachmentSchema = z.strictObject({
  key: z.string().min(1).max(300), name: z.string().min(1).max(200), mime: z.string().min(1).max(120), size: z.number().int().min(0).max(MAX_UPLOAD), sha256: z.string().max(64).optional(),
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;
const detailQuery = z.object({ before: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
export const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Página do histórico, da mais nova para trás: devolve até `limit` mensagens ANTES de `before` (data ISO ou id de mensagem),
 * em ordem cronológica crescente. Desempate por id para não pular mensagens com o mesmo milissegundo.
 * Único ponto aqui que lê BvMessage: o corpo continua sendo decifrado por `toPlain` do core/messages.
 */
async function messagePage(conversationId: string, orgId: string, before: string | undefined, limit: number) {
  const where: Prisma.BvMessageWhereInput = { conversationId, orgId };
  if (before) {
    if (ISO_RE.test(before) && !Number.isNaN(Date.parse(before))) where.createdAt = { lt: new Date(before) };
    else {
      const ref = await prisma.bvMessage.findFirst({ where: { id: before, conversationId, orgId }, select: { createdAt: true, id: true } });
      if (!ref) return null;
      where.OR = [{ createdAt: { lt: ref.createdAt } }, { createdAt: ref.createdAt, id: { lt: ref.id } }];
    }
  }
  const rows = await prisma.bvMessage.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return { messages: page.map(toPlain), hasMore, nextBefore: hasMore && page.length ? page[0].id : null };
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/conversations', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const q = parse(listQuery, req.query, reply); if (!q) return;
    return listConversations(actor(req), q, 'inbox');
  });

  app.get('/conversations/:id', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const dq = parse(detailQuery, req.query, reply); if (!dq) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    const history = await messagePage(conv.id, conv.orgId, dq.before, dq.limit);
    if (!history) return sendError(reply, 400, 'messages.invalid_cursor', 'before deve ser uma data ISO ou o id de uma mensagem desta conversa');
    const { messages } = history;
    const [contact, events, queue, assignee] = await Promise.all([
      prisma.bvContact.findUnique({ where: { id: conv.contactId } }),
      prisma.bvConversationEvent.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, take: 300 }),
      conv.queueId ? prisma.bvQueue.findUnique({ where: { id: conv.queueId }, select: { id: true, name: true } }) : null,
      conv.assignedUserId ? prisma.bvUser.findUnique({ where: { id: conv.assignedUserId }, select: { id: true, name: true } }) : null,
    ]);
    await auditReq(req, 'conversation.read', { entityType: 'conversation', entityId: conv.id, meta: { protocol: conv.protocol, ...(dq.before ? { olderPage: true } : {}) } });
    const doc = contact?.documentEnc ? getContactDocument(contact.documentEnc) : null;
    return {
      conversation: { ...serializeConversation(conv), queue, assignee },
      contact: contact && {
        id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, category: contact.category, tags: contact.tags,
        document: doc ? maskDocument(doc) : null, identityVerifiedAt: contact.identityVerifiedAt,
      },
      messages: messages.map((m) => ({
        id: m.id, direction: m.direction, senderType: m.senderType, senderUserId: m.senderUserId, kind: m.kind, body: m.body,
        attachments: m.attachments, status: m.status, errorCode: m.errorCode, aiMeta: m.aiMeta, createdAt: m.createdAt,
      })),
      hasMore: history.hasMore, nextBefore: history.nextBefore,
      events: events.map((e) => ({ id: e.id, type: e.type, actorUserId: e.actorUserId, data: e.data, createdAt: e.createdAt })),
      canReply: mayAct(a, conv) && conv.status !== 'CLOSED',
    };
  });

  // ── responder / nota ────────────────────────────────────────────────────────
  const msgBody = z.strictObject({ text: z.string().max(4096).optional(), attachments: z.array(attachmentSchema).max(10).optional() })
    .refine((b) => !!b.text?.trim() || !!b.attachments?.length, { message: 'Informe text ou attachments' });
  app.post('/conversations/:id/messages', { preHandler: guardUser('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(msgBody, req.body, reply); if (!b) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    if (!mayAct(a, conv)) return sendError(reply, 403, 'conversation.not_assigned', 'Só o atendente responsável ou a supervisão pode responder');
    const atts: Attachment[] = [];
    for (const x of b.attachments ?? []) {
      if (!(await attachmentBelongs(conv, x.key))) return sendError(reply, 400, 'attachment.invalid', 'Anexo não pertence a esta conversa');
      atts.push({ key: x.key, name: x.name, mime: x.mime, size: x.size, sha256: x.sha256 });
    }
    try {
      const { message, error } = await sendMessage({
        orgId: a.orgId, conversationId: conv.id, senderType: 'AGENT', userId: a.userId, body: b.text?.trim() || null,
        kind: atts.length ? kindOfMime(atts[0].mime) : 'TEXT', attachments: atts.length ? atts : undefined,
      });
      return reply.code(201).send({ message: { ...message, channelMeta: undefined }, delivery: { status: message.status, error: error ?? null } });
    } catch (err) { return fail(reply, err); }
  });

  // ── reenvio de mensagem que falhou ───────────────────────────────────────────
  // Reaproveita a MESMA mensagem (sem nova bolha): reenvia pelo remetente do canal registrado no core e atualiza o status.
  app.post('/conversations/:id/messages/:messageId/resend', { preHandler: guardUser('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam.extend({ messageId: z.string().min(1).max(64) }), req.params, reply); if (!p) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    const row = await prisma.bvMessage.findFirst({ where: { id: p.messageId, conversationId: conv.id, orgId: a.orgId } });
    if (!row) return notFound(reply, 'Mensagem');
    if (row.direction !== 'OUT' || row.status !== 'FAILED') return sendError(reply, 409, 'message.not_resendable', 'Só mensagens enviadas ao cidadão que falharam podem ser reenviadas', { status: row.status, direction: row.direction });
    if (!mayAct(a, conv) || !(isSupervisor(a) || row.senderUserId === a.userId)) return sendError(reply, 403, 'message.not_owner', 'Só o autor da mensagem (atendente responsável) ou a supervisão pode reenviar');
    if (conv.status === 'CLOSED') return sendError(reply, 409, 'conversation.closed', 'Conversa encerrada');
    const sender = getChannelSender(conv.channel as Channel);
    const contact = await prisma.bvContact.findUniqueOrThrow({ where: { id: conv.contactId }, select: { id: true, name: true, email: true, phone: true } });
    // Reivindica a mensagem de forma atômica (FAILED → QUEUED): dois cliques/abas simultâneos não reenviam duas vezes.
    const claimed = await prisma.bvMessage.updateMany({ where: { id: row.id, status: 'FAILED' }, data: { status: 'QUEUED', errorCode: null } });
    if (claimed.count === 0) return sendError(reply, 409, 'message.not_resendable', 'Mensagem já está sendo reenviada', { status: 'QUEUED' });
    const msg = toPlain(row);
    let status: 'QUEUED' | 'SENT' | 'FAILED' = 'FAILED';
    let error: string | null = null;
    let channelMessageId: string | null = row.channelMessageId;
    let channelMeta: unknown = row.channelMeta;
    if (!sender) error = 'channel.no_sender';
    else {
      try {
        const res = await sender({
          orgId: a.orgId,
          conversation: { id: conv.id, channel: conv.channel as Channel, channelRef: conv.channelRef, protocol: conv.protocol, subject: conv.subject, lastInboundAt: conv.lastInboundAt, metadata: conv.metadata },
          contact,
          message: { id: msg.id, kind: msg.kind as MessageKind, body: msg.body, attachments: (msg.attachments as unknown as Attachment[] | null) ?? [], channelMeta: msg.channelMeta ?? null, senderType: msg.senderType },
        });
        status = res.status ?? 'SENT';
        channelMessageId = res.channelMessageId ?? channelMessageId;
        if (res.channelMeta) channelMeta = { ...((msg.channelMeta as object | null) ?? {}), ...(res.channelMeta as object) };
      } catch (err) {
        error = err instanceof ChannelSendError ? err.code : 'channel.send_failed';
        logger.warn({ err: (err as Error)?.message, conversationId: conv.id, channel: conv.channel }, '[balcao/routing] falha ao reenviar mensagem ao canal');
      }
    }
    let updated;
    try {
      updated = await prisma.bvMessage.update({ where: { id: row.id }, data: { status, errorCode: error, channelMessageId, channelMeta: (channelMeta ?? undefined) as never } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // channelMessageId repetido pelo provedor: mantém o id anterior
      updated = await prisma.bvMessage.update({ where: { id: row.id }, data: { status, errorCode: error } });
    }
    await auditReq(req, 'conversation.message.resend', { entityType: 'conversation', entityId: conv.id, meta: { messageId: row.id, previousError: row.errorCode, status: updated.status, error } });
    if (status !== 'FAILED') emitBvEvent('message.outbound', { orgId: a.orgId, conversationId: conv.id, messageId: row.id, channel: conv.channel, senderType: row.senderType });
    emitToConversation(conv.id, 'message:status', { conversationId: conv.id, messageId: row.id, status: updated.status, errorCode: updated.errorCode });
    return { message: { ...toPlain(updated), channelMeta: undefined }, delivery: { status: updated.status, error } };
  });

  app.post('/conversations/:id/notes', { preHandler: guardUser('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ text: z.string().trim().min(1).max(4096) }), req.body, reply); if (!b) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    try {
      const message = await addNote(actor(req).orgId, conv.id, actor(req).userId, b.text);
      return reply.code(201).send({ message });
    } catch (err) { return fail(reply, err); }
  });

  // ── pickup / assign / transfer / close / read ──────────────────────────────
  app.post('/conversations/:id/pickup', { preHandler: guardUser('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    const me = await prisma.bvUser.findFirst({ where: { id: a.userId, orgId: a.orgId, active: true }, select: { maxConcurrent: true } });
    if (!me) return sendError(reply, 403, 'auth.forbidden', 'Usuário inativo');
    const res = await withLock(convLockKey(conv.id), async () => {
      const fresh = await prisma.bvConversation.findFirst({ where: { id: conv.id, orgId: a.orgId } });
      if (!fresh || fresh.status === 'CLOSED') return { err: [409, 'conversation.not_assignable', 'Conversa encerrada'] as const };
      if (fresh.assignedUserId === a.userId) return { conv: fresh };
      if (fresh.assignedUserId || fresh.status !== 'WAITING') return { err: [409, 'conversation.already_assigned', 'Conversa já está em atendimento'] as const };
      return withLock(agentLockKey(a.userId), async () => {
        if (!isSupervisor(a) && (await agentLoad(a.userId)) >= me.maxConcurrent) return { err: [409, 'agent.at_capacity', 'Limite de atendimentos simultâneos atingido'] as const };
        return { conv: await assignConversation({ orgId: a.orgId, conversationId: conv.id, userId: a.userId, actorUserId: a.userId, via: 'PICKUP' }) };
      }, { waitMs: 3000 }).then((r) => (r.ok ? r.value : { err: [503, 'busy', 'Tente novamente'] as const }));
    }, { waitMs: 3000 });
    if (!res.ok) return sendError(reply, 503, 'busy', 'Conversa em processamento, tente novamente');
    if ('err' in res.value && res.value.err) return sendError(reply, res.value.err[0], res.value.err[1], res.value.err[2]);
    return { conversation: serializeConversation((res.value as { conv: BvConversation }).conv) };
  });

  app.post('/conversations/:id/assign', { preHandler: guardUser('conversation:monitor') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ userId: z.string().min(1).max(64) }), req.body, reply); if (!b) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    const res = await withLock(convLockKey(conv.id), async () => {
      try { return { conv: await assignConversation({ orgId: a.orgId, conversationId: conv.id, userId: b.userId, actorUserId: a.userId, via: 'MANUAL' }) }; } catch (err) { return { err }; }
    }, { waitMs: 3000 });
    if (!res.ok) return sendError(reply, 503, 'busy', 'Conversa em processamento, tente novamente');
    if ('err' in res.value) return fail(reply, res.value.err);
    await auditReq(req, 'conversation.assign', { entityType: 'conversation', entityId: conv.id, meta: { toUserId: b.userId } });
    return { conversation: serializeConversation(res.value.conv) };
  });

  const transferBody = z.strictObject({ toUserId: z.string().min(1).max(64).optional(), toQueueId: z.string().min(1).max(64).optional(), note: z.string().trim().max(1000).optional() })
    .refine((b) => !!b.toUserId !== !!b.toQueueId, { message: 'Informe toUserId OU toQueueId' });
  app.post('/conversations/:id/transfer', { preHandler: guardUser('conversation:transfer') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(transferBody, req.body, reply); if (!b) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    if (!mayAct(a, conv)) return sendError(reply, 403, 'conversation.not_assigned', 'Só o atendente responsável ou a supervisão pode transferir');
    if (b.toUserId && !(await prisma.bvUser.findFirst({ where: { id: b.toUserId, orgId: a.orgId, active: true }, select: { id: true } }))) return sendError(reply, 404, 'user.not_found', 'Atendente inválido ou inativo');
    if (b.toQueueId && !(await prisma.bvQueue.findFirst({ where: { id: b.toQueueId, orgId: a.orgId, active: true }, select: { id: true } }))) return sendError(reply, 404, 'queue.not_found', 'Fila não encontrada');
    try {
      const out = await transferConversation({ orgId: a.orgId, conversationId: conv.id, actorUserId: a.userId, toUserId: b.toUserId, toQueueId: b.toQueueId, note: b.note });
      if (conv.assignedUserId && conv.assignedUserId !== b.toUserId) emitToUser(conv.assignedUserId, 'conversation:closed', { id: conv.id, reason: 'TRANSFERRED' });
      return { conversation: serializeConversation(out) };
    } catch (err) { return fail(reply, err); }
  });

  app.post('/conversations/:id/close', { preHandler: guardUser('conversation:close') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ reason: z.enum(CLOSE_REASONS).default('RESOLVED') }), req.body ?? {}, reply); if (!b) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    if (!mayAct(a, conv)) return sendError(reply, 403, 'conversation.not_assigned', 'Só o atendente responsável ou a supervisão pode encerrar');
    try {
      const out = await closeConversation({ orgId: a.orgId, conversationId: conv.id, reason: b.reason, actorUserId: a.userId });
      return { conversation: serializeConversation(out) };
    } catch (err) { return fail(reply, err); }
  });

  app.post('/conversations/:id/read', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    await prisma.bvConversation.updateMany({ where: { id: conv.id, orgId: actor(req).orgId }, data: { unreadForAgent: 0 } });
    if (conv.assignedUserId) emitToUser(conv.assignedUserId, 'conversation:updated', { id: conv.id, unreadForAgent: 0 });
    emitConversationUpdated(conv.orgId, { ...conv, unreadForAgent: 0 } as BvConversation, { unreadForAgent: 0 });
    return { ok: true };
  });

  // ── anexos ─────────────────────────────────────────────────────────────────
  app.post('/conversations/:id/attachments', { preHandler: guardUser('conversation:reply') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    const a = actor(req);
    if (!mayAct(a, conv)) return sendError(reply, 403, 'conversation.not_assigned', 'Só o atendente responsável ou a supervisão pode anexar');
    if (!req.isMultipart()) return sendError(reply, 415, 'attachment.not_multipart', 'Envie multipart/form-data com o campo "file"');
    let file;
    try { file = await req.file({ limits: { fileSize: MAX_UPLOAD, files: 1 } }); } catch { return sendError(reply, 400, 'attachment.invalid', 'Upload inválido'); }
    if (!file) return sendError(reply, 400, 'attachment.missing', 'Arquivo ausente');
    const mime = (file.mimetype || '').toLowerCase().split(';')[0].trim();
    if (!MIME_EXT[mime]) { file.file.resume(); return sendError(reply, 415, 'attachment.type_not_allowed', 'Tipo de arquivo não permitido'); }
    let buf: Buffer;
    try { buf = await file.toBuffer(); } catch { return sendError(reply, 413, 'attachment.too_large', 'Arquivo acima de 15 MB'); }
    if (file.file.truncated || buf.length > MAX_UPLOAD) return sendError(reply, 413, 'attachment.too_large', 'Arquivo acima de 15 MB');
    if (buf.length === 0) return sendError(reply, 400, 'attachment.empty', 'Arquivo vazio');
    if (!magicOk(mime, buf)) return sendError(reply, 415, 'attachment.content_mismatch', 'Conteúdo não confere com o tipo informado');
    const name = safeName(file.filename);
    let stored;
    try { stored = await putObject(newKey(a.orgId, 'attachments', MIME_EXT[mime]), buf, { scan: true }); } // antivírus (ClamAV) quando configurado; o core remove o arquivo recusado
    catch (err) {
      if (!(err instanceof AttachmentRejectedError)) throw err;
      await auditReq(req, 'conversation.attachment.rejected', { entityType: 'conversation', entityId: conv.id, meta: { reason: err.reason, signature: err.signature, mime, size: buf.length } });
      return sendError(reply, 422, 'attachment.rejected', err.message, { reason: err.reason });
    }
    const descriptor = { key: stored.key, name, mime, size: stored.size, sha256: stored.sha256 };
    await addConversationEvent(a.orgId, conv.id, 'ATTACHMENT_UPLOADED', a.userId, descriptor);
    await auditReq(req, 'conversation.attachment.upload', { entityType: 'conversation', entityId: conv.id, meta: { key: stored.key, mime, size: stored.size } });
    return reply.code(201).send({ attachment: descriptor });
  });

  app.get('/conversations/:id/attachments/*', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, { id: (req.params as { id: string }).id }, reply); if (!p) return;
    const key = (req.params as Record<string, string>)['*'];
    const conv = await loadAccessible(req, reply, p.id); if (!conv) return;
    if (!key || !key.startsWith(`${conv.orgId}/`)) return notFound(reply, 'Anexo');
    const desc = await findAttachment(conv, key);
    if (!desc) return notFound(reply, 'Anexo');
    const st = await statObject(key);
    if (!st) return notFound(reply, 'Anexo');
    await auditReq(req, 'conversation.attachment.read', { entityType: 'conversation', entityId: conv.id, meta: { key } });
    const mime = MIME_EXT[desc.mime] || INLINE_OK.has(desc.mime) ? desc.mime : 'application/octet-stream';
    const inline = (req.query as { inline?: string }).inline === '1' && INLINE_OK.has(mime);
    const range = parseRange(req.headers.range, st.size);
    reply.header('Content-Type', mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store').header('Accept-Ranges', 'bytes')
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(desc.name)}`)
      .header('Content-Security-Policy', "default-src 'none'; sandbox");
    if (range) {
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`).header('Content-Length', range.end - range.start + 1);
      return reply.send(getObjectStream(key, range));
    }
    reply.header('Content-Length', st.size);
    return reply.send(getObjectStream(key));
  });
}

/** O anexo foi enviado/recebido nesta conversa? Procura em mensagens e nos uploads registrados. */
async function findAttachment(conv: BvConversation, key: string): Promise<Attachment | null> {
  const msg = await prisma.bvMessage.findFirst({ where: { conversationId: conv.id, orgId: conv.orgId, attachments: { array_contains: [{ key }] } }, select: { attachments: true } });
  const fromMsg = (msg?.attachments as unknown as Attachment[] | null)?.find((x) => x.key === key);
  if (fromMsg) return fromMsg;
  const ev = await prisma.bvConversationEvent.findFirst({ where: { conversationId: conv.id, orgId: conv.orgId, type: 'ATTACHMENT_UPLOADED', data: { path: ['key'], equals: key } }, select: { data: true } });
  return ev ? (ev.data as unknown as Attachment) : null;
}
const attachmentBelongs = async (conv: BvConversation, key: string) => !!(await findAttachment(conv, key));

