'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me';

/**
 * Eventos do namespace /bv (ver docs/balcao/api-*.md e apps/api/src/balcao/core/realtime.ts):
 *  conversation:new | conversation:updated | conversation:assigned | conversation:closed
 *  message:new {conversationId, message} · typing {conversationId} · presence:changed {userId, presence}
 *  notification {…} · sla:breach {…} · ai:suggestion {conversationId, text, …} · call:ringing|active|ended {…}
 */
let shared: { socket: Socket; token: string; refs: number } | null = null;

export function acquireSocket(token: string): Socket {
  if (shared && shared.token === token) { shared.refs++; return shared.socket; }
  shared?.socket.disconnect();
  const socket = io(`${API}/bv`, { auth: { token }, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 10_000 });
  shared = { socket, token, refs: 1 };
  return socket;
}
export function releaseSocket() {
  if (!shared) return;
  if (--shared.refs <= 0) { shared.socket.disconnect(); shared = null; }
}

/** Assina eventos enquanto o componente estiver montado. `handlers` pode mudar a cada render (usa ref). */
export function useBvSocket(token: string | null, handlers: Record<string, (payload: any) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!token) return;
    const socket = acquireSocket(token);
    const bound = Object.keys(ref.current).map((evt) => {
      const fn = (p: any) => ref.current[evt]?.(p);
      socket.on(evt, fn);
      return [evt, fn] as const;
    });
    return () => { bound.forEach(([evt, fn]) => socket.off(evt, fn)); releaseSocket(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, Object.keys(handlers).sort().join('|')]);
}

export function emitSocket(token: string | null, event: string, ...args: any[]) {
  if (shared && token && shared.token === token) shared.socket.emit(event, ...args);
}
