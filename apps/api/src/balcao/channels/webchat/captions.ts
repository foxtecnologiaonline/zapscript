import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { bvAuth, idParam, parse, requirePerm, sendError } from '../../core/http';
import { can } from '../../core/permissions';
import { emitToConversation } from '../../core/realtime';
import { env, MAX_CAPTION_CHARS } from './config';
import { rateHit } from './ratelimit';
import { emitToVisitors, visitorOnline } from './socket';
import { cleanText } from './view';

/**
 * Legendas em tempo real (videochamada / chat de vídeo): RELÉ EFÊMERO entre visitante e atendente.
 * O texto passa só pela memória do processo e é entregue por Socket.IO — NÃO é gravado em banco, log, auditoria nem uso
 * (diferente das mensagens do chat). Quem não estiver conectado no momento simplesmente não recebe aquele trecho.
 *
 *   visitante → atendente   POST /public/caption {text, final}  → evento `caption` na sala da conversa do namespace /bv
 *   atendente → visitante   POST /conversations/:id/caption     → evento `caption` no namespace /bv-visitor
 * Payload do evento (igual nos dois sentidos): { conversationId, from: 'VISITOR'|'AGENT', text, final }
 * `final=false`: trecho parcial (substitui o parcial anterior do mesmo falante); `final=true`: frase concluída.
 */
export const captionBody = z.object({ text: z.string().min(1).max(MAX_CAPTION_CHARS * 2), final: z.boolean().default(false) });

export interface CaptionEvent { conversationId: string; from: 'VISITOR' | 'AGENT'; text: string; final: boolean }

/** Limpa o texto (controles/bidi) e limita o tamanho; null se sobrar vazio. */
export function cleanCaption(text: string): string | null {
  const t = cleanText(text).replace(/\s+/g, ' ').slice(0, MAX_CAPTION_CHARS);
  return t || null;
}

/** Visitante → sala da conversa (equipe). */
export function relayVisitorCaption(conversationId: string, text: string, final: boolean): void {
  const ev: CaptionEvent = { conversationId, from: 'VISITOR', text, final };
  emitToConversation(conversationId, 'caption', ev);
}

/** Atendente → visitante(s) conectados na conversa. */
export function relayAgentCaption(conversationId: string, text: string, final: boolean): void {
  const ev: CaptionEvent = { conversationId, from: 'AGENT', text, final };
  emitToVisitors(conversationId, 'caption', ev);
}

/** Rota do atendente: POST /balcao/webchat/conversations/:id/caption */
export function registerAgentCaptionRoutes(app: FastifyInstance): void {
  app.post('/conversations/:id/caption', { preHandler: [bvAuth, requirePerm('conversation:reply')] }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return reply;
    const b = parse(captionBody, req.body ?? {}, reply); if (!b) return reply;
    const ctx = req.bv!;
    const rl = await rateHit('capagent', ctx.userId, env.rl.caption());
    if (!rl.ok) { reply.header('Retry-After', String(rl.retryAfter)); return sendError(reply, 429, 'webchat.rate_limited', 'Muitas legendas em pouco tempo. Aguarde um instante.'); }
    const conv = await prisma.bvConversation.findFirst({ where: { id: p.id, orgId: ctx.orgId }, select: { id: true, channel: true, status: true, assignedUserId: true } });
    if (!conv) return sendError(reply, 404, 'conversation.not_found', 'Conversa não encontrada');
    // só o atendente atribuído ou a supervisão (monitoramento) fala na conversa
    if (conv.assignedUserId !== ctx.userId && !can(ctx.role, 'conversation:monitor')) return sendError(reply, 403, 'conversation.forbidden', 'Sem acesso a esta conversa');
    if (conv.channel !== 'WEBCHAT') return sendError(reply, 409, 'webchat.not_webchat', 'Legendas só existem em conversas do webchat');
    if (conv.status === 'CLOSED') return sendError(reply, 409, 'conversation.closed', 'Conversa encerrada');
    const text = cleanCaption(b.text);
    if (!text) return sendError(reply, 400, 'webchat.empty_message', 'Legenda vazia.');
    relayAgentCaption(conv.id, text, b.final);
    return { delivered: await visitorOnline(conv.id) };
  });
}
