import type { Namespace, Server, Socket } from 'socket.io';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { emitToConversation, rooms } from '../../core/realtime';
import { getOrgSettings } from '../../core/settings';
import { originAllowedForSocket } from './config';
import { rateHit } from './ratelimit';
import { env } from './config';
import { findSessionByToken, isExpired } from './sessions';

/**
 * Namespace Socket.IO do visitante (`/bv-visitor`). Autenticação pelo token do visitante (auth.token) e Origin
 * validado contra settings.webchat.allowedOrigins. O visitante só entra na sala da PRÓPRIA conversa.
 *
 * Servidor → visitante:  message:new {message} · typing {from:'agent'} · csat:request {prompt} · conversation:closed {conversationId}
 * Visitante → servidor:  typing
 */
export const VISITOR_NS = '/bv-visitor';
export const visitorRooms = {
  conv: (id: string) => `bvv:conv:${id}`,
  sess: (id: string) => `bvv:sess:${id}`,
};

let nsp: Namespace | null = null;
let attachedTo: Server | null = null;
let sweep: NodeJS.Timeout | null = null;

export const getVisitorNamespace = () => nsp;

export function emitToVisitors(conversationId: string, event: string, payload: unknown): void {
  nsp?.to(visitorRooms.conv(conversationId)).emit(event, payload);
}

/** Há algum visitante conectado por socket nesta conversa? */
export async function visitorOnline(conversationId: string): Promise<boolean> {
  if (!nsp) return false;
  try { return (await nsp.in(visitorRooms.conv(conversationId)).fetchSockets()).length > 0; } catch { return false; }
}

/** Coloca os sockets da sessão na sala da conversa (e tira da anterior). */
export function joinVisitorConversation(sessionId: string, conversationId: string, previousConversationId?: string | null): void {
  if (!nsp) return;
  if (previousConversationId && previousConversationId !== conversationId) nsp.in(visitorRooms.sess(sessionId)).socketsLeave(visitorRooms.conv(previousConversationId));
  nsp.in(visitorRooms.sess(sessionId)).socketsJoin(visitorRooms.conv(conversationId));
}

export function disconnectVisitor(sessionId: string): void {
  nsp?.in(visitorRooms.sess(sessionId)).disconnectSockets(true);
}

const selfOf = (socket: Socket): string => {
  const proto = (socket.handshake.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || (socket.handshake.secure ? 'https' : 'http');
  return `${proto}://${socket.handshake.headers.host ?? ''}`.toLowerCase();
};

/**
 * Registra o namespace `/bv-visitor` em `io` (idempotente). Também escuta o `typing` do atendente no namespace
 * `/bv` e o repassa ao visitante da mesma conversa (o core só entrega ao namespace da equipe).
 */
export function attachVisitorNamespace(io: Server): void {
  if (attachedTo === io && nsp) return;
  attachedTo = io;
  nsp = io.of(VISITOR_NS);

  nsp.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as any)?.token;
      const s = await findSessionByToken(typeof token === 'string' ? token : undefined);
      if (!s) return next(new Error('unauthorized'));
      const settings = await getOrgSettings(s.orgId);
      if (!originAllowedForSocket(socket.handshake.headers.origin, settings, selfOf(socket))) return next(new Error('origin_not_allowed'));
      socket.data.visitor = { sessionId: s.id, orgId: s.orgId };
      next();
    } catch (err: any) {
      logger.warn({ err: err?.message }, '[webchat] falha na autenticação do socket');
      next(new Error('unauthorized'));
    }
  });

  nsp.on('connection', async (socket: Socket) => {
    const { sessionId, orgId } = socket.data.visitor as { sessionId: string; orgId: string };
    socket.join(visitorRooms.sess(sessionId));
    try {
      const s = await prisma.bvWebchatSession.findFirst({ where: { id: sessionId, orgId }, select: { conversationId: true } });
      if (s?.conversationId) socket.join(visitorRooms.conv(s.conversationId));
    } catch { /* o polling cobre */ }

    let lastTyping = 0;
    socket.on('typing', async () => {
      if (Date.now() - lastTyping < 1500) return;
      lastTyping = Date.now();
      try {
        const rl = await rateHit('typing', sessionId, env.rl.typing());
        if (!rl.ok) return;
        const s = await prisma.bvWebchatSession.findFirst({ where: { id: sessionId, orgId }, select: { conversationId: true, lastSeenAt: true, endedAt: true } });
        if (!s?.conversationId || isExpired(s)) return socket.disconnect(true);
        emitToConversation(s.conversationId, 'typing', { conversationId: s.conversationId, from: 'CONTACT' });
      } catch { /* melhor esforço */ }
    });
  });

  // Atendente digitando → visitante (o core só emite no namespace /bv; ouvimos o mesmo evento lá).
  io.of('/bv').on('connection', (agent: Socket) => {
    agent.on('typing', (conversationId: unknown) => {
      if (typeof conversationId !== 'string' || !agent.rooms.has(rooms.conv(conversationId))) return;
      nsp?.to(visitorRooms.conv(conversationId)).emit('typing', { from: 'agent' });
    });
  });

  // Varredura de sessões expiradas com socket aberto (por processo — não é job de negócio).
  if (sweep) clearInterval(sweep);
  sweep = setInterval(async () => {
    try {
      if (!nsp) return;
      const ids = [...nsp.sockets.values()].map((s) => (s.data.visitor as any)?.sessionId as string).filter(Boolean);
      if (!ids.length) return;
      const rows = await prisma.bvWebchatSession.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, lastSeenAt: true, endedAt: true } });
      const live = new Set(rows.filter((r) => !isExpired(r)).map((r) => r.id));
      for (const s of nsp.sockets.values()) if (!live.has((s.data.visitor as any)?.sessionId)) s.disconnect(true);
    } catch { /* tenta no próximo ciclo */ }
  }, 5 * 60_000);
  sweep.unref();
}

export function stopVisitorSweep(): void { if (sweep) { clearInterval(sweep); sweep = null; } }
