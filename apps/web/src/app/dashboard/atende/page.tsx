'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import AtendeHeader from './AtendeHeader';
import SuggestionReview, { QaSuggestion } from './SuggestionReview';

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
  humanAuthored: boolean;
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
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [kbPrompt, setKbPrompt] = useState<QaSuggestion | null>(null);

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

  useEffect(() => {
    setReplyText('');
    setKbPrompt(null);
  }, [selectedId]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    const text = replyText.trim();
    if (!selected || !text) return;
    setReplyBusy(true);
    try {
      const saved = await api.post<Message>(`/atende/conversations/${selected.id}/reply`, { message: text });
      setMessages((ms) => [...ms, saved]);
      setReplyText('');
    } catch (e: any) {
      alert(e?.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setReplyBusy(false);
    }
  }

  // Mesma lógica de pareamento do back-end (POST /atende/setup/from-history):
  // a pergunta do cliente é a mensagem 'in' mais recente antes desta resposta,
  // mas se outra resposta humana já consumiu esse 'in', não há mais o que parear.
  function findPairedQuestion(list: Message[], index: number): string | null {
    for (let i = index - 1; i >= 0; i--) {
      if (list[i].direction === 'in') return list[i].content;
      if (list[i].direction === 'out' && list[i].humanAuthored) return null;
    }
    return null;
  }

  function handleSaveAsKb(index: number) {
    const question = findPairedQuestion(messages, index);
    if (!question) {
      alert('Não encontrei a pergunta do cliente correspondente a esta resposta.');
      return;
    }
    setKbPrompt({ question, answer: messages[index].content });
  }

  async function handleAcceptKbPrompt(items: QaSuggestion[]) {
    let failed = 0;
    for (const item of items) {
      try {
        await api.post('/atende/kb', item);
      } catch {
        failed++;
      }
    }
    setKbPrompt(null);
    if (failed > 0) alert('Não foi possível salvar. Tente novamente pela Base de Conhecimento.');
  }

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
      <div className="flex items-center justify-center h-64 text-brand-muted">
        Carregando conversas…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="max-w-6xl mx-auto">
        <AtendeHeader />

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-400">
            {error}
          </div>
        )}

        {conversations.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <p className="text-brand-text-secondary font-medium">Nenhuma conversa ainda.</p>
            <p className="text-brand-muted text-sm mt-2 max-w-md mx-auto">
              Assim que o Atende estiver habilitado e um cliente escrever pro seu número,
              a conversa aparece aqui automaticamente.
            </p>
            <Link
              href="/dashboard/atende/config"
              className="inline-block mt-4 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Configurar o Atende →
            </Link>
          </div>
        ) : (
          <div className="flex gap-0 md:gap-4 rounded-xl border border-brand-border bg-brand-surface overflow-hidden" style={{ minHeight: 480 }}>
            {/* Lista de conversas */}
            <div className={`${selectedId ? 'hidden md:block' : 'block'} w-full md:w-80 md:border-r md:border-brand-border overflow-y-auto`} style={{ maxHeight: 640 }}>
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-brand-border/60 hover:bg-brand-elevated/50 transition-colors ${
                    selectedId === c.id ? 'bg-brand-elevated/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.contactName || c.contactPhone}</span>
                    <span className="text-[11px] text-brand-muted flex-shrink-0">{timeAgo(c.lastMessageAt)}</span>
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
                    <p className="text-sm text-brand-muted truncate mt-1">
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
                <div className="flex-1 flex items-center justify-center text-brand-muted text-sm">
                  Selecione uma conversa
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => setSelectedId(null)}
                        className="md:hidden text-brand-text-secondary hover:text-brand-text flex-shrink-0"
                      >
                        ←
                      </button>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{selected.contactName || selected.contactPhone}</div>
                        <div className="text-xs text-brand-muted truncate">
                          {selected.contactPhone}{selected.number?.displayName ? ` · ${selected.number.displayName}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleTakeoverToggle}
                      disabled={actionBusy}
                      className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        selected.humanTakeover
                          ? 'bg-brand-primary hover:opacity-90 text-white'
                          : 'border border-brand-border hover:border-brand-primary/30 text-brand-text-secondary'
                      }`}
                    >
                      {selected.humanTakeover ? 'Devolver ao robô' : 'Assumir conversa'}
                    </button>
                  </div>

                  {kbPrompt && (
                    <div className="px-4 py-3 border-b border-brand-border">
                      <SuggestionReview
                        kind="qa-list"
                        title="Salvar como KB"
                        description="Confirme ou ajuste antes de adicionar à Base de Conhecimento."
                        items={[kbPrompt]}
                        onAccept={handleAcceptKbPrompt}
                        onReject={() => setKbPrompt(null)}
                      />
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {loadingMessages ? (
                      <p className="text-brand-muted text-sm">Carregando…</p>
                    ) : (
                      messages.map((m, i) => (
                        <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                              m.direction === 'out'
                                ? 'bg-brand-primary/80 text-white rounded-br-sm'
                                : 'bg-brand-elevated text-brand-text rounded-bl-sm'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{m.content}</p>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] opacity-70">
                              <span>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                              {m.aiGenerated && <span>· IA</span>}
                              {m.humanAuthored && <span>· Você</span>}
                              {m.humanAuthored && (
                                <button
                                  type="button"
                                  onClick={() => handleSaveAsKb(i)}
                                  className="underline hover:no-underline"
                                >
                                  Salvar como KB
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {selected.humanTakeover && (
                    <form onSubmit={handleSendReply} className="border-t border-brand-border p-3 flex items-center gap-2 flex-shrink-0">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Responder pelo WhatsApp…"
                        className="flex-1 rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                      />
                      <button
                        type="submit"
                        disabled={replyBusy || !replyText.trim()}
                        className="flex-shrink-0 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {replyBusy ? '…' : 'Enviar'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
