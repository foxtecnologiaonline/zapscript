'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { acquireSocket, releaseSocket } from '@/lib/balcao/socket';

/** Relógio que reavalia rótulos de tempo (espera, SLA) a cada `everyMs`. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

/**
 * Anúncios para leitores de tela. `announce(texto)` atualiza a região aria-live (polite); repetir o mesmo texto
 * ainda é anunciado (alterna um caractere invisível).
 */
export function useAnnouncer() {
  const [state, setState] = useState({ text: '', n: 0 });
  const announce = useCallback((text: string) => setState((s) => ({ text, n: s.n + 1 })), []);
  return { announce, liveText: state.text + (state.n % 2 ? '​' : '') };
}

/** Entra na sala Socket.IO da conversa (mensagens, digitação, status) e reentra ao reconectar. */
export function useConversationRoom(token: string | null, conversationId: string | null) {
  useEffect(() => {
    if (!token || !conversationId) return;
    const socket = acquireSocket(token);
    const join = () => socket.emit('conv:join', conversationId, () => undefined);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      if (socket.connected) socket.emit('conv:leave', conversationId);
      releaseSocket();
    };
  }, [token, conversationId]);
}

/** Baixa um recurso autenticado como object URL (miniaturas, players). Revoga ao desmontar. */
export function useBlobUrl(path: string | null, query?: Record<string, string | number>, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const q = useRef(query); q.current = query;
  useEffect(() => {
    if (!path || !enabled) return;
    let alive = true; let made: string | null = null;
    setError(false);
    bv.blobUrl(path, q.current)
      .then((u) => { if (!alive) { URL.revokeObjectURL(u); return; } made = u; setUrl(u); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [path, enabled]);
  return { url, error };
}

/** Executa `fn` no máximo uma vez por `wait` ms após a última chamada. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, wait: number) {
  const ref = useRef(fn); ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((...a: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; ref.current(...a); }, wait);
  }, [wait]);
}

/** Elemento de digitação (campos, selects, contenteditable)? Atalhos de uma tecla não devem disparar nele. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
