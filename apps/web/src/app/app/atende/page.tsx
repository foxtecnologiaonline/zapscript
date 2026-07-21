'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import AtendeHeader from './AtendeHeader';

interface ConversationListItem {
  id: string;
  contactPhone: string;
  contactName: string | null;
  status: string;
  humanTakeover: boolean;
  lastMessageAt: string;
  number: { id: string; displayName: string | null } | null;
  lastMessage: { direction: string; content: string; createdAt: string } | null;
}

interface Message {
  id: string;
  direction: string;
  content: string;
  aiGenerated: boolean;
  confidence: number | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

export default function AtendeInboxPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.get<ConversationListItem[]>('/atende/conversations');
      setConversations(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar as conversas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 8000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const data = await api.get<{ messages: Message[] }>(`/atende/conversations/${id}/messages`);
      setMessages(data.messages);
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingMessages(true);
    loadMessages(selectedId).finally(() => setLoadingMessages(false));
    const interval = setInterval(() => loadMessages(selectedId), 5000);
    return () => clearInterval(interval);
  }, [selectedId, loadMessages]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  async function handleTakeoverToggle() {
    if (!selected) return;
    const next = !selected.humanTakeover;
    setActionBusy(true);
    try {
      await api.post(`/atende/conversations/${selected.id}/${next ? 'takeover' : 'release'}`, {});
      setConversations((cs) => cs.map((c) => (c.id === selected.id ? { ...c, humanTakeover: next } : c)));
    } catch (e: any) {
      alert(e?.message || 'Não foi possível atualizar a conversa.');
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando conversas…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-6xl mx-auto">
        <AtendeHeader />

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        {conversations.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
            <p className="text-neutral-300 font-medium">Nenhuma conversa ainda.</p>
            <p className="text-neutral-500 text-sm mt-2 max-w-md mx-auto">
              Assim que o Atende estiver habilitado e um cliente escrever pro seu número,
              a conversa aparece aqui automaticamente.
            </p>
            <Link
              href="/app/atende/config"
              className="inline-block mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Configurar o Atende →
            </Link>
          </div>
        ) : (
          <div className="flex gap-0 md:gap-4 rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden" style={{ minHeight: 480 }}>
            {/* Lista de conversas */}
            <div className={`${selectedId ? 'hidden md:block' : 'block'} w-full md:w-80 md:border-r md:border-neutral-800 overflow-y-auto`} style={{ maxHeight: 640 }}>
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-neutral-800/60 hover:bg-neutral-800/50 transition-colors ${
                    selectedId === c.id ? 'bg-neutral-800/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.contactName || c.contactPhone}</span>
                    <span className="text-[11px] text-neutral-500 flex-shrink-0">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {c.humanTakeover && (
                      <span className="text-[10px] rounded-full bg-amber-500/20 text-amber-400 px-1.5 py-0.5">Você assumiu</span>
                    )}
                    {!c.humanTakeover && c.status === 'escalated' && (
                      <span className="text-[10px] rounded-full bg-red-500/20 text-red-400 px-1.5 py-0.5">Precisa de atenção</span>
                    )}
                  </div>
                  {c.lastMessage && (
                    <p className="text-sm text-neutral-500 truncate mt-1">
                      {c.lastMessage.direction === 'out' ? '↩ ' : ''}
                      {c.lastMessage.content}
                    </p>
                  )}
                </button>
              ))}
            </div>

            {/* Thread */}
            <div className={`${selectedId ? 'block' : 'hidden md:block'} flex-1 flex flex-col`} style={{ maxHeight: 640 }}>
              {!selected ? (
                <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
                  Selecione uma conversa
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => setSelectedId(null)}
                        className="md:hidden text-neutral-400 hover:text-neutral-200 flex-shrink-0"
                      >
                        ←
                      </button>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{selected.contactName || selected.contactPhone}</div>
                        <div className="text-xs text-neutral-500 truncate">
                          {selected.contactPhone}{selected.number?.displayName ? ` · ${selected.number.displayName}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleTakeoverToggle}
                      disabled={actionBusy}
                      className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        selected.humanTakeover
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'border border-neutral-700 hover:border-neutral-600 text-neutral-300'
                      }`}
                    >
                      {selected.humanTakeover ? 'Devolver ao robô' : 'Assumir conversa'}
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {loadingMessages ? (
                      <p className="text-neutral-500 text-sm">Carregando…</p>
                    ) : (
                      messages.map((m) => (
                        <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                              m.direction === 'out'
                                ? 'bg-emerald-700/80 text-white rounded-br-sm'
                                : 'bg-neutral-800 text-neutral-100 rounded-bl-sm'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{m.content}</p>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] opacity-70">
                              <span>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                              {m.aiGenerated && <span>· IA</span>}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
