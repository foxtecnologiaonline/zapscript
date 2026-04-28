'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Handlers = Record<string, (data: any) => void>;

/**
 * Cria uma conexão Socket.IO e registra handlers.
 * - Usa handlersRef para evitar closures velhas sem recriar o socket
 * - Expõe `connected` para o componente saber o estado real
 */
export function useSocket(userId: string, handlers: Handlers) {
  const socketRef  = useRef<Socket | null>(null);
  const handlersRef = useRef<Handlers>(handlers);
  const [connected, setConnected] = useState(false);

  // Mantém handlersRef sempre atualizado sem recriar o socket
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!userId) return;

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', {
      transports:           ['polling'],
      upgrade:              false,
      reconnectionDelay:    2000,
      reconnectionAttempts: 15,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { userId });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Wrappers estáveis que sempre delegam ao handler mais recente
    const wrappers: Record<string, (data: any) => void> = {};
    Object.keys(handlers).forEach(event => {
      wrappers[event] = (data: any) => handlersRef.current[event]?.(data);
      socket.on(event, wrappers[event]);
    });

    return () => {
      Object.entries(wrappers).forEach(([event, fn]) => socket.off(event, fn));
      socket.disconnect();
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { socketRef, connected };
}
