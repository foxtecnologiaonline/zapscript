'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

type Handlers = Record<string, (data: any) => void>;

export function useSocket(userId: string, handlers: Handlers) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { userId });
    });

    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    return () => { socket.disconnect(); };
  }, [userId]);

  return socketRef;
}
