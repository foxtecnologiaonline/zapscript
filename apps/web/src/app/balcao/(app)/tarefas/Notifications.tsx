'use client';
/** Notificações da pessoa (GET /tasks/notifications; POST …/:id/read; POST …/read-all). */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtAgo, fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Checkbox, EmptyState, LoadMore, Spinner, useToast } from '../../_ui/ui';

interface Notif { id: string; type: string; title: string; body: string | null; data: { taskId?: string; code?: string } | null; readAt: string | null; createdAt: string }
interface Res { items: Notif[]; nextCursor: string | null; unread: number }

export default function Notifications({ onUnread }: { onUnread: (n: number) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Notif[]>([]); const [next, setNext] = useState<string | null>(null); const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true); const [more, setMore] = useState(false); const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setMore(true); else { setLoading(true); setError(null); }
    try {
      const r = await bv.get<Res>('/tasks/notifications', { unread: onlyUnread ? '1' : undefined, limit: 30, cursor });
      setItems((c) => (cursor ? [...c, ...r.items] : r.items)); setNext(r.nextCursor); setUnread(r.unread); onUnread(r.unread);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); setMore(false); }
  }, [onlyUnread, onUnread]);
  useEffect(() => { void load(); }, [load]);

  const markRead = async (n: Notif) => {
    try { const r = await bv.post<{ unread: number }>(`/tasks/notifications/${n.id}/read`); setItems((l) => (onlyUnread ? l.filter((x) => x.id !== n.id) : l.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)))); setUnread(r.unread); onUnread(r.unread); setAnnounce('Notificação marcada como lida.'); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const markAll = async () => {
    try { await bv.post('/tasks/notifications/read-all'); setUnread(0); onUnread(0); setItems((l) => (onlyUnread ? [] : l.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))); setAnnounce('Todas as notificações foram marcadas como lidas.'); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Checkbox label="Mostrar só não lidas" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
        <div className="flex items-center gap-3"><span className="text-sm" aria-live="polite">{unread} não lida(s)</span><Button variant="secondary" onClick={() => void markAll()} disabled={!unread}>Marcar todas como lidas</Button></div>
      </div>
      <div role="status" className="bv-sr-only">{announce}</div>
      {error && <Banner tone="danger" title="Não foi possível carregar as notificações">{error}</Banner>}
      {loading ? <div className="flex justify-center p-8"><Spinner size={28} /></div> : !items.length && !error ? <EmptyState title={onlyUnread ? 'Nenhuma notificação não lida' : 'Você não tem notificações'} /> : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-bv-border bg-bv-surface p-3">
              <div>
                <p className="font-medium">{n.title} {n.readAt ? <Badge tone="neutral">Lida</Badge> : <Badge tone="primary">Não lida</Badge>}</p>
                {n.body && <p className="text-sm">{n.body}</p>}
                <p className="text-xs text-bv-muted"><time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>{fmtAgo(n.createdAt)}</time> · {fmtDateTime(n.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                {n.data?.taskId && <Link className="inline-flex min-h-[32px] items-center rounded-md border border-bv-border px-3 text-sm hover:bg-bv-subtle" href={`/balcao/tarefas/${n.data.taskId}`} onClick={() => { if (!n.readAt) void markRead(n); }}>Abrir {n.data.code ?? 'tarefa'}</Link>}
                {!n.readAt && <Button size="sm" variant="secondary" onClick={() => void markRead(n)}>Marcar como lida</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={!!next} loading={more} onClick={() => next && void load(next)} />
    </div>
  );
}
