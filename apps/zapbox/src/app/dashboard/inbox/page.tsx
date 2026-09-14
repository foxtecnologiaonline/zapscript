'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/apiClient';

interface Conversation {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  lastMessageAt: string;
  messages: { body: string }[];
}

interface Message {
  id: string;
  direction: 'in' | 'out';
  channel: string;
  senderType: string;
  body: string;
  createdAt: string;
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(async () => {
    const data = await apiFetch('/api/conversations');
    setConversations(data.conversations);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const data = await apiFetch(`/api/conversations/${id}/messages`);
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 8000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeId) return;
    loadMessages(activeId);
    pollRef.current = setInterval(() => loadMessages(activeId), 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeId, loadMessages]);

  async function send() {
    if (!activeId || !text.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/conversations/${activeId}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      setText('');
      loadMessages(activeId);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      <div className="w-72 bg-white border rounded-xl overflow-y-auto">
        {conversations.length === 0 && <p className="p-4 text-sm text-gray-500">Nenhuma conversa ainda.</p>}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveId(c.id)}
            className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${activeId === c.id ? 'bg-green-50' : ''}`}
          >
            <p className="font-medium text-sm">{c.customerName || c.customerPhone || 'Visitante'}</p>
            <p className="text-xs text-gray-500 truncate">{c.messages[0]?.body ?? '—'}</p>
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white border rounded-xl flex flex-col">
        {!activeId ? (
          <p className="m-auto text-gray-400">Selecione uma conversa</p>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[70%] px-3 py-2 rounded-xl text-sm ${
                    m.direction === 'out' ? 'ml-auto bg-green-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {m.body}
                  <div className="text-[10px] opacity-60 mt-1">{m.channel}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 p-3 border-t">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Responder via WhatsApp..."
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={send}
                disabled={sending}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
