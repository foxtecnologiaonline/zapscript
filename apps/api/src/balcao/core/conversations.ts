import type { Prisma, BvConversation } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { resolveContact } from './contacts';
import { nextProtocol } from './counters';
import { ChannelSendError, getChannelSender } from './channels';
import { emitBvEvent } from './events';
import { createMessage, listMessages, setMessageStatus, toPlain, type Attachment, type PlainMessage } from './messages';
import { emitToConversation, emitToSupervisors, emitToUser } from './realtime';
import { getOrgSettings } from './settings';
import { can } from './permissions';
import type { BvAuthContext, Channel, CloseReason, MessageKind, SenderType } from './types';

/**
 * Núcleo de conversas do Balcão. Todos os canais entram por `ingestInbound`; saída por `sendMessage`.
 * Roteamento (ACD), IA, tarefas e relatórios reagem aos eventos emitidos aqui (ver events.ts).
 */

export async function addConversationEvent(orgId: string, conversationId: string, type: string, actorUserId?: string | null, data: Record<string, unknown> = {}) {
  return prisma.bvConversationEvent.create({ data: { orgId, conversationId, type, actorUserId: actorUserId ?? null, data: data as any } });
}

export interface InboundMessageInput {
  kind?: MessageKind;
  body?: string | null;
  attachments?: Attachment[];
  channelMessageId?: string | null;
  channelMeta?: unknown;
  createdAt?: Date;
}

export interface IngestInput {
  orgId: string;
  channel: Channel;
  /** Chave da conversa no canal: wa_id, id do visitante, Message-ID raiz do e-mail, id da chamada. */
  channelRef: string | null;
  /** Identidade do contato no canal (wa_id, e-mail, id do visitante, número chamador). */
  externalId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  subject?: string | null;
  category?: string | null;
  message: InboundMessageInput;
  metadata?: Record<string, unknown>;
  /** Força nova conversa mesmo havendo uma aberta (raro). */
  forceNew?: boolean;
}

export interface IngestResult {
  conversation: BvConversation;
  message: PlainMessage | null;
  contactId: string;
  isNew: boolean;
  reopened: boolean;
  duplicate: boolean;
  /** Mensagem era a resposta numérica da pesquisa de satisfação (não gera atendimento). */
  csat?: boolean;
}

const CSAT_RE = /^\s*(10|[0-9])\s*$/;

async function findOpenConversation(i: IngestInput, contactId: string) {
  return prisma.bvConversation.findFirst({
    where: { orgId: i.orgId, channel: i.channel, status: { not: 'CLOSED' }, ...(i.channelRef ? { channelRef: i.channelRef } : { contactId }) },
    orderBy: { startedAt: 'desc' },
  });
}

/** Cria a conversa (sem mensagem). Usada por canais sem "mensagem inicial" (ex.: chamada de voz). */
export async function openConversation(i: Omit<IngestInput, 'message'> & { status?: 'BOT' | 'WAITING' | 'ACTIVE'; assignedUserId?: string | null }): Promise<{ conversation: BvConversation; contactId: string }> {
  const settings = await getOrgSettings(i.orgId);
  const { contactId } = await resolveContact({ orgId: i.orgId, channel: i.channel, externalId: i.externalId, name: i.name, email: i.email, phone: i.phone });
  const protocol = await nextProtocol(i.orgId, settings.protocolPrefix);
  const botFirst = settings.ai.enabled && i.channel !== 'VOICE';
  const status = i.status ?? (botFirst ? 'BOT' : 'WAITING');
  const now = new Date();
  const conversation = await prisma.bvConversation.create({
    data: {
      orgId: i.orgId, protocol, channel: i.channel, contactId, channelRef: i.channelRef, subject: i.subject ?? null,
      category: i.category ?? null, status, language: settings.language, metadata: (i.metadata ?? {}) as any,
      queuedAt: status === 'WAITING' ? now : null, assignedUserId: i.assignedUserId ?? null, assignedAt: i.assignedUserId ? now : null,
    },
  });
  await addConversationEvent(i.orgId, conversation.id, 'CREATED', null, { channel: i.channel, status });
  emitBvEvent('conversation.created', { orgId: i.orgId, conversationId: conversation.id, channel: i.channel, status });
  emitToSupervisors(i.orgId, 'conversation:new', { id: conversation.id, protocol, channel: i.channel, status });
  if (status === 'WAITING') emitBvEvent('conversation.needs_routing', { orgId: i.orgId, conversationId: conversation.id, reason: 'NEW' });
  return { conversation, contactId };
}

/** Porta de entrada de TODA mensagem recebida do cidadão, em qualquer canal. */
export async function ingestInbound(i: IngestInput): Promise<IngestResult> {
  const cmid = i.message.channelMessageId;
  if (cmid) {
    const dup = await prisma.bvMessage.findFirst({ where: { orgId: i.orgId, channelMessageId: cmid } });
    if (dup) {
      const conversation = await prisma.bvConversation.findUniqueOrThrow({ where: { id: dup.conversationId } });
      return { conversation, message: toPlain(dup), contactId: conversation.contactId, isNew: false, reopened: false, duplicate: true };
    }
  }

  const settings = await getOrgSettings(i.orgId);
  const { contactId } = await resolveContact({ orgId: i.orgId, channel: i.channel, externalId: i.externalId, name: i.name, email: i.email, phone: i.phone });

  let conv = i.forceNew ? null : await findOpenConversation(i, contactId);
  let isNew = false;
  let reopened = false;

  if (!conv && !i.forceNew && i.channelRef) {
    const closed = await prisma.bvConversation.findFirst({
      where: { orgId: i.orgId, channel: i.channel, channelRef: i.channelRef, status: 'CLOSED', closedAt: { gte: new Date(Date.now() - settings.reopenWindowSec * 1000) } },
      orderBy: { closedAt: 'desc' },
    });
    if (closed) {
      const meta = (closed.metadata ?? {}) as Record<string, any>;
      const text = i.message.body ?? '';
      if (meta.csatPending && CSAT_RE.test(text)) {
        const done = await recordCsat(i.orgId, closed.id, Number(text.trim()));
        const { message } = await createMessage({ orgId: i.orgId, conversationId: closed.id, direction: 'IN', senderType: 'CONTACT', body: text, channelMessageId: cmid ?? undefined, channelMeta: i.message.channelMeta });
        return { conversation: done, message, contactId, isNew: false, reopened: false, duplicate: false, csat: true };
      }
      if (i.channel === 'WHATSAPP' || i.channel === 'EMAIL') {
        const humanInvolved = !!closed.assignedUserId;
        const status = humanInvolved ? 'WAITING' : (settings.ai.enabled ? 'BOT' : 'WAITING');
        conv = await prisma.bvConversation.update({
          where: { id: closed.id },
          data: { status, closedAt: null, closeReason: null, queuedAt: status === 'WAITING' ? new Date() : null, assignedUserId: null, metadata: { ...meta, csatPending: false } as any },
        });
        reopened = true;
        await addConversationEvent(i.orgId, conv.id, 'REOPENED', null, { by: 'contact' });
        if (status === 'WAITING') emitBvEvent('conversation.needs_routing', { orgId: i.orgId, conversationId: conv.id, reason: 'REOPEN' });
      }
    }
  }

  if (!conv) {
    const created = await openConversation({ ...i, message: undefined } as any);
    conv = created.conversation; isNew = true;
  }

  const { message, duplicate } = await createMessage({
    orgId: i.orgId, conversationId: conv.id, direction: 'IN', senderType: 'CONTACT', kind: i.message.kind ?? 'TEXT',
    body: i.message.body, attachments: i.message.attachments, channelMessageId: cmid, channelMeta: i.message.channelMeta, createdAt: i.message.createdAt,
  });

  const now = new Date();
  const humanQueue = conv.status === 'WAITING' || conv.status === 'ACTIVE';
  conv = await prisma.bvConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: now, lastInboundAt: now, ...(humanQueue ? { unreadForAgent: { increment: 1 } } : {}), ...(i.subject && !conv.subject ? { subject: i.subject } : {}) },
  });

  emitBvEvent('message.inbound', { orgId: i.orgId, conversationId: conv.id, messageId: message.id, channel: i.channel, status: conv.status });
  emitToConversation(conv.id, 'message:new', { conversationId: conv.id, message });
  if (conv.assignedUserId) emitToUser(conv.assignedUserId, 'message:new', { conversationId: conv.id, message });
  return { conversation: conv, message, contactId, isNew, reopened, duplicate };
}

export interface SendInput {
  orgId: string;
  conversationId: string;
  senderType: Exclude<SenderType, 'CONTACT'>;
  userId?: string | null;
  body?: string | null;
  kind?: MessageKind;
  attachments?: Attachment[];
  aiMeta?: unknown;
  channelMeta?: unknown;
  /** Não despachar ao canal (só registrar). */
  skipChannel?: boolean;
}

export class ConversationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** Envia uma mensagem ao cidadão (bot, atendente ou sistema), registrando e despachando pelo canal. */
export async function sendMessage(i: SendInput): Promise<{ message: PlainMessage; error?: string }> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: i.conversationId, orgId: i.orgId }, include: { contact: true } });
  if (!conv) throw new ConversationError('conversation.not_found', 'Conversa não encontrada', 404);
  if (conv.status === 'CLOSED' && i.senderType === 'AGENT') throw new ConversationError('conversation.closed', 'Conversa encerrada', 409);

  const { message } = await createMessage({
    orgId: i.orgId, conversationId: conv.id, direction: 'OUT', senderType: i.senderType, senderUserId: i.userId,
    kind: i.kind ?? 'TEXT', body: i.body, attachments: i.attachments, status: 'QUEUED', aiMeta: i.aiMeta, channelMeta: i.channelMeta,
  });

  const now = new Date();
  const patch: Prisma.BvConversationUpdateInput = { lastMessageAt: now };
  if (i.senderType === 'AGENT') {
    patch.unreadForAgent = 0;
    if (!conv.firstResponseAt) patch.firstResponseAt = now;
  }
  await prisma.bvConversation.update({ where: { id: conv.id }, data: patch });
  if (i.senderType === 'AGENT' && !conv.firstResponseAt) await addConversationEvent(i.orgId, conv.id, 'FIRST_RESPONSE', i.userId, { seconds: Math.round((now.getTime() - conv.startedAt.getTime()) / 1000) });

  let error: string | undefined;
  let final: PlainMessage = message;
  const sender = getChannelSender(conv.channel as Channel);
  if (i.skipChannel) {
    await setMessageStatus(message.id, 'SENT'); final = { ...message, status: 'SENT' };
  } else if (!sender) {
    error = 'channel.no_sender';
    await setMessageStatus(message.id, 'FAILED', error); final = { ...message, status: 'FAILED', errorCode: error };
  } else {
    try {
      const res = await sender({
        orgId: i.orgId,
        conversation: { id: conv.id, channel: conv.channel as Channel, channelRef: conv.channelRef, protocol: conv.protocol, subject: conv.subject, lastInboundAt: conv.lastInboundAt, metadata: conv.metadata },
        contact: { id: conv.contact.id, name: conv.contact.name, email: conv.contact.email, phone: conv.contact.phone },
        message: { id: message.id, kind: message.kind as MessageKind, body: message.body, attachments: (i.attachments ?? []), channelMeta: i.channelMeta ?? null, senderType: i.senderType },
      });
      const status = res.status ?? 'SENT';
      const row = await prisma.bvMessage.update({
        where: { id: message.id },
        data: { status, channelMessageId: res.channelMessageId ?? undefined, channelMeta: (res.channelMeta ? { ...(message.channelMeta as any ?? {}), ...(res.channelMeta as any) } : undefined) as any },
      });
      final = { ...message, status: row.status, channelMessageId: row.channelMessageId, channelMeta: row.channelMeta };
    } catch (err: any) {
      error = err instanceof ChannelSendError ? err.code : 'channel.send_failed';
      logger.warn({ err: err?.message, conversationId: conv.id, channel: conv.channel }, '[balcao] falha ao enviar mensagem ao canal');
      await setMessageStatus(message.id, 'FAILED', error); final = { ...message, status: 'FAILED', errorCode: error };
    }
  }

  emitBvEvent('message.outbound', { orgId: i.orgId, conversationId: conv.id, messageId: message.id, channel: conv.channel, senderType: i.senderType });
  emitToConversation(conv.id, 'message:new', { conversationId: conv.id, message: final });
  return { message: final, error };
}

/** Nota interna (nunca vai ao cidadão). */
export async function addNote(orgId: string, conversationId: string, userId: string, body: string): Promise<PlainMessage> {
  const exists = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId }, select: { id: true } });
  if (!exists) throw new ConversationError('conversation.not_found', 'Conversa não encontrada', 404);
  const { message } = await createMessage({ orgId, conversationId, direction: 'INTERNAL', senderType: 'AGENT', senderUserId: userId, kind: 'NOTE', body });
  emitToConversation(conversationId, 'message:new', { conversationId, message });
  return message;
}

/** Bot → humano: a conversa entra na fila de roteamento. */
export async function escalateToHuman(orgId: string, conversationId: string, opts: { reason?: string; category?: string | null; intent?: string | null } = {}): Promise<BvConversation | null> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId } });
  if (!conv || conv.status === 'CLOSED') return null;
  if (conv.status === 'WAITING' || conv.status === 'ACTIVE') return conv;
  const updated = await prisma.bvConversation.update({
    where: { id: conv.id },
    data: { status: 'WAITING', queuedAt: new Date(), botHandled: true, ...(opts.category ? { category: opts.category } : {}), ...(opts.intent ? { intent: opts.intent } : {}) },
  });
  await addConversationEvent(orgId, conv.id, 'ESCALATED', null, { reason: opts.reason ?? 'bot' });
  emitToSupervisors(orgId, 'conversation:updated', { id: conv.id, status: 'WAITING' });
  emitBvEvent('conversation.needs_routing', { orgId, conversationId: conv.id, reason: 'ESCALATED' });
  return updated;
}

export async function assignConversation(i: { orgId: string; conversationId: string; userId: string; actorUserId?: string | null; via?: 'AUTO' | 'MANUAL' | 'TRANSFER' | 'PICKUP' }): Promise<BvConversation> {
  const user = await prisma.bvUser.findFirst({ where: { id: i.userId, orgId: i.orgId, active: true }, select: { id: true } });
  if (!user) throw new ConversationError('user.not_found', 'Atendente inválido ou inativo', 404);
  const res = await prisma.bvConversation.updateMany({
    where: { id: i.conversationId, orgId: i.orgId, status: { in: ['BOT', 'WAITING', 'ACTIVE'] } },
    data: { status: 'ACTIVE', assignedUserId: i.userId, assignedAt: new Date() },
  });
  if (res.count === 0) throw new ConversationError('conversation.not_assignable', 'Conversa inexistente ou encerrada', 409);
  const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: i.conversationId } });
  await addConversationEvent(i.orgId, conv.id, 'ASSIGNED', i.actorUserId, { userId: i.userId, via: i.via ?? 'MANUAL' });
  emitBvEvent('conversation.assigned', { orgId: i.orgId, conversationId: conv.id, userId: i.userId });
  emitToUser(i.userId, 'conversation:assigned', { id: conv.id, protocol: conv.protocol, channel: conv.channel });
  emitToSupervisors(i.orgId, 'conversation:updated', { id: conv.id, status: 'ACTIVE', assignedUserId: i.userId });
  return conv;
}

/** Transferência para outro atendente OU outra fila. */
export async function transferConversation(i: { orgId: string; conversationId: string; actorUserId?: string | null; toUserId?: string; toQueueId?: string; note?: string }): Promise<BvConversation> {
  if (!i.toUserId === !i.toQueueId) throw new ConversationError('transfer.invalid', 'Informe toUserId OU toQueueId');
  const conv = await prisma.bvConversation.findFirst({ where: { id: i.conversationId, orgId: i.orgId } });
  if (!conv || conv.status === 'CLOSED') throw new ConversationError('conversation.not_assignable', 'Conversa inexistente ou encerrada', 409);
  if (i.note && i.actorUserId) await addNote(i.orgId, conv.id, i.actorUserId, `Transferência: ${i.note}`);
  await prisma.bvConversation.update({ where: { id: conv.id }, data: { transferCount: { increment: 1 } } });
  if (i.toUserId) {
    const out = await assignConversation({ orgId: i.orgId, conversationId: conv.id, userId: i.toUserId, actorUserId: i.actorUserId, via: 'TRANSFER' });
    await addConversationEvent(i.orgId, conv.id, 'TRANSFERRED', i.actorUserId, { toUserId: i.toUserId, fromUserId: conv.assignedUserId });
    return out;
  }
  const queue = await prisma.bvQueue.findFirst({ where: { id: i.toQueueId, orgId: i.orgId, active: true }, select: { id: true } });
  if (!queue) throw new ConversationError('queue.not_found', 'Fila não encontrada', 404);
  const out = await prisma.bvConversation.update({ where: { id: conv.id }, data: { queueId: queue.id, assignedUserId: null, assignedAt: null, status: 'WAITING', queuedAt: new Date() } });
  await addConversationEvent(i.orgId, conv.id, 'TRANSFERRED', i.actorUserId, { toQueueId: queue.id, fromUserId: conv.assignedUserId });
  emitToSupervisors(i.orgId, 'conversation:updated', { id: conv.id, status: 'WAITING', queueId: queue.id });
  emitBvEvent('conversation.needs_routing', { orgId: i.orgId, conversationId: conv.id, reason: 'TRANSFER' });
  return out;
}

export async function closeConversation(i: { orgId: string; conversationId: string; reason: CloseReason; actorUserId?: string | null; resolvedByBot?: boolean; requestCsat?: boolean }): Promise<BvConversation> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: i.conversationId, orgId: i.orgId } });
  if (!conv) throw new ConversationError('conversation.not_found', 'Conversa não encontrada', 404);
  if (conv.status === 'CLOSED') return conv;
  const now = new Date();
  const earlier = await prisma.bvConversation.count({ where: { orgId: i.orgId, contactId: conv.contactId, id: { not: conv.id }, status: 'CLOSED', closedAt: { gte: new Date(now.getTime() - 7 * 86400_000) }, ...(conv.category ? { category: conv.category } : {}) } });
  const out = await prisma.bvConversation.update({
    where: { id: conv.id },
    data: {
      status: 'CLOSED', closedAt: now, closeReason: i.reason, resolvedByBot: i.resolvedByBot ?? (conv.botHandled && !conv.assignedUserId && i.reason === 'RESOLVED'),
      firstContactResolved: i.reason === 'RESOLVED' ? earlier === 0 && conv.transferCount === 0 : false,
    },
  });
  await addConversationEvent(i.orgId, conv.id, 'CLOSED', i.actorUserId, { reason: i.reason });
  emitBvEvent('conversation.closed', { orgId: i.orgId, conversationId: conv.id, channel: conv.channel, reason: i.reason });
  emitToSupervisors(i.orgId, 'conversation:closed', { id: conv.id });
  if (conv.assignedUserId) { emitToUser(conv.assignedUserId, 'conversation:closed', { id: conv.id }); emitBvEvent('agent.available', { orgId: i.orgId, userId: conv.assignedUserId }); }
  if (i.requestCsat !== false && i.reason === 'RESOLVED') await requestCsat(i.orgId, conv.id).catch((err) => logger.warn({ err: err?.message }, '[balcao] requestCsat falhou'));
  return out;
}

/** Envia a pergunta de NPS (0–10) e arma a captura da resposta numérica (WhatsApp/e-mail). Webchat usa recordCsat direto. */
export async function requestCsat(orgId: string, conversationId: string): Promise<void> {
  const settings = await getOrgSettings(orgId);
  const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId } });
  if (!settings.csat.enabled || !conv || conv.csatScore != null || conv.channel === 'VOICE') return;
  await prisma.bvConversation.update({ where: { id: conv.id }, data: { metadata: { ...(conv.metadata as any ?? {}), csatPending: true } as any } });
  if (conv.channel === 'WEBCHAT') { emitToConversation(conv.id, 'csat:request', { conversationId: conv.id, prompt: settings.csat.prompt }); return; }
  await sendMessage({ orgId, conversationId: conv.id, senderType: 'SYSTEM', body: settings.csat.prompt }).catch(() => undefined);
}

export async function recordCsat(orgId: string, conversationId: string, score: number, comment?: string | null): Promise<BvConversation> {
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new ConversationError('csat.invalid', 'Nota deve ser inteiro de 0 a 10');
  const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId } });
  if (!conv) throw new ConversationError('conversation.not_found', 'Conversa não encontrada', 404);
  const out = await prisma.bvConversation.update({
    where: { id: conv.id },
    data: { csatScore: score, csatComment: comment ?? null, csatAt: new Date(), metadata: { ...(conv.metadata as any ?? {}), csatPending: false } as any },
  });
  await addConversationEvent(orgId, conv.id, 'CSAT', null, { score });
  emitBvEvent('conversation.csat', { orgId, conversationId: conv.id, score });
  return out;
}

// ── Controle de acesso ───────────────────────────────────────────────────────
export async function memberQueueIds(userId: string): Promise<string[]> {
  return (await prisma.bvQueueMember.findMany({ where: { userId }, select: { queueId: true } })).map((m) => m.queueId);
}

/** ATENDENTE vê: as suas, e as não atribuídas (BOT/WAITING) das filas de que é membro (ou sem fila). Supervisor/Admin: todas. */
export async function canAccessConversation(actor: BvAuthContext, conv: Pick<BvConversation, 'orgId' | 'assignedUserId' | 'queueId' | 'status'>): Promise<boolean> {
  if (conv.orgId !== actor.orgId) return false;
  if (can(actor.role, 'conversation:read_all')) return true;
  if (!can(actor.role, 'conversation:read')) return false;
  if (conv.assignedUserId === actor.userId) return true;
  if (conv.assignedUserId === null && conv.status !== 'CLOSED') {
    if (!conv.queueId) return true;
    return (await memberQueueIds(actor.userId)).includes(conv.queueId);
  }
  return false;
}

export { listMessages };
