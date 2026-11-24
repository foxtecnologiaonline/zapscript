'use client';
import React, { useRef, useState } from 'react';
import { fmtAgo, fmtDuration, STATUS_LABEL, CHANNEL_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Button, LoadMore, Select, Spinner, TextField, cx } from '../../_ui/ui';
import { ChannelTag } from './Icons';
import { priorityLabel, slaInfo, waitSeconds, type ListFilters } from './lib';
import type { ConvListItem, SortMode, TabId } from './types';

const SORT_LABEL: Record<SortMode, string> = { priority: 'Prioridade', wait: 'Maior tempo de espera', recent: 'Mais recentes' };
const TAB_LABEL: Record<TabId, string> = { mine: 'Minhas', queue: 'Na fila', all: 'Todas' };

interface Props {
  items: ConvListItem[]; loading: boolean; error: string | null; onRetry: () => void;
  tabs: TabId[]; tab: TabId; onTab: (t: TabId) => void; queueCount: number | null;
  filters: ListFilters; onFilters: (f: Partial<ListFilters>) => void;
  selectedId: string | null; onSelect: (id: string) => void; canPickup: boolean; pickingId: string | null; onPickup: (id: string) => void;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; now: number;
}

export function ConversationList(p: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [roving, setRoving] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = p.items; // já filtrada e ordenada pelo console
  const rovingId = shown.some((c) => c.id === roving) ? roving : shown.some((c) => c.id === p.selectedId) ? p.selectedId : shown[0]?.id ?? null;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? p.tabs.length - 1 - i : 0;
    if (!d) return;
    e.preventDefault();
    const n = p.tabs[(i + d + p.tabs.length) % p.tabs.length];
    p.onTab(n);
    requestAnimationFrame(() => document.getElementById(`bv-conv-tab-${n}`)?.focus());
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-conv-btn]') ?? []);
    if (!btns.length) return;
    const cur = btns.indexOf(document.activeElement as HTMLElement);
    // só intercepta quando o foco está num item da lista (não nos botões "Assumir")
    if (cur < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : Math.min(btns.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)));
    btns[next].focus();
  };

  const queueLabel = p.queueCount == null ? '' : ` (${p.queueCount >= 100 ? '99+' : p.queueCount})`;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-bv-border bg-bv-surface">
      <h2 className="bv-sr-only">Lista de conversas</h2>
      <div role="tablist" aria-label="Conversas por situação" className="flex border-b border-bv-border">
        {p.tabs.map((t, i) => (
          <button key={t} id={`bv-conv-tab-${t}`} type="button" role="tab" aria-selected={p.tab === t} aria-controls="bv-conv-panel"
            tabIndex={p.tab === t ? 0 : -1} onClick={() => p.onTab(t)} onKeyDown={(e) => onTabKey(e, i)}
            className={cx('min-h-[40px] flex-1 px-2 text-sm font-medium', p.tab === t ? 'border-b-2 border-bv-primary text-bv-primary' : 'text-bv-muted hover:text-bv-text')}>
            {TAB_LABEL[t]}{t === 'queue' && p.tab !== 'queue' ? queueLabel : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-b border-bv-border p-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField label="Buscar conversa" type="search" placeholder="Protocolo, nome ou assunto" value={p.filters.text} autoComplete="off"
              onChange={(e) => p.onFilters({ text: e.target.value })} id="bv-conv-search" />
          </div>
          <Button variant="secondary" aria-expanded={showFilters} aria-controls="bv-conv-filters" onClick={() => setShowFilters((v) => !v)}>Filtros</Button>
        </div>
        {showFilters && (
          <div id="bv-conv-filters" className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <Select label="Canal" value={p.filters.channel} onChange={(e) => p.onFilters({ channel: e.target.value })}>
              <option value="">Todos os canais</option>
              {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {p.tab !== 'queue' && (
              <Select label="Situação" value={p.filters.status} onChange={(e) => p.onFilters({ status: e.target.value })}>
                <option value="">Abertas</option>
                <option value="ACTIVE">{STATUS_LABEL.ACTIVE}</option>
                <option value="WAITING">{STATUS_LABEL.WAITING}</option>
                {p.tab === 'all' && <option value="BOT">{STATUS_LABEL.BOT}</option>}
                <option value="CLOSED">{STATUS_LABEL.CLOSED}</option>
              </Select>
            )}
            <Select label="Ordenar por" value={p.filters.sort} onChange={(e) => p.onFilters({ sort: e.target.value as SortMode })}>
              {(Object.keys(SORT_LABEL) as SortMode[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </Select>
          </div>
        )}
      </div>

      <div id="bv-conv-panel" role="tabpanel" aria-labelledby={`bv-conv-tab-${p.tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {p.loading ? (
          <div className="flex justify-center p-8"><Spinner label="Carregando conversas" /></div>
        ) : p.error ? (
          <div className="flex flex-col items-start gap-2 p-3"><Banner tone="danger" title="Não foi possível carregar as conversas">{p.error}</Banner><Button variant="secondary" onClick={p.onRetry}>Tentar de novo</Button></div>
        ) : shown.length === 0 ? (
          <div className="p-6 text-center text-sm text-bv-muted">
            <p className="font-medium text-bv-text">{p.tab === 'queue' ? 'Nenhuma conversa aguardando na fila.' : p.filters.text || p.filters.channel || p.filters.status ? 'Nenhuma conversa com esses filtros.' : p.tab === 'mine' ? 'Você não tem conversas em atendimento.' : 'Nenhuma conversa encontrada.'}</p>
            {p.tab === 'mine' && <p className="mt-1">Veja a aba “Na fila” para assumir um atendimento.</p>}
          </div>
        ) : (
          <>
            <p className="px-3 pt-2 text-xs text-bv-muted">{shown.length} {shown.length === 1 ? 'conversa' : 'conversas'}{p.hasMore ? ' carregadas' : ''}</p>
            <ul ref={listRef} className="flex flex-col" onKeyDown={onListKey} aria-label={`Conversas — ${TAB_LABEL[p.tab]}`}>
              {shown.map((c) => (
                <ConversationRow key={c.id} c={c} now={p.now} selected={c.id === p.selectedId} tabbable={c.id === rovingId}
                  onFocusRow={() => setRoving(c.id)} onSelect={() => p.onSelect(c.id)}
                  canPickup={p.canPickup && c.status === 'WAITING' && !c.assignedUserId} picking={p.pickingId === c.id} onPickup={() => p.onPickup(c.id)} />
              ))}
            </ul>
            <div className="px-3 pb-3"><LoadMore hasMore={p.hasMore} loading={p.loadingMore} onClick={p.onLoadMore} /></div>
          </>
        )}
      </div>
    </div>
  );
}

const ConversationRow = React.memo(function ConversationRow({ c, now, selected, tabbable, onFocusRow, onSelect, canPickup, picking, onPickup }: {
  c: ConvListItem; now: number; selected: boolean; tabbable: boolean; onFocusRow: () => void; onSelect: () => void; canPickup: boolean; picking: boolean; onPickup: () => void;
}) {
  const sla = slaInfo(c, now);
  const wait = waitSeconds(c, now);
  const prio = priorityLabel(c.priority);
  return (
    <li className={cx('border-b border-bv-border', selected && 'bg-bv-primary-soft')} onFocus={onFocusRow}>
      <button type="button" data-conv-btn aria-current={selected ? 'true' : undefined} tabIndex={tabbable ? 0 : -1} onClick={onSelect}
        className={cx('flex w-full flex-col gap-1 border-l-4 px-3 py-2 text-left hover:bg-bv-subtle', selected ? 'border-bv-primary' : 'border-transparent')}>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{c.contact?.name || 'Cidadão sem nome'}</span>
          {c.unreadForAgent > 0 && <span className="shrink-0 rounded-full bg-bv-danger px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${c.unreadForAgent} ${c.unreadForAgent === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`}>{c.unreadForAgent}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-bv-muted">
          <span className="font-mono">{c.protocol}</span>
          <ChannelTag channel={c.channel} />
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={c.status === 'WAITING' ? 'warning' : c.status === 'ACTIVE' ? 'primary' : 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
          {sla && <Badge tone={sla.tone}>{sla.label}{sla.detail ? ` · ${sla.detail}` : ''}</Badge>}
          {prio && <Badge tone="neutral">{prio}</Badge>}
        </span>
        <span className="text-xs text-bv-muted">
          {wait != null ? `Aguardando há ${fmtDuration(wait)}` : c.status === 'CLOSED' ? `Encerrada ${fmtAgo(c.closedAt, now)}` : c.lastMessageAt ? `Última mensagem ${fmtAgo(c.lastMessageAt, now)}` : 'Sem mensagens'}
          {c.queue ? ` · Fila ${c.queue.name}` : ''}
        </span>
        {(c.subject || c.category) && <span className="truncate text-xs text-bv-muted">{c.subject || c.category}</span>}
      </button>
      {canPickup && (
        <div className="px-3 pb-2 pl-4">
          <Button size="sm" variant="secondary" loading={picking} tabIndex={tabbable ? 0 : -1} onClick={onPickup} aria-label={`Assumir conversa ${c.protocol}`}>Assumir</Button>
        </div>
      )}
    </li>
  );
});
