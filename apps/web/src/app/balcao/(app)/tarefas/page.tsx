'use client';
/** Tarefas e service desk. Abas sincronizadas com ?aba= (quadro | lista | caixa | notificacoes | servicedesk); ?nova=1[&conversa=ID] abre a criação. */
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { bv } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { Badge, Banner, Button, PageHeader, Spinner, cx } from '../../_ui/ui';
import Board from './Board';
import { InboxTab, ListTab } from './ListTab';
import Notifications from './Notifications';
import ServiceDesk from './ServiceDesk';
import { NewTaskDialog, type Kind, type Status } from './common';
import type { Filters } from './TaskFilters';

type TabId = 'quadro' | 'lista' | 'caixa' | 'notificacoes' | 'servicedesk';

function TarefasInner() {
  const { can, canAny, status } = useBvSession();
  const router = useRouter();
  const sp = useSearchParams();
  const [unread, setUnread] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [preset, setPreset] = useState<Partial<Filters> | undefined>(() => (sp.get('q') ? { q: sp.get('q') ?? '' } : undefined));
  const [newOpen, setNewOpen] = useState(false);
  const [newKind, setNewKind] = useState<Kind | undefined>();
  const conversa = sp.get('conversa');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabs: Array<{ id: TabId; title: string }> = [
    { id: 'quadro', title: 'Quadro' }, { id: 'lista', title: 'Lista' }, { id: 'caixa', title: 'Minha caixa' },
    { id: 'notificacoes', title: `Notificações${unread ? ` (${unread})` : ''}` },
    ...(can('report:read') ? [{ id: 'servicedesk' as TabId, title: 'Service desk' }] : []),
  ];
  const wanted = sp.get('aba') as TabId | null;
  const active: TabId = tabs.some((t) => t.id === wanted) ? (wanted as TabId) : 'quadro';
  const go = useCallback((id: TabId, extra?: Record<string, string>) => {
    const p = new URLSearchParams(); p.set('aba', id); Object.entries(extra ?? {}).forEach(([k, v]) => p.set(k, v));
    router.replace(`/balcao/tarefas?${p.toString()}`);
  }, [router]);

  useEffect(() => { const q = sp.get('q'); if (q) setPreset({ q }); }, [sp]);
  useEffect(() => { if (sp.get('nova') === '1' || conversa) setNewOpen(true); }, [sp, conversa]);
  useEffect(() => {
    if (status !== 'authed' || !can('task:read')) return;
    bv.get<{ unread: number }>('/tasks/notifications/unread-count').then((r) => setUnread(r.unread)).catch(() => undefined);
  }, [status, can]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? tabs.length - 1 - i : 0;
    if (!d) return;
    e.preventDefault();
    const n = tabs[(i + d + tabs.length) % tabs.length]; go(n.id); refs.current[n.id]?.focus();
  };

  if (status === 'authed' && !canAny(['task:read', 'task:write'])) return <><PageHeader title="Tarefas e demandas" /><Banner tone="warning" title="Acesso restrito">Seu perfil não tem acesso a tarefas.</Banner></>;
  const openNew = (k?: Kind) => { setNewKind(k); setNewOpen(true); };
  const closeNew = () => { setNewOpen(false); if (sp.get('nova') || conversa) go(active); };

  return (
    <div>
      <PageHeader title="Tarefas e demandas" subtitle="Quadro, listas, caixas, avisos e service desk (solicitações à contratada)."
        actions={can('task:write') ? <Button onClick={() => openNew()}>Nova tarefa</Button> : undefined} />
      <div role="tablist" aria-label="Seções de tarefas" className="mb-4 flex flex-wrap gap-1 border-b border-bv-border">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1} onClick={() => go(t.id)} onKeyDown={(e) => onKey(e, i)}
            className={cx('min-h-[40px] px-4 text-sm font-medium', active === t.id ? 'border-b-2 border-bv-primary text-bv-primary' : 'text-bv-muted hover:text-bv-text')}>{t.title}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active === 'quadro' && <Board refreshKey={refreshKey} onSeeAll={(s: Status) => { setPreset({ status: s }); go('lista'); }} />}
        {active === 'lista' && <ListTab preset={preset} refreshKey={refreshKey} />}
        {active === 'caixa' && <InboxTab refreshKey={refreshKey} />}
        {active === 'notificacoes' && <Notifications onUnread={setUnread} />}
        {active === 'servicedesk' && <ServiceDesk refreshKey={refreshKey} onNew={() => openNew('SERVICE_REQUEST')} />}
      </div>
      <NewTaskDialog open={newOpen} onClose={closeNew} presetKind={newKind} presetConversationId={conversa} onCreated={() => setRefreshKey((k) => k + 1)} />
      {unread > 0 && active !== 'notificacoes' && <p className="mt-4 text-sm"><Badge tone="primary">{unread}</Badge> notificação(ões) não lida(s). <button type="button" className="underline" onClick={() => go('notificacoes')}>Ver notificações</button></p>}
    </div>
  );
}

export default function TarefasPage() {
  return <Suspense fallback={<div className="flex justify-center p-10"><Spinner size={28} /></div>}><TarefasInner /></Suspense>;
}
