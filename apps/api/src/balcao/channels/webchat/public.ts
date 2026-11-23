import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BvConversation, BvWebchatSession } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { sendError, parse } from '../../core/http';
import { randomToken } from '../../core/crypto';
import { getHolidays, getOrgSettings, isWithinBusinessHours, type BvOrgSettings } from '../../core/settings';
import { resolveContact, mergeContacts } from '../../core/contacts';
import {
  ConversationError, closeConversation, escalateToHuman, ingestInbound, openConversation, recordCsat, sendMessage,
} from '../../core/conversations';
import { createMessage, toPlain } from '../../core/messages';
import { emitToConversation } from '../../core/realtime';
import { assertQuota, QuotaExceededError, recordUsage } from '../../core/usage';
import { getObjectStream, newKey, putObject, statObject } from '../../core/storage';
import {
  ATTACHMENT_TYPES, DEFAULT_AI_NOTICE, DEFAULT_PRIVACY_NOTICE, WIDGET_VERSION, env, loadOrgBySlug, originAllowed, safeColor, sniffMime, webchatSettings,
} from './config';
import { rateHit } from './ratelimit';
import {
  createSession, findSessionByToken, setSessionConversation, touchSession, withSessionLock,
} from './sessions';
import { disconnectVisitor, joinVisitorConversation } from './socket';
import { cleanFileName, cleanLine, cleanText, toVisitorView, toVisitorViews } from './view';

/** API pública do visitante — tudo sob /public (CORS aberto no index.ts; a restrição real é a lista de origens do órgão). */

interface VisitorCtx { session: BvWebchatSession; orgId: string; settings: BvOrgSettings }
declare module 'fastify' {
  interface FastifyRequest { visitor?: VisitorCtx }
}

const tooMany = (reply: FastifyReply, retryAfter: number) => {
  reply.header('Retry-After', String(retryAfter));
  return sendError(reply, 429, 'webchat.rate_limited', 'Muitas requisições. Aguarde um instante e tente novamente.');
};

/** Limite por IP (todas as rotas públicas). Retorna false se já respondeu 429. */
async function ipGate(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const r = await rateHit('ip', req.ip, env.rl.ip());
  if (!r.ok) { tooMany(reply, r.retryAfter); return false; }
  return true;
}

async function sessionGate(req: FastifyRequest, reply: FastifyReply, bucket: string, max: number): Promise<boolean> {
  const r = await rateHit(bucket, req.visitor!.session.id, max);
  if (!r.ok) { tooMany(reply, r.retryAfter); return false; }
  return true;
}

/** preHandler: IP + token do visitante + Origin. Resposta de token inválido é sempre a mesma (sem enumeração). */
async function visitorAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!(await ipGate(req, reply))) return reply;
  const raw = req.headers['x-visitor-token'];
  const session = await findSessionByToken(typeof raw === 'string' ? raw : undefined);
  if (!session) return sendError(reply, 401, 'webchat.session_invalid', 'Sessão inválida ou expirada. Inicie um novo atendimento.');
  const settings = await getOrgSettings(session.orgId);
  if (!originAllowed(req, settings)) return sendError(reply, 403, 'webchat.origin_not_allowed', 'Origem não autorizada para este atendimento.');
  await touchSession(session);
  req.visitor = { session, orgId: session.orgId, settings };
}

function handleError(reply: FastifyReply, err: any) {
  if (err instanceof ConversationError) return sendError(reply, err.status, err.code, err.message);
  if (err instanceof QuotaExceededError) return sendError(reply, 429, 'webchat.quota_exceeded', 'Atendimento temporariamente indisponível. Tente novamente mais tarde.');
  if (err?.code === 'FST_REQ_FILE_TOO_LARGE' || err?.code === 'FST_FILES_LIMIT') return sendError(reply, 413, 'webchat.attachment_too_large', `O arquivo excede o limite de ${Math.round(env.maxAttachmentBytes() / 1048576)} MB.`);
  logger.error({ err: err?.message }, '[webchat] erro inesperado');
  return sendError(reply, 500, 'webchat.internal', 'Não foi possível concluir a operação. Tente novamente.');
}

// ── Auxiliares de conversa ───────────────────────────────────────────────────
async function currentConversation(ctx: VisitorCtx): Promise<BvConversation | null> {
  if (!ctx.session.conversationId) return null;
  return prisma.bvConversation.findFirst({ where: { id: ctx.session.conversationId, orgId: ctx.orgId } });
}

/** Identidade usada na ingestão: e-mail (casa entre canais) ou o id da sessão (anônimo). */
async function identity(ctx: VisitorCtx): Promise<{ externalId: string; email: string | null; name: string | null }> {
  if (ctx.session.contactId) {
    const c = await prisma.bvContact.findFirst({ where: { id: ctx.session.contactId, orgId: ctx.orgId }, select: { email: true, name: true } });
    if (c) return { externalId: c.email ?? ctx.session.id, email: c.email, name: c.name };
  }
  return { externalId: ctx.session.id, email: null, name: null };
}

const originMeta = (ctx: VisitorCtx) => ({ webchat: { origin: ctx.session.origin ?? null } });

async function linkConversation(ctx: VisitorCtx, conversationId: string, contactId?: string | null) {
  const previous = ctx.session.conversationId;
  if (previous !== conversationId) {
    await setSessionConversation(ctx.session, conversationId, contactId);
    joinVisitorConversation(ctx.session.id, conversationId, previous);
  }
}

/** Garante uma conversa aberta para a sessão (usada por "falar com humano" e vídeo antes de haver mensagem). */
async function ensureConversation(ctx: VisitorCtx, note: string): Promise<BvConversation> {
  return withSessionLock(ctx.session.id, async () => {
    const cur = await currentConversation(ctx);
    if (cur && cur.status !== 'CLOSED') return cur;
    const id = await identity(ctx);
    const { conversation, contactId } = await openConversation({
      orgId: ctx.orgId, channel: 'WEBCHAT', channelRef: ctx.session.id, externalId: id.externalId, name: id.name, email: id.email, metadata: originMeta(ctx),
    });
    await createMessage({ orgId: ctx.orgId, conversationId: conversation.id, direction: 'IN', senderType: 'CONTACT', kind: 'EVENT', body: note });
    await linkConversation(ctx, conversation.id, contactId);
    return conversation;
  });
}

const STATUS: Record<string, string> = { BOT: 'bot', WAITING: 'waiting', ACTIVE: 'active', CLOSED: 'closed' };

async function visitorState(ctx: VisitorCtx, conv?: BvConversation | null) {
  const c = conv === undefined ? await currentConversation(ctx) : conv;
  if (!c) return { conversationId: null, protocol: null, status: 'none', csat: { requested: false, done: false } };
  const closed = c.status === 'CLOSED';
  return {
    conversationId: c.id,
    protocol: c.protocol,
    status: STATUS[c.status] ?? 'bot',
    csat: {
      requested: closed && c.closeReason === 'RESOLVED' && c.csatScore == null && ctx.settings.csat.enabled,
      done: c.csatScore != null,
      prompt: ctx.settings.csat.prompt,
    },
  };
}

const outboundWhere = (conversationId: string, orgId: string) => ({ conversationId, orgId, direction: 'OUT', kind: { notIn: ['NOTE', 'EVENT'] } });

// ── Esquemas ─────────────────────────────────────────────────────────────────
const slugRe = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const sessionBody = z.object({
  org: z.string().regex(slugRe),
  name: z.string().max(200).optional(),
  email: z.string().trim().max(160).email().optional().or(z.literal('').transform(() => undefined)),
});
const messageBody = z.object({ text: z.string().min(1).max(30000), clientMsgId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional() });
const csatBody = z.object({ score: z.number().int().min(0).max(10), comment: z.string().max(2000).optional() });
const endBody = z.object({ resolved: z.boolean().default(true), leave: z.boolean().default(false) });
const identifyBody = z.object({ name: z.string().max(200).optional(), email: z.string().trim().max(160).email() });
const sinceQuery = z.object({ since: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export function registerPublicRoutes(app: FastifyInstance): void {
  // ── Configuração pública do widget ─────────────────────────────────────────
  app.get('/public/config', async (req, reply) => {
    if (!(await ipGate(req, reply))) return reply;
    const q = parse(z.object({ org: z.string().regex(slugRe) }), req.query, reply);
    if (!q) return reply;
    const org = await loadOrgBySlug(q.org);
    if (!org) return sendError(reply, 404, 'webchat.org_not_found', 'Atendimento não encontrado.');
    const settings = await getOrgSettings(org.id);
    if (!originAllowed(req, settings)) return sendError(reply, 403, 'webchat.origin_not_allowed', 'Origem não autorizada para este atendimento.');
    const w = webchatSettings(settings);
    const open = isWithinBusinessHours(settings, new Date(), await getHolidays(org.id));
    reply.header('Cache-Control', 'private, max-age=30').header('Vary', 'Origin');
    // Apenas dados de apresentação: nada de ids, filas, e-mails de equipe ou configuração interna.
    return {
      org: org.slug,
      title: cleanLine(String(w.title ?? 'Atendimento'), 80),
      color: safeColor(w.primaryColor),
      position: w.position === 'left' ? 'left' : 'right',
      lang: settings.language,
      welcome: cleanText(String(w.welcomeMessage ?? (settings.ai.enabled ? settings.ai.welcomeMessage : 'Olá! Como podemos ajudar?'))).slice(0, 500),
      privacyNotice: cleanText(String(w.privacyNotice ?? DEFAULT_PRIVACY_NOTICE)).slice(0, 600),
      aiNotice: settings.ai.enabled ? cleanText(String(w.aiNotice ?? DEFAULT_AI_NOTICE)).slice(0, 600) : null,
      offlineMessage: cleanText(String(w.offlineMessage ?? '')).slice(0, 500),
      open,
      features: { human: w.humanButtonEnabled !== false, video: w.videoEnabled !== false, attachments: w.attachmentsEnabled !== false, csat: settings.csat.enabled },
      attachments: { maxBytes: env.maxAttachmentBytes(), types: Object.keys(ATTACHMENT_TYPES) },
      maxMessageChars: env.maxMessageChars(),
      version: WIDGET_VERSION,
    };
  });

  // ── Sessão ─────────────────────────────────────────────────────────────────
  app.post('/public/session', async (req, reply) => {
    if (!(await ipGate(req, reply))) return reply;
    const body = parse(sessionBody, req.body ?? {}, reply);
    if (!body) return reply;
    const rl = await rateHit('sess', req.ip, env.rl.sessionsPerIp());
    if (!rl.ok) return tooMany(reply, rl.retryAfter);
    const org = await loadOrgBySlug(body.org);
    if (!org) return sendError(reply, 404, 'webchat.org_not_found', 'Atendimento não encontrado.');
    const settings = await getOrgSettings(org.id);
    if (!originAllowed(req, settings)) return sendError(reply, 403, 'webchat.origin_not_allowed', 'Origem não autorizada para este atendimento.');
    try {
      const name = body.name ? cleanLine(body.name) || null : null;
      const email = body.email ? body.email.toLowerCase() : null;
      let contactId: string | null = null;
      if (email) contactId = (await resolveContact({ orgId: org.id, channel: 'WEBCHAT', externalId: email, name, email })).contactId;
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
      const { token, session } = await createSession({ orgId: org.id, contactId, origin, ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });
      if (name && !contactId) {
        // anônimo com nome: guardamos o contato para reaproveitar o nome nas mensagens
        const c = await resolveContact({ orgId: org.id, channel: 'WEBCHAT', externalId: session.id, name });
        await prisma.bvWebchatSession.update({ where: { id: session.id }, data: { contactId: c.contactId } });
      }
      return reply.code(201).send({ token, conversationId: null, expiresInSec: env.sessionTtlSec() });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Identificação posterior (anônimo → identificado) ──────────────────────
  app.post('/public/identify', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'action', env.rl.action()))) return reply;
    const body = parse(identifyBody, req.body ?? {}, reply);
    if (!body) return reply;
    try {
      const email = body.email.toLowerCase();
      const name = body.name ? cleanLine(body.name) || null : null;
      const { contactId } = await resolveContact({ orgId: ctx.orgId, channel: 'WEBCHAT', externalId: email, name, email });
      const conv = await currentConversation(ctx);
      // Une o contato anônimo (da conversa em andamento) ao identificado — histórico unificado entre canais.
      if (conv && conv.contactId !== contactId) await mergeContacts(ctx.orgId, contactId, conv.contactId);
      await prisma.bvWebchatSession.update({ where: { id: ctx.session.id }, data: { contactId } });
      ctx.session.contactId = contactId;
      return { ok: true };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Mensagens ──────────────────────────────────────────────────────────────
  app.post('/public/messages', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'msg', env.rl.msg()))) return reply;
    const body = parse(messageBody, req.body ?? {}, reply);
    if (!body) return reply;
    const text = cleanText(body.text);
    if (!text) return sendError(reply, 400, 'webchat.empty_message', 'Digite uma mensagem.');
    if (text.length > env.maxMessageChars()) return sendError(reply, 413, 'webchat.message_too_long', `A mensagem excede ${env.maxMessageChars()} caracteres.`);
    try {
      await assertQuota(ctx.orgId, 'WEBCHAT_MSG');
      const result = await withSessionLock(ctx.session.id, async () => {
        const id = await identity(ctx);
        const r = await ingestInbound({
          orgId: ctx.orgId, channel: 'WEBCHAT', channelRef: ctx.session.id, externalId: id.externalId, name: id.name, email: id.email,
          message: { kind: 'TEXT', body: text, channelMessageId: body.clientMsgId ? `wc:${ctx.session.id}:${body.clientMsgId}` : null },
          metadata: originMeta(ctx),
        });
        await linkConversation(ctx, r.conversation.id, r.contactId);
        return r;
      });
      if (!result.duplicate) void recordUsage(ctx.orgId, 'WEBCHAT_MSG');
      return reply.code(201).send({
        message: result.message ? toVisitorView(result.message) : null,
        state: await visitorState(ctx, result.conversation),
        duplicate: result.duplicate, csat: !!result.csat,
      });
    } catch (err) { return handleError(reply, err); }
  });

  /** Polling: só mensagens destinadas ao visitante (OUT; nunca notas internas). `since` é inclusivo — o cliente deduplica por id. */
  app.get('/public/messages', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'poll', env.rl.poll()))) return reply;
    const q = parse(sinceQuery, req.query, reply);
    if (!q) return reply;
    reply.header('Cache-Control', 'no-store');
    const conv = await currentConversation(ctx);
    if (!conv) return { messages: [], state: await visitorState(ctx, null), serverTime: new Date().toISOString() };
    const rows = await prisma.bvMessage.findMany({
      where: { ...outboundWhere(conv.id, ctx.orgId), ...(q.since ? { createdAt: { gte: new Date(q.since) } } : {}) },
      orderBy: { createdAt: q.since ? 'asc' : 'desc' }, take: q.limit,
    });
    const list = q.since ? rows : rows.reverse();
    return { messages: toVisitorViews(list.map(toPlain)), state: await visitorState(ctx, conv), serverTime: new Date().toISOString() };
  });

  /** Retomada após recarregar a página: últimas mensagens da conversa (visitante + atendimento), sem notas internas. */
  app.get('/public/history', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'poll', env.rl.poll()))) return reply;
    reply.header('Cache-Control', 'no-store');
    const conv = await currentConversation(ctx);
    if (!conv) return { messages: [], state: await visitorState(ctx, null), serverTime: new Date().toISOString() };
    const rows = await prisma.bvMessage.findMany({
      where: { conversationId: conv.id, orgId: ctx.orgId, direction: { in: ['IN', 'OUT'] }, kind: { notIn: ['NOTE', 'EVENT'] } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return { messages: toVisitorViews(rows.reverse().map(toPlain)), state: await visitorState(ctx, conv), serverTime: new Date().toISOString() };
  });

  // ── Anexos ─────────────────────────────────────────────────────────────────
  app.post('/public/attachments', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'attach', env.rl.attach()))) return reply;
    if (webchatSettings(ctx.settings).attachmentsEnabled === false) return sendError(reply, 403, 'webchat.attachments_disabled', 'O envio de arquivos está desativado neste atendimento.');
    if (!req.isMultipart()) return sendError(reply, 415, 'webchat.attachment_type', 'Envie o arquivo como multipart/form-data.');
    try {
      const part = await req.file({ limits: { fileSize: env.maxAttachmentBytes(), files: 1 } });
      if (!part) return sendError(reply, 400, 'webchat.attachment_missing', 'Nenhum arquivo enviado.');
      const declared = String(part.mimetype || '').toLowerCase();
      const caption = cleanText(String((part.fields as any)?.text?.value ?? '')).slice(0, 500);
      const buf = await part.toBuffer();
      if (part.file.truncated) return sendError(reply, 413, 'webchat.attachment_too_large', `O arquivo excede o limite de ${Math.round(env.maxAttachmentBytes() / 1048576)} MB.`);
      if (buf.length === 0) return sendError(reply, 400, 'webchat.attachment_empty', 'O arquivo está vazio.');
      const real = sniffMime(buf);
      if (!real || !ATTACHMENT_TYPES[real] || !ATTACHMENT_TYPES[declared] || declared !== real) {
        return sendError(reply, 415, 'webchat.attachment_type', 'Tipo de arquivo não permitido. Envie imagem (PNG, JPG, WEBP, GIF) ou PDF.');
      }
      await assertQuota(ctx.orgId, 'WEBCHAT_MSG');
      const spec = ATTACHMENT_TYPES[real];
      const stored = await putObject(newKey(ctx.orgId, 'attachments', spec.ext), buf);
      const attachment = { key: stored.key, name: cleanFileName(part.filename || `arquivo.${spec.ext}`), mime: real, size: stored.size, sha256: stored.sha256 };
      const result = await withSessionLock(ctx.session.id, async () => {
        const id = await identity(ctx);
        const r = await ingestInbound({
          orgId: ctx.orgId, channel: 'WEBCHAT', channelRef: ctx.session.id, externalId: id.externalId, name: id.name, email: id.email,
          message: { kind: spec.kind, body: caption || null, attachments: [attachment] }, metadata: originMeta(ctx),
        });
        await linkConversation(ctx, r.conversation.id, r.contactId);
        return r;
      });
      void recordUsage(ctx.orgId, 'WEBCHAT_MSG');
      return reply.code(201).send({ message: result.message ? toVisitorView(result.message) : null, state: await visitorState(ctx, result.conversation) });
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/public/attachments/:messageId/:index', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'poll', env.rl.poll()))) return reply;
    const p = parse(z.object({ messageId: z.string().min(1).max(64), index: z.coerce.number().int().min(0).max(20) }), req.params, reply);
    if (!p) return reply;
    const notFound = () => sendError(reply, 404, 'webchat.not_found', 'Arquivo não encontrado.');
    if (!ctx.session.conversationId) return notFound();
    // Só mensagens da conversa da PRÓPRIA sessão, do mesmo órgão e nunca internas.
    const row = await prisma.bvMessage.findFirst({
      where: { id: p.messageId, orgId: ctx.orgId, conversationId: ctx.session.conversationId, direction: { in: ['IN', 'OUT'] }, kind: { notIn: ['NOTE', 'EVENT'] } },
      select: { attachments: true },
    });
    const att = Array.isArray(row?.attachments) ? (row!.attachments as any[])[p.index] : null;
    if (!att || typeof att.key !== 'string' || !att.key.startsWith(`${ctx.orgId}/`)) return notFound();
    if (!(await statObject(att.key))) return notFound();
    const safeMime = ATTACHMENT_TYPES[String(att.mime)] ? String(att.mime) : 'application/octet-stream';
    const isImage = safeMime.startsWith('image/');
    const filename = cleanFileName(String(att.name ?? 'arquivo'));
    reply
      .header('Content-Type', safeMime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-site')
      .header('Content-Disposition', `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return reply.send(getObjectStream(att.key));
  });

  // ── Digitando ──────────────────────────────────────────────────────────────
  app.post('/public/typing', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'typing', env.rl.typing()))) return reply;
    if (ctx.session.conversationId) emitToConversation(ctx.session.conversationId, 'typing', { conversationId: ctx.session.conversationId, from: 'CONTACT' });
    return reply.code(204).send();
  });

  // ── Falar com atendente humano ─────────────────────────────────────────────
  app.post('/public/human', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'action', env.rl.action()))) return reply;
    if (webchatSettings(ctx.settings).humanButtonEnabled === false) return sendError(reply, 403, 'webchat.human_disabled', 'Este atendimento não oferece transferência para atendente.');
    try {
      const conv = await ensureConversation(ctx, 'Visitante solicitou atendimento humano.');
      const out = await escalateToHuman(ctx.orgId, conv.id, { reason: 'visitor_request' });
      if (!out) return sendError(reply, 409, 'webchat.conversation_closed', 'O atendimento já foi encerrado. Inicie um novo.');
      return { state: await visitorState(ctx, out) };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Vídeo (Jitsi) ──────────────────────────────────────────────────────────
  app.post('/public/video', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'action', env.rl.action()))) return reply;
    if (webchatSettings(ctx.settings).videoEnabled === false) return sendError(reply, 403, 'webchat.video_disabled', 'O atendimento por vídeo não está disponível.');
    try {
      const conv = await ensureConversation(ctx, 'Visitante solicitou atendimento por vídeo.');
      const live = await escalateToHuman(ctx.orgId, conv.id, { reason: 'video_request' }) ?? conv;
      const room = `bv-${live.protocol.replace(/[^A-Za-z0-9-]/g, '-')}-${randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase()}`;
      const url = `${env.jitsiBase()}/${room}`;
      await sendMessage({
        orgId: ctx.orgId, conversationId: live.id, senderType: 'SYSTEM',
        body: `Atendimento por vídeo: entre na sala ${url} (a mesma sala foi enviada ao atendente).`, channelMeta: { videoRoom: url },
      });
      return reply.code(201).send({ url, room, state: await visitorState(ctx, live) });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Avaliação (NPS 0–10) ───────────────────────────────────────────────────
  app.post('/public/csat', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'action', env.rl.action()))) return reply;
    const body = parse(csatBody, req.body ?? {}, reply);
    if (!body) return reply;
    try {
      const conv = await currentConversation(ctx);
      if (!conv || conv.status !== 'CLOSED') return sendError(reply, 409, 'webchat.csat_not_available', 'A avaliação só fica disponível após o encerramento do atendimento.');
      if (conv.csatScore != null) return sendError(reply, 409, 'webchat.csat_already', 'Este atendimento já foi avaliado.');
      await recordCsat(ctx.orgId, conv.id, body.score, body.comment ? cleanText(body.comment).slice(0, 500) || null : null);
      return { ok: true };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Encerrar ───────────────────────────────────────────────────────────────
  app.post('/public/end', { preHandler: visitorAuth }, async (req, reply) => {
    const ctx = req.visitor!;
    if (!(await sessionGate(req, reply, 'action', env.rl.action()))) return reply;
    const body = parse(endBody, req.body ?? {}, reply);
    if (!body) return reply;
    try {
      let conv = await currentConversation(ctx);
      if (conv && conv.status !== 'CLOSED') conv = await closeConversation({ orgId: ctx.orgId, conversationId: conv.id, reason: body.resolved ? 'RESOLVED' : 'ABANDONED' });
      const state = await visitorState(ctx, conv);
      if (body.leave) {
        await prisma.bvWebchatSession.update({ where: { id: ctx.session.id }, data: { endedAt: new Date() } });
        disconnectVisitor(ctx.session.id);
      }
      return { state, ended: body.leave };
    } catch (err) { return handleError(reply, err); }
  });
}
