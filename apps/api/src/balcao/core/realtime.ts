import type { Server as SocketServer, Socket } from 'socket.io';
import { verifyJwt } from './jwt';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { can } from './permissions';
import type { Role } from './types';

/**
 * Tempo real do Balcão sobre o Socket.IO existente. Namespace `/bv` (equipe, autenticada com JWT do
 * Balcão). O namespace do visitante do webchat (`/bv-visitor`) é registrado pelo módulo webchat via getIo().
 *
 * Salas: bv:org:<orgId> · bv:sup:<orgId> (supervisão) · bv:user:<userId> · bv:conv:<conversationId>
 */
let io: SocketServer | null = null;
export const setRealtime = (server: SocketServer | null) => { io = server; };
export const getIo = () => io;

export const rooms = {
  org: (id: string) => `bv:org:${id}`,
  sup: (id: string) => `bv:sup:${id}`,
  user: (id: string) => `bv:user:${id}`,
  conv: (id: string) => `bv:conv:${id}`,
};

const ns = () => io?.of('/bv');

export function emitToOrg(orgId: string, event: string, payload: unknown) { ns()?.to(rooms.org(orgId)).emit(event, payload); }
export function emitToSupervisors(orgId: string, event: string, payload: unknown) { ns()?.to(rooms.sup(orgId)).emit(event, payload); }
export function emitToUser(userId: string, event: string, payload: unknown) { ns()?.to(rooms.user(userId)).emit(event, payload); }
export function emitToConversation(conversationId: string, event: string, payload: unknown) { ns()?.to(rooms.conv(conversationId)).emit(event, payload); }

/**
 * Eventos emitidos (contrato com o front):
 *  conversation:new | conversation:updated | conversation:assigned | conversation:closed  (org / user / sup)
 *  message:new {conversationId, message}   (sala da conversa)
 *  typing {conversationId, from}           (sala da conversa)
 *  presence:changed {userId, presence}     (sup)
 *  notification {id,type,title,...}        (user)
 *  sla:breach {...}                        (sup + user)
 */
export function attachBalcaoSockets(server: SocketServer): void {
  setRealtime(server);
  const nsp = server.of('/bv');
  nsp.use((socket: Socket, next) => {
    const token = (socket.handshake.auth?.token as string) || (socket.handshake.headers['x-access-token'] as string);
    const p = token ? verifyJwt(token, 'access') : null;
    if (!p) return next(new Error('unauthorized'));
    socket.data.bv = { userId: p.sub, orgId: p.org, role: p.role as Role };
    next();
  });
  nsp.on('connection', (socket: Socket) => {
    const { userId, orgId, role } = socket.data.bv as { userId: string; orgId: string; role: Role };
    socket.join(rooms.user(userId));
    socket.join(rooms.org(orgId));
    if (can(role, 'conversation:monitor')) socket.join(rooms.sup(orgId));

    socket.on('conv:join', async (conversationId: string, ack?: (ok: boolean) => void) => {
      try {
        const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId }, select: { assignedUserId: true } });
        const ok = !!conv && (can(role, 'conversation:read_all') || conv.assignedUserId === userId || conv.assignedUserId === null);
        if (ok) socket.join(rooms.conv(conversationId));
        ack?.(ok);
      } catch (err: any) { logger.warn({ err: err?.message }, '[balcao] conv:join falhou'); ack?.(false); }
    });
    socket.on('conv:leave', (conversationId: string) => socket.leave(rooms.conv(conversationId)));
    socket.on('typing', (conversationId: string) => {
      if (socket.rooms.has(rooms.conv(conversationId))) socket.to(rooms.conv(conversationId)).emit('typing', { conversationId, from: 'AGENT', userId });
    });
  });
}
