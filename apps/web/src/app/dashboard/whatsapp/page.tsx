'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

interface WNumberLite {
  id: string;
  displayName: string | null;
  phoneNumber: string;
  status: string;
}

type ChatKind = 'individual' | 'group';

interface ChatSummary {
  jid: string;
  phone: string;
  name: string | null;
  type: ChatKind;
  unreadCount: number;
  lastMessageAt: number | null; // epoch ms
}

interface WaMessage {
  id: string;
  fromMe: boolean;
  type: string;         // 'text' — mídia ainda fora de escopo
  text: string;
  timestamp: number;    // epoch seconds
  senderJid?: string;   // só em mensagem de grupo, !fromMe — quem mandou dentro do grupo
  senderName?: string;  // idem
  pending?: boolean;    // marcação local (envio otimista), nunca vem da API
}

function chatKindFromJid(jid: string): ChatKind {
  return jid.endsWith('@g.us') ? 'group' : 'individual';
}

// Mesmo tamanho de página do default no backend (whatsapp-web.ts) — se a
// última busca trouxe exatamente esse tanto, pode ter mais mensagens antigas.
const MESSAGES_PAGE_SIZE = 50;

// ── UI helpers ───────────────────────────────────────────────────────────────
function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

function formatChatTime(epochMs: number | null): string {
  if (epochMs == null) return '';
  const d   = new Date(epochMs);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function chatDisplayName(chat: ChatSummary): string {
  if (chat.name?.trim()) return chat.name.trim();
  return chat.type === 'group' ? 'Grupo' : `+${chat.phone}`;
}

// Insere/atualiza um chat na lista a partir de uma mensagem (otimista ou vinda
// do Socket.IO), sempre reordenando o chat tocado pro topo — mesma UX do
// WhatsApp de verdade (conversa mais recente sobe).
function applyIncomingMessage(chats: ChatSummary[], jid: string, msg: WaMessage, isOpenChat: boolean): ChatSummary[] {
  const phone   = jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace(/\D/g, '');
  const idx     = chats.findIndex(c => c.jid === jid);
  const readNow = msg.fromMe || isOpenChat;

  if (idx === -1) {
    const type = chatKindFromJid(jid);
    const created: ChatSummary = {
      jid, phone, type,
      // Em grupo, msg.senderName é quem falou (não o nome do grupo) — não dá
      // pra usar como nome do chat aqui. Fica "Grupo" (chatDisplayName) até
      // o próximo GET /chats trazer o subject de verdade da Evolution.
      name:         type === 'group' ? null : (msg.fromMe ? null : (msg.senderName || null)),
      unreadCount:  readNow ? 0 : 1,
      lastMessageAt: msg.timestamp * 1000,
    };
    return [created, ...chats];
  }

  const updated: ChatSummary = {
    ...chats[idx],
    lastMessageAt: msg.timestamp * 1000,
    unreadCount:   readNow ? 0 : chats[idx].unreadCount + 1,
  };
  return [updated, ...chats.slice(0, idx), ...chats.slice(idx + 1)];
}

// Funde uma mensagem recebida via Socket.IO na thread aberta — evita bolha
// duplicada quando o eco do próprio envio (fromMe) chega antes da resposta
// do POST /messages já ter confirmado a mensagem otimista local.
function mergeIncomingMessage(messages: WaMessage[], incoming: WaMessage): WaMessage[] {
  if (messages.some(m => m.id === incoming.id)) return messages;

  if (incoming.fromMe) {
    const pendingIdx = messages.findIndex(m => m.pending && m.fromMe && m.text === incoming.text);
    if (pendingIdx !== -1) {
      const next = [...messages];
      next[pendingIdx] = { ...incoming, pending: false };
      return next;
    }
  }
  return [...messages, incoming];
}

export default function WhatsAppWebPage() {
  const [userId, setUserId]                     = useState('');
  const [numbers, setNumbers]                   = useState<WNumberLite[]>([]);
  const [loadingNumbers, setLoadingNumbers]     = useState(true);
  const [selectedNumberId, setSelectedNumberId] = useState<string | null>(null);

  const [chats, setChats]               = useState<ChatSummary[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatsError, setChatsError]     = useState('');
  const [chatSearch, setChatSearch]     = useState('');

  const [selectedChat, setSelectedChat]       = useState<ChatSummary | null>(null);
  const [messages, setMessages]               = useState<WaMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError]     = useState('');
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder]       = useState(false);

  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending]           = useState(false);
  const [sendError, setSendError]       = useState('');

  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');

  const bottomRef       = useRef<HTMLDivElement>(null);
  const messagesPaneRef = useRef<HTMLDivElement>(null);
  // Contadores de requisição — descartam respostas obsoletas quando o usuário
  // troca de número/conversa rápido e uma busca antiga responde depois da nova.
  const chatsRequestRef    = useRef(0);
  const messagesRequestRef = useRef(0);

  const connectedNumbers = useMemo(() => numbers.filter(n => n.status === 'connected'), [numbers]);

  // Filtro local — a lista inteira já está em memória, sem custo de ida ao
  // backend/Evolution pra buscar por nome/telefone.
  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(c => chatDisplayName(c).toLowerCase().includes(q) || c.phone.includes(q));
  }, [chats, chatSearch]);

  // ── Carrega usuário + números ──────────────────────────────────────────────
  useEffect(() => {
    api.get<any>('/auth/me').then(u => setUserId(u.id)).catch(() => null);
    setLoadingNumbers(true);
    api.get<WNumberLite[]>('/numbers')
      .then(ns => setNumbers(ns ?? []))
      .catch(() => setNumbers([]))
      .finally(() => setLoadingNumbers(false));
  }, []);

  // Auto-seleciona quando existe pelo menos 1 número conectado
  useEffect(() => {
    if (selectedNumberId || connectedNumbers.length === 0) return;
    setSelectedNumberId(connectedNumbers[0].id);
  }, [connectedNumbers, selectedNumberId]);

  // ── Conversas do número selecionado ──────────────────────────────────────
  // `fresh` pula o cache curto do backend — usado só no clique manual em
  // "Atualizar" (o resto da tela já se mantém em dia via Socket.IO).
  const loadChats = useCallback(async (numberId: string, fresh = false) => {
    const requestId = ++chatsRequestRef.current;
    setLoadingChats(true); setChatsError('');
    try {
      const res = await api.get<{ chats: ChatSummary[] }>(`/numbers/${numberId}/chats${fresh ? '?fresh=1' : ''}`);
      if (chatsRequestRef.current !== requestId) return; // resposta obsoleta — número já trocou
      setChats(res.chats ?? []);
    } catch (err: any) {
      if (chatsRequestRef.current !== requestId) return;
      setChatsError(err.message || 'Não foi possível carregar as conversas.');
      setChats([]);
    } finally {
      if (chatsRequestRef.current === requestId) setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    setSelectedChat(null);
    setMessages([]);
    setMobileView('list');
    setChatSearch('');
    if (!selectedNumberId) { setChats([]); return; }
    loadChats(selectedNumberId);
  }, [selectedNumberId, loadChats]);

  // ── Mensagens da conversa selecionada (primeira página) ──────────────────
  useEffect(() => {
    if (!selectedNumberId || !selectedChat) { setMessages([]); setHasMoreMessages(false); return; }
    const requestId = ++messagesRequestRef.current;
    setLoadingMessages(true); setMessagesError(''); setHasMoreMessages(false);
    api.get<{ messages: WaMessage[] }>(
      `/numbers/${selectedNumberId}/chats/${encodeURIComponent(selectedChat.jid)}/messages?limit=${MESSAGES_PAGE_SIZE}`
    )
      .then(res => {
        if (messagesRequestRef.current !== requestId) return; // resposta obsoleta — conversa já trocou
        const msgs = res.messages ?? [];
        setMessages(msgs);
        setHasMoreMessages(msgs.length >= MESSAGES_PAGE_SIZE);
      })
      .catch(err => {
        if (messagesRequestRef.current !== requestId) return;
        setMessagesError(err.message || 'Não foi possível carregar as mensagens.');
      })
      .finally(() => {
        if (messagesRequestRef.current === requestId) setLoadingMessages(false);
      });
  }, [selectedNumberId, selectedChat]);

  // ── Carregar mensagens mais antigas (histórico) ───────────────────────────
  // Preserva a posição visual do scroll: sem isso, prepender mensagens no
  // topo empurra tudo pra baixo e a tela "pula" pro topo, perdendo o lugar.
  // suppressAutoScrollRef avisa o efeito de auto-scroll (abaixo) pra não brigar
  // com essa restauração manual nesta atualização específica de `messages`.
  const suppressAutoScrollRef = useRef(false);

  async function loadOlderMessages() {
    if (!selectedNumberId || !selectedChat || messages.length === 0 || loadingOlder) return;
    // Mesmo contador de requisição da 1ª página: se o usuário trocar de
    // conversa antes desta resposta chegar, descarta — sem isso, mensagens
    // da conversa ANTIGA seriam inseridas na conversa NOVA já aberta.
    const requestId  = messagesRequestRef.current;
    const oldest     = messages[0];
    const pane       = messagesPaneRef.current;
    const prevHeight = pane?.scrollHeight ?? 0;

    setLoadingOlder(true);
    try {
      const res = await api.get<{ messages: WaMessage[] }>(
        `/numbers/${selectedNumberId}/chats/${encodeURIComponent(selectedChat.jid)}/messages?limit=${MESSAGES_PAGE_SIZE}&before=${oldest.timestamp}`
      );
      if (messagesRequestRef.current !== requestId) return; // resposta obsoleta — conversa já trocou
      const older = res.messages ?? [];
      setHasMoreMessages(older.length >= MESSAGES_PAGE_SIZE);
      suppressAutoScrollRef.current = true;
      setMessages(ms => {
        const existingIds = new Set(ms.map(m => m.id));
        return [...older.filter(m => !existingIds.has(m.id)), ...ms];
      });
      requestAnimationFrame(() => {
        if (pane) pane.scrollTop = pane.scrollHeight - prevHeight;
      });
    } catch (err: any) {
      if (messagesRequestRef.current !== requestId) return;
      setMessagesError(err.message || 'Não foi possível carregar mensagens mais antigas.');
    } finally {
      if (messagesRequestRef.current === requestId) setLoadingOlder(false);
    }
  }

  // Rola pro fim da thread ao trocar de conversa, carregar a 1ª página, ou
  // chegar mensagem nova (própria ou recebida) — exceto quando quem mudou
  // `messages` foi loadOlderMessages, que já cuida da própria posição.
  useEffect(() => {
    if (suppressAutoScrollRef.current) { suppressAutoScrollRef.current = false; return; }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, selectedChat]);

  function openChat(chat: ChatSummary) {
    setSelectedChat(chat);
    setChats(cs => cs.map(c => (c.jid === chat.jid ? { ...c, unreadCount: 0 } : c)));
    setMobileView('thread');
  }

  // ── Tempo real ────────────────────────────────────────────────────────────
  const { connected: socketOk } = useSocket(userId, {
    'wa:message': (d: { numberId: string; jid: string; message: WaMessage }) => {
      if (d.numberId !== selectedNumberId) return;
      const isOpenChat = selectedChat?.jid === d.jid;
      setChats(cs => applyIncomingMessage(cs, d.jid, d.message, isOpenChat));
      if (isOpenChat) {
        setMessages(ms => mergeIncomingMessage(ms, d.message));
      }
    },
  });

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = messageInput.trim();
    if (!text || !selectedChat || !selectedNumberId || sending) return;

    setMessageInput(''); setSendError(''); setSending(true);
    const tempId = `temp_${Date.now()}`;
    const optimistic: WaMessage = {
      id: tempId, fromMe: true, type: 'text', text,
      timestamp: Math.floor(Date.now() / 1000), pending: true,
    };
    // Guarda a lista inteira (conteúdo E ordem) de antes do envio otimista —
    // se o envio falhar, restaura tudo de volta. Reverter só o conteúdo do
    // chat tocado (sem a posição) deixava a conversa presa no topo da lista
    // mesmo depois de reverter lastMessageAt/unreadCount, como se ainda fosse
    // "a mais recente" — confirmado num teste manual do envio falhando.
    const prevChatsSnapshot = chats;

    setMessages(ms => [...ms, optimistic]);
    setChats(cs => applyIncomingMessage(cs, selectedChat.jid, optimistic, true));

    try {
      const res = await api.post<{ ok: boolean; id: string | null }>(
        `/numbers/${selectedNumberId}/chats/${encodeURIComponent(selectedChat.jid)}/messages`, { text }
      );
      setMessages(ms => ms.map(m => (m.id === tempId ? { ...m, id: res.id || tempId, pending: false } : m)));
    } catch (err: any) {
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setChats(prevChatsSnapshot);
      setSendError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-brand-text">WhatsApp Web</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">
            Converse pelo número já conectado — sem precisar do celular por perto
          </p>
        </div>
        {userId && (
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            socketOk ? 'text-green-500 bg-green-400/10 border-green-400/20'
                     : 'text-amber-500 bg-amber-400/10 border-amber-400/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
            {socketOk ? 'Tempo real' : 'Modo polling'}
          </div>
        )}
      </div>

      {loadingNumbers ? (
        <div className="flex items-center justify-center py-12 gap-2 text-brand-muted text-sm">
          <Spinner size={4} /> Carregando...
        </div>
      ) : connectedNumbers.length === 0 ? (
        <div className="card p-10 sm:p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted mb-4">
            Nenhum número conectado ainda. Conecte um WhatsApp para usar essa tela.
          </div>
          <Link href="/dashboard/numeros" className="btn-primary inline-block text-sm px-5 py-2.5">
            Conectar WhatsApp
          </Link>
        </div>
      ) : (
        <>
          {/* Seletor de número — só aparece com mais de 1 conectado */}
          {connectedNumbers.length > 1 && (
            <div className="mb-3">
              <select
                value={selectedNumberId ?? ''}
                onChange={e => setSelectedNumberId(e.target.value)}
                className="bg-brand-elevated border border-brand-border rounded-xl text-sm text-brand-text px-3 py-2 outline-none focus:border-brand-primary transition-colors"
              >
                {connectedNumbers.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.displayName || 'Dispositivo'} · +{n.phoneNumber}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="card overflow-hidden flex h-[calc(100vh-220px)] min-h-[440px]">

            {/* ── Lista de conversas ── */}
            <div className={`w-full sm:w-72 flex-shrink-0 border-r border-brand-border flex-col ${
              mobileView === 'thread' ? 'hidden sm:flex' : 'flex'
            }`}>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-brand-border flex-shrink-0">
                <p className="text-xs font-bold text-brand-text">Conversas</p>
                <button
                  onClick={() => selectedNumberId && loadChats(selectedNumberId, true)}
                  disabled={loadingChats}
                  className="text-[11px] text-brand-muted hover:text-brand-text transition-colors disabled:opacity-50"
                >
                  🔄 Atualizar
                </button>
              </div>

              {chats.length > 0 && (
                <div className="px-3 py-2 border-b border-brand-border flex-shrink-0">
                  <input
                    value={chatSearch}
                    onChange={e => setChatSearch(e.target.value)}
                    placeholder="Buscar conversa…"
                    className="w-full bg-brand-elevated border border-brand-border rounded-lg px-2.5 py-1.5 text-xs text-brand-text placeholder:text-brand-muted outline-none focus:border-brand-primary transition-colors"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {loadingChats ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-brand-muted text-xs">
                    <Spinner size={4} /> Carregando...
                  </div>
                ) : chatsError ? (
                  <div className="p-4 text-center">
                    <p className="text-red-400 text-xs mb-2">{chatsError}</p>
                    <button
                      onClick={() => selectedNumberId && loadChats(selectedNumberId, true)}
                      className="text-[11px] text-brand-primary hover:underline"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : chats.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-8 px-4">Nenhuma conversa ainda.</p>
                ) : filteredChats.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-8 px-4">Nenhuma conversa encontrada.</p>
                ) : (
                  filteredChats.map(chat => (
                    <button
                      key={chat.jid}
                      onClick={() => openChat(chat)}
                      className={`w-full text-left px-3 py-2.5 border-b border-brand-border/40 hover:bg-brand-elevated transition-colors flex items-center gap-2 ${
                        selectedChat?.jid === chat.jid ? 'bg-brand-elevated' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-brand-text truncate">
                          {chat.type === 'group' && <span className="mr-1">👥</span>}
                          {chatDisplayName(chat)}
                        </div>
                        <div className="text-[10px] text-brand-muted mt-0.5">{formatChatTime(chat.lastMessageAt)}</div>
                      </div>
                      {chat.unreadCount > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-bold text-white bg-brand-primary rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                          {chat.unreadCount > 9 ? '9+' : chat.unreadCount}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* ── Thread ── */}
            <div className={`flex-1 min-w-0 flex-col ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'}`}>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-brand-border flex-shrink-0">
                <button
                  onClick={() => setMobileView('list')}
                  className="sm:hidden text-brand-muted hover:text-brand-text transition-colors px-1"
                  aria-label="Voltar para lista de conversas"
                >
                  ←
                </button>
                <div className="font-bold text-sm text-brand-text truncate">
                  {selectedChat
                    ? <>{selectedChat.type === 'group' && <span className="mr-1">👥</span>}{chatDisplayName(selectedChat)}</>
                    : 'Selecione uma conversa'}
                </div>
              </div>

              <div ref={messagesPaneRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {!selectedChat ? (
                  <p className="text-xs text-brand-muted text-center py-8">Selecione uma conversa à esquerda.</p>
                ) : loadingMessages ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-brand-muted text-xs">
                    <Spinner size={4} /> Carregando...
                  </div>
                ) : messagesError ? (
                  <p className="text-red-400 text-xs text-center py-8">{messagesError}</p>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-8">Nenhuma mensagem ainda.</p>
                ) : (
                  <>
                    {hasMoreMessages && (
                      <div className="flex justify-center pb-1">
                        <button
                          onClick={loadOlderMessages}
                          disabled={loadingOlder}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-brand-elevated border border-brand-border text-brand-muted hover:text-brand-text transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {loadingOlder ? <><Spinner size={3} /> Carregando…</> : 'Carregar mensagens mais antigas'}
                        </button>
                      </div>
                    )}
                    {messages.map(m => (
                    <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                        m.fromMe
                          ? 'bg-brand-primary text-white rounded-br-sm'
                          : 'bg-brand-elevated text-brand-text rounded-bl-sm'
                      } ${m.pending ? 'opacity-60' : ''}`}>
                        {/* Nome de quem falou — só em grupo, e só em mensagem que não é minha
                            (numa conversa individual já é óbvio quem está falando) */}
                        {selectedChat?.type === 'group' && !m.fromMe && m.senderName && (
                          <div className="text-[11px] font-semibold text-brand-primary mb-0.5">{m.senderName}</div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        <div className={`text-[10px] mt-1 ${m.fromMe ? 'text-white/70' : 'text-brand-muted'}`}>
                          {m.pending ? 'enviando…' : formatChatTime(m.timestamp * 1000)}
                        </div>
                      </div>
                    </div>
                    ))}
                  </>
                )}
                <div ref={bottomRef} />
              </div>

              {selectedChat && (
                <form onSubmit={handleSend} className="p-3 border-t border-brand-border flex gap-2 flex-shrink-0">
                  <input
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    placeholder="Digite uma mensagem…"
                    maxLength={4096}
                    className="flex-1 bg-brand-elevated border border-brand-border rounded-xl px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted outline-none focus:border-brand-primary transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!messageInput.trim() || sending}
                    className="btn-primary px-4 text-sm disabled:opacity-50"
                  >
                    {sending ? <Spinner size={4} /> : 'Enviar'}
                  </button>
                </form>
              )}
              {sendError && <p className="text-red-400 text-xs px-3 pb-2 flex-shrink-0">{sendError}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
