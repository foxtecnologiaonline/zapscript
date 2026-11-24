'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { useBvSocket } from '@/lib/balcao/socket';
import { CHANNEL_LABEL } from '@/lib/balcao/format';
import { Button, cx, useToast } from '../../_ui/ui';
import { CitizenPanel } from './CitizenPanel';
import { ConversationList } from './ConversationList';
import { ConversationView, type ViewAction } from './ConversationView';
import { CloseDialog, HelpDialog, PreviewDialog, SummaryDialog, TaskDialog, TemplateDialog, TransferDialog } from './Dialogs';
import { isTypingTarget, useAnnouncer, useConversationRoom, useDebouncedCallback, useNow } from './hooks';
import {
  DEFAULT_SORT, applyUpdate, attachmentPath, buildListQuery, canPreview, looksLikeProtocol, matchesSearch, neighborId, preview, sortConversations, upsertMessage, type ListFilters,
} from './lib';
import { api } from './service';
import type { Attachment, CannedResponse, ChatMessage, ComposerHandle, ConvCore, ConvDetail, ConvListItem, Suggestion, TabId } from './types';

type View = 'list' | 'chat' | 'info';
type Dlg = ViewAction | 'help' | null;

const TAB_LABEL: Record<TabId, string> = { mine: 'Minhas', queue: 'Na fila', all: 'Todas' };

export default function AtendimentoConsole() {
  const { me, token, can } = useBvSession();
  const toast = useToast();
  const params = useSearchParams();
  const now = useNow();
  const { announce, liveText } = useAnnouncer();
  const meId = me?.user.id ?? '';

  const canReadAll = can('conversation:read_all');
  const canReplyPerm = can('conversation:reply');
  const tabs: TabId[] = useMemo(() => (canReadAll ? ['mine', 'queue', 'all'] : ['mine', 'queue']), [canReadAll]);

  // ── lista ──
  const [tab, setTab] = useState<TabId>('mine');
  const [filters, setFilters] = useState<ListFilters>({ text: '', channel: '', status: '', sort: DEFAULT_SORT.mine });
  const [debouncedText, setDebouncedText] = useState('');
  const [items, setItems] = useState<ConvListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  // ── conversa aberta ──
  const [selectedId, setSelectedId] = useState<string | null>(params.get('c'));
  const [view, setView] = useState<View>(params.get('c') ? 'chat' : 'list');
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [canned, setCanned] = useState<CannedResponse[] | null>(null);
  const [cannedLoading, setCannedLoading] = useState(false);
  const [dialog, setDialog] = useState<Dlg>(null);
  const [previewing, setPreviewing] = useState<{ name: string; mime: string; url: string } | null>(null);
  const [tasksVersion, setTasksVersion] = useState(0);

  const composerRef = useRef<ComposerHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const itemsRef = useRef(items); itemsRef.current = items;
  const detailRef = useRef(detail); detailRef.current = detail;
  const tabRef = useRef(tab); tabRef.current = tab;
  const needSync = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── carregamento da lista ──
  const serverFilters = useMemo(() => ({ ...filters, text: debouncedText }), [filters.channel, filters.status, filters.sort, debouncedText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setDebouncedText(looksLikeProtocol(filters.text) ? filters.text.trim() : ''), 350); return () => clearTimeout(t); }, [filters.text]);

  const listSeq = useRef(0);
  const loadList = useCallback(async (opts: { silent?: boolean } = {}) => {
    const seq = ++listSeq.current;
    if (!opts.silent) { setListLoading(true); setListError(null); }
    try {
      const r = await api.listConversations(buildListQuery(tab, serverFilters));
      if (seq !== listSeq.current) return;
      setItems(r.items); setNextCursor(r.nextCursor); setListError(null);
      if (!opts.silent) announce(`${r.items.length} ${r.items.length === 1 ? 'conversa' : 'conversas'} em ${TAB_LABEL[tab]}.`);
    } catch (e) {
      if (seq === listSeq.current && !opts.silent) { setListError(errMsg(e)); setItems([]); setNextCursor(null); }
    } finally { if (seq === listSeq.current) setListLoading(false); }
  }, [tab, serverFilters, announce]);
  useEffect(() => { void loadList(); }, [loadList]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await api.listConversations(buildListQuery(tab, serverFilters, nextCursor));
      setItems((l) => { const seen = new Set(l.map((c) => c.id)); return [...l, ...r.items.filter((c) => !seen.has(c.id))]; });
      setNextCursor(r.nextCursor);
    } catch (e) { toast.error(errMsg(e)); } finally { setLoadingMore(false); }
  };

  const refreshQueueCount = useCallback(async () => {
    try { setQueueCount((await api.listConversations({ unassigned: true, status: 'WAITING', limit: 100 })).items.length); } catch { /* contador é opcional */ }
  }, []);
  useEffect(() => { void refreshQueueCount(); }, [refreshQueueCount]);

  // ── carregamento da conversa ──
  const markRead = useDebouncedCallback((id: string) => {
    if (selectedRef.current !== id || document.visibilityState === 'hidden') return;
    void api.markRead(id).catch(() => undefined);
    setItems((l) => l.map((c) => (c.id === id && c.unreadForAgent ? { ...c, unreadForAgent: 0 } : c)));
  }, 400);

  const detailSeq = useRef(0);
  const loadDetail = useCallback(async (id: string, opts: { silent?: boolean } = {}) => {
    const seq = ++detailSeq.current;
    if (!opts.silent) { setDetailLoading(true); setDetailError(null); }
    try {
      const d = await api.getConversation(id);
      if (seq !== detailSeq.current) return;
      setDetail(d); setDetailError(null);
      if (d.conversation.unreadForAgent > 0) markRead(id);
      if (!opts.silent) {
        const lastOut = [...d.messages].reverse().find((m) => m.direction === 'OUT' && m.senderType === 'AGENT');
        api.lastSuggestion(id).then((r) => {
          const s = r.suggestion;
          if (seq !== detailSeq.current || !s?.suggestion || !d.canReply) return;
          if (lastOut && Date.parse(lastOut.createdAt) >= Date.parse(s.at)) return;
          setSuggestion({ suggestion: s.suggestion, confidence: s.confidence ?? 0, articles: [], conversationId: id });
        }).catch(() => undefined);
      }
    } catch (e) {
      if (seq !== detailSeq.current) return;
      setDetailError(errMsg(e));
      if (!opts.silent) setDetail(null);
    } finally { if (seq === detailSeq.current) setDetailLoading(false); }
  }, [markRead]);

  useEffect(() => {
    setSuggestion(null);
    if (!selectedId) { detailSeq.current++; setDetail(null); setDetailError(null); return; }
    setDetail(null);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);
  useConversationRoom(token, selectedId);

  // foco no cabeçalho da conversa depois de abrir por clique/Enter (não em J/K)
  useEffect(() => {
    if (focusHeading.current && detail && detail.conversation.id === selectedId) { focusHeading.current = false; headingRef.current?.focus(); }
  }, [detail, selectedId]);
  useEffect(() => { document.getElementById('bv-conv-panel')?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedId]);

  // ?c=<id> alterado de fora (link direto, voltar do navegador)
  const paramId = params.get('c');
  useEffect(() => { if (paramId !== selectedRef.current) { setSelectedId(paramId); setView(paramId ? 'chat' : 'list'); } }, [paramId]);

  const select = useCallback((id: string | null, o: { focus?: boolean } = {}) => {
    focusHeading.current = !!o.focus && !!id;
    setSelectedId(id); setView(id ? 'chat' : 'list');
    try { window.history.replaceState(window.history.state, '', id ? `/balcao/atendimento?c=${encodeURIComponent(id)}` : '/balcao/atendimento'); } catch { /* URL é só conveniência */ }
  }, []);

  const changeTab = useCallback((t: TabId) => {
    if (t === tabRef.current) return;
    setTab(t); setFilters((f) => ({ ...f, status: '', sort: DEFAULT_SORT[t] }));
  }, []);

  // ── ações ──
  const pickup = useCallback(async (id: string) => {
    setPickingId(id);
    try {
      await api.pickup(id);
      toast.success('Conversa assumida. Ela agora está em “Minhas”.');
      if (tabRef.current === 'queue') changeTab('mine');
      select(id, { focus: true });
      if (selectedRef.current === id) void loadDetail(id, { silent: true });
      void loadList({ silent: true }); void refreshQueueCount();
    } catch (e) { toast.error(errMsg(e, 'Não foi possível assumir a conversa.')); void loadList({ silent: true }); void refreshQueueCount(); }
    finally { setPickingId(null); }
  }, [toast, changeTab, select, loadDetail, loadList, refreshQueueCount]);

  const afterChange = useCallback((c: ConvCore) => {
    setItems((l) => l.map((x) => (x.id === c.id ? { ...x, ...c, contact: x.contact, queue: x.queue, assignee: x.assignee } : x)));
    void loadDetail(c.id, { silent: true }); void loadList({ silent: true }); void refreshQueueCount();
  }, [loadDetail, loadList, refreshQueueCount]);

  const onSent = useCallback((m: ChatMessage) => {
    setDetail((d) => (d ? { ...d, messages: upsertMessage(d.messages, m) } : d));
    setItems((l) => l.map((c) => (c.id === selectedRef.current ? { ...c, lastMessageAt: m.createdAt, unreadForAgent: 0 } : c)));
  }, []);

  const needCanned = useCallback(() => {
    setCannedLoading(true);
    api.listCanned().then((r) => setCanned(r.items)).catch((e) => { setCanned([]); toast.error(errMsg(e, 'Não foi possível carregar as respostas prontas.')); }).finally(() => setCannedLoading(false));
  }, [toast]);

  const suggest = useCallback(async () => {
    const id = selectedRef.current; if (!id || !canReplyPerm) return;
    setSuggestionBusy(true);
    try {
      const s = await api.aiSuggest(id);
      if (selectedRef.current === id) { setSuggestion(s); announce('Sugestão de resposta da IA pronta. Revise antes de enviar.'); }
    } catch (e) { toast.error(errMsg(e, 'Não foi possível gerar a sugestão agora.')); } finally { setSuggestionBusy(false); }
  }, [announce, canReplyPerm, toast]);

  const openPreview = useCallback(async (conversationId: string, att: Attachment) => {
    if (!canPreview(att)) return;
    try { setPreviewing({ name: att.name, mime: att.mime, url: await bv.blobUrl(attachmentPath(conversationId, att.key), { inline: 1 }) }); }
    catch (e) { toast.error(errMsg(e, 'Não foi possível abrir o anexo.')); }
  }, [toast]);
  const closePreview = useCallback(() => setPreviewing((p) => { if (p) URL.revokeObjectURL(p.url); return null; }), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const act = useCallback((a: ViewAction) => { if (a === 'transfer' || a === 'close' || a === 'task' || a === 'summary' || a === 'template') setDialog(a); }, []);

  // ── tempo real ──
  const scheduleReload = useDebouncedCallback(() => { void loadList({ silent: true }); void refreshQueueCount(); }, 700);
  const scheduleDetail = useDebouncedCallback((id: string) => { if (selectedRef.current === id) void loadDetail(id, { silent: true }); }, 600);
  const nameOf = (id: string) => { const c = itemsRef.current.find((x) => x.id === id); return c ? `${c.protocol}${c.contact?.name ? ` (${c.contact.name})` : ''}` : 'outra conversa'; };

  useBvSocket(token, {
    'conversation:new': (p: any) => { scheduleReload(); if (p?.status === 'WAITING') announce(`Nova conversa na fila: ${p.protocol}, ${CHANNEL_LABEL[p.channel] ?? p.channel}.`); },
    'conversation:queued': (p: any) => { scheduleReload(); announce(`Nova conversa na fila: ${p?.protocol ?? ''}, ${CHANNEL_LABEL[p?.channel] ?? p?.channel ?? ''}.`); },
    'conversation:assigned': (p: any) => { scheduleReload(); toast.info(`Conversa ${p?.protocol ?? ''} atribuída a você (${CHANNEL_LABEL[p?.channel] ?? p?.channel ?? 'canal'}).`); },
    'conversation:updated': (p: any) => {
      if (!p?.id) return;
      const known = itemsRef.current.some((c) => c.id === p.id);
      if (known) setItems((l) => l.map((c) => (c.id === p.id ? applyUpdate(c, p) : c)));
      const cur = detailRef.current?.conversation;
      if (cur && cur.id === p.id && ((p.status !== undefined && p.status !== cur.status) || (p.assignedUserId !== undefined && p.assignedUserId !== cur.assignedUserId))) scheduleDetail(p.id);
      if (!known || p.status !== undefined || p.assignedUserId !== undefined) scheduleReload();
    },
    'conversation:taken_over': (p: any) => { scheduleReload(); if (p?.id) { announce(`Um supervisor assumiu a conversa ${nameOf(p.id)}.`); if (p.id === selectedRef.current) scheduleDetail(p.id); } },
    'conversation:closed': (p: any) => {
      if (!p?.id) return;
      const transferred = p.reason === 'TRANSFERRED';
      if (transferred && tabRef.current === 'mine') setItems((l) => l.filter((c) => c.id !== p.id));
      else setItems((l) => l.map((c) => (c.id === p.id ? { ...c, status: 'CLOSED' } : c)));
      announce(transferred ? `Conversa ${nameOf(p.id)} transferida.` : `Conversa ${nameOf(p.id)} encerrada.`);
      if (p.id === selectedRef.current) scheduleDetail(p.id);
      scheduleReload();
    },
    'message:new': (p: any) => {
      const m = p?.message as ChatMessage | undefined; const id = p?.conversationId as string | undefined;
      if (!m || !id) return;
      if (id === selectedRef.current) {
        setDetail((d) => (d && d.conversation.id === id ? { ...d, messages: upsertMessage(d.messages, m) } : d));
        if (m.direction === 'IN') {
          const d = detailRef.current;
          announce(`Nova mensagem de ${d?.contact?.name || 'cidadão'}: ${preview(m.body) || (m.attachments?.length ? 'anexo recebido' : 'mensagem sem texto')}`);
          markRead(id);
        }
      } else if (m.direction === 'IN') {
        announce(`Nova mensagem em ${nameOf(id)}.`);
      }
      if (m.direction !== 'INTERNAL') setItems((l) => {
        const hit = l.some((c) => c.id === id);
        if (!hit) { scheduleReload(); return l; }
        return l.map((c) => (c.id === id ? { ...c, lastMessageAt: m.createdAt, ...(m.direction === 'IN' && id !== selectedRef.current ? { unreadForAgent: c.unreadForAgent + 1 } : {}), ...(m.direction === 'IN' ? { lastInboundAt: m.createdAt } : {}) } : c));
      });
    },
    'message:status': (p: any) => {
      if (p?.conversationId !== selectedRef.current) return;
      setDetail((d) => (d ? { ...d, messages: d.messages.map((m) => (m.id === p.messageId ? { ...m, status: p.status, errorCode: p.errorCode ?? null } : m)) } : d));
    },
    'message:attachments': (p: any) => {
      if (p?.conversationId !== selectedRef.current) return;
      setDetail((d) => (d ? { ...d, messages: d.messages.map((m) => (m.id === p.messageId ? { ...m, attachments: p.attachments } : m)) } : d));
    },
    typing: (p: any) => {
      if (p?.from !== 'CONTACT' || p.conversationId !== selectedRef.current) return;
      setTypingId(p.conversationId);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingId(null), 5000);
    },
    'ai:suggestion': (p: Suggestion) => {
      if (p?.conversationId !== selectedRef.current) return;
      setSuggestion(p); announce('Nova sugestão de resposta da IA disponível. Revise antes de enviar.');
    },
    'sla:breach': (p: any) => { if (p?.conversationId) setItems((l) => l.map((c) => (c.id === p.conversationId ? { ...c, slaBreached: true } : c))); },
    disconnect: () => { needSync.current = true; },
    connect: () => {
      if (!needSync.current) return;
      needSync.current = false; scheduleReload();
      if (selectedRef.current) scheduleDetail(selectedRef.current);
    },
  });
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);
  useEffect(() => () => { setPreviewing((p) => { if (p) URL.revokeObjectURL(p.url); return null; }); }, []);

  // ── lista exibida (filtro local + ordenação) ──
  const shown = useMemo(() => sortConversations(items.filter((c) => matchesSearch(c, filters.text)), filters.sort), [items, filters.text, filters.sort]);
  const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);

  // ── atalhos de teclado ──
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (document.querySelector('[role="dialog"]')) return;
    const d = detailRef.current; const c = d?.conversation;
    const closed = c?.status === 'CLOSED';
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const stop = () => e.preventDefault();
    switch (k) {
      case 'j': case 'k': { stop(); const id = neighborId(shownIds, selectedRef.current, k === 'j' ? 1 : -1); if (id && id !== selectedRef.current) select(id); break; }
      case 'r': if (c) { stop(); setView('chat'); composerRef.current?.focus('reply'); } break;
      case 'n': if (c) { stop(); setView('chat'); composerRef.current?.focus('note'); } break;
      case 't': if (c && !closed && d?.canReply && can('conversation:transfer')) { stop(); setDialog('transfer'); } break;
      case 'e': if (c && !closed && d?.canReply && can('conversation:close')) { stop(); setDialog('close'); } break;
      case 'a': if (c && c.status === 'WAITING' && !c.assignedUserId && canReplyPerm) { stop(); void pickup(c.id); } break;
      case 's': if (c && d?.canReply && !closed) { stop(); void suggest(); } break;
      case '/': stop(); setView('list'); requestAnimationFrame(() => document.getElementById('bv-conv-search')?.focus()); break;
      case '?': stop(); setDialog('help'); break;
      default:
    }
  };
  useEffect(() => { const fn = (e: KeyboardEvent) => keys.current(e); document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn); }, []);

  const conv = detail?.conversation ?? null;
  const viewBtn = (v: View, label: string) => (
    <button type="button" aria-pressed={view === v} onClick={() => setView(v)}
      className={cx('min-h-[40px] flex-1 px-3 text-sm font-medium', view === v ? 'bg-bv-primary text-bv-primary-fg' : 'bg-bv-surface hover:bg-bv-subtle')}>{label}</button>
  );

  if (!me) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold" tabIndex={-1} data-bv-page-title>Atendimento</h1>
        <Button variant="secondary" size="sm" aria-keyshortcuts="?" onClick={() => setDialog('help')}>Atalhos de teclado (?)</Button>
      </div>

      <div role="group" aria-label="Seções do atendimento" className="flex overflow-hidden rounded-md border border-bv-border xl:hidden">
        {viewBtn('list', 'Conversas')}{viewBtn('chat', 'Conversa')}{viewBtn('info', 'Cidadão')}
      </div>

      <div className="grid gap-3 xl:h-[calc(100dvh-11rem)] xl:min-h-[520px] xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <section aria-label="Conversas" className={cx('h-[75vh] min-h-[420px] min-w-0 xl:block xl:h-full', view === 'list' ? 'block' : 'hidden')}>
          <ConversationList items={shown} loading={listLoading} error={listError} onRetry={() => void loadList()}
            tabs={tabs} tab={tab} onTab={changeTab} queueCount={queueCount} filters={filters} onFilters={(f) => setFilters((cur) => ({ ...cur, ...f }))}
            selectedId={selectedId} onSelect={(id) => select(id, { focus: true })} canPickup={canReplyPerm} pickingId={pickingId} onPickup={(id) => void pickup(id)}
            hasMore={!!nextCursor} loadingMore={loadingMore} onLoadMore={() => void loadMore()} now={now} />
        </section>

        <section aria-label="Conversa aberta" className={cx('h-[80vh] min-h-[480px] min-w-0 xl:block xl:h-full', view === 'chat' ? 'block' : 'hidden')}>
          <ConversationView detail={detail} loading={detailLoading} error={detailError} onRetry={() => selectedId && void loadDetail(selectedId)}
            meId={meId} token={token} now={now} typing={!!conv && typingId === conv.id}
            onPickup={() => conv && void pickup(conv.id)} picking={!!conv && pickingId === conv.id} onBack={() => setView('list')} onAction={act}
            onPreview={(cid, att) => void openPreview(cid, att)} onSent={onSent} composerRef={composerRef} headingRef={headingRef}
            canned={canned} cannedLoading={cannedLoading} onNeedCanned={needCanned}
            suggestion={suggestion && conv && suggestion.conversationId === conv.id ? suggestion : null} suggestionBusy={suggestionBusy} onSuggest={() => void suggest()} onDismissSuggestion={() => setSuggestion(null)} />
        </section>

        <aside aria-label="Painel do cidadão" className={cx('min-w-0 xl:block xl:h-full xl:overflow-y-auto', view === 'info' ? 'block' : 'hidden')}>
          {conv ? (
            <CitizenPanel conversationId={conv.id} contactId={conv.contactId} contact={detail?.contact ?? null} canReply={!!detail?.canReply && conv.status !== 'CLOSED'}
              composer={composerRef} onOpenConversation={(id) => select(id, { focus: true })} tasksVersion={tasksVersion} />
          ) : <p className="rounded-lg border border-dashed border-bv-border p-6 text-center text-sm text-bv-muted">Abra uma conversa para ver os dados do cidadão, consultar processos e buscar na base de conhecimento.</p>}
        </aside>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="bv-sr-only">{liveText}</div>

      {dialog === 'help' && <HelpDialog onClose={closeDialog} />}
      {dialog === 'transfer' && conv && <TransferDialog conversationId={conv.id} currentQueueId={conv.queueId} meId={meId} canPickAgent={can('conversation:monitor')} onClose={closeDialog} onDone={afterChange} />}
      {dialog === 'close' && conv && <CloseDialog conversationId={conv.id} protocol={conv.protocol} onClose={closeDialog} onDone={afterChange} />}
      {dialog === 'task' && conv && <TaskDialog conversationId={conv.id} defaultTitle={conv.subject ?? ''} canListSectors={can('user:manage') || can('queue:manage')} ownSectorId={me.user.sectorId} onClose={closeDialog} onDone={() => setTasksVersion((v) => v + 1)} />}
      {dialog === 'summary' && conv && <SummaryDialog conversationId={conv.id} canNote onClose={closeDialog} onInsertNote={(t) => composerRef.current?.insert(t, 'note')} />}
      {dialog === 'template' && conv && <TemplateDialog conversationId={conv.id} onClose={closeDialog} onDone={() => void loadDetail(conv.id, { silent: true })} />}
      {previewing && <PreviewDialog name={previewing.name} mime={previewing.mime} url={previewing.url} onClose={closePreview} />}
    </div>
  );
}
