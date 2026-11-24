'use client';
/** Lista (filtros + cursor) e caixas ("Minhas tarefas", "Caixa do setor", "Sem responsável") com "Assumir". GET /tasks, POST /tasks/:id/claim. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, DataTable, EmptyState, LoadMore, Select, Spinner, useToast, type Column } from '../../_ui/ui';
import { KIND_LABEL, DueInfo, PriorityBadge, StatusBadge, useLookups, type Task } from './common';
import TaskFilterForm, { NO_FILTERS, OPEN_CSV, filtersToQuery, type Filters } from './TaskFilters';

interface Page { items: Task[]; nextCursor: string | null }

function useTaskPage(extra: Record<string, string | undefined>, f: Filters, refreshKey: number) {
  const [rows, setRows] = useState<Task[]>([]); const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [more, setMore] = useState(false); const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const sig = JSON.stringify([extra, f]);
  const load = useCallback(async (cursor?: string) => {
    if (cursor) setMore(true); else { setLoading(true); setError(null); }
    try {
      const r = await bv.get<Page>('/tasks', { ...filtersToQuery(f), ...extra, limit: 50, cursor });
      setRows((c) => (cursor ? [...c, ...r.items] : r.items)); setNext(r.nextCursor);
      if (!cursor) setAnnounce(`${r.items.length} tarefas${r.nextCursor ? ', há mais resultados' : ''}.`);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); setMore(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return { rows, setRows, next, loading, more, error, load, announce };
}

function Body({ st, cols, caption, empty }: { st: ReturnType<typeof useTaskPage>; cols: Column<Task>[]; caption: string; empty: string }) {
  return (
    <>
      <div role="status" className="bv-sr-only">{st.announce}</div>
      {st.error && <div className="mb-3"><Banner tone="danger" title="Não foi possível carregar as tarefas">{st.error} <Button size="sm" variant="secondary" onClick={() => void st.load()}>Tentar de novo</Button></Banner></div>}
      {st.loading ? <div className="flex justify-center p-8"><Spinner size={28} /></div>
        : !st.error && !st.rows.length ? <EmptyState title={empty} />
        : <DataTable caption={caption} columns={cols} rows={st.rows} rowKey={(t) => t.id} />}
      <LoadMore hasMore={!!st.next} loading={st.more} onClick={() => st.next && void st.load(st.next)} />
    </>
  );
}

const baseCols = (): Column<Task>[] => [
  { key: 'code', header: 'Código', render: (t) => <Link className="font-semibold text-bv-primary underline" href={`/balcao/tarefas/${t.id}`}>{t.code}</Link> },
  { key: 'title', header: 'Título', render: (t) => <span className="font-medium">{t.title}{t.supportLevel ? <> <Badge tone="neutral">{t.supportLevel}</Badge></> : null}</span> },
  { key: 'kind', header: 'Tipo', render: (t) => KIND_LABEL[t.kind] },
  { key: 'st', header: 'Situação', render: (t) => <StatusBadge s={t.status} /> },
  { key: 'pr', header: 'Prioridade', render: (t) => <PriorityBadge p={t.priority} /> },
  { key: 'who', header: 'Responsável / setor', render: (t) => t.assignee?.name ?? (t.sector?.name ? `Caixa: ${t.sector.name}` : 'Sem responsável') },
  { key: 'due', header: 'Prazo e SLA', render: (t) => <DueInfo t={t} /> },
  { key: 'cr', header: 'Criada em', render: (t) => fmtDateTime(t.createdAt) },
];

export function ListTab({ preset, refreshKey }: { preset?: Partial<Filters>; refreshKey: number }) {
  const { me } = useBvSession();
  const [f, setF] = useState<Filters>({ ...NO_FILTERS, ...preset });
  const presetSig = JSON.stringify(preset ?? {});
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setF({ ...NO_FILTERS, ...preset }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [presetSig]);
  const st = useTaskPage({}, f, refreshKey);
  return (
    <div>
      <TaskFilterForm key={presetSig} value={f} onApply={setF} fiscal={me?.user.role === 'FISCAL'} />
      <Body st={st} cols={baseCols()} caption="Tarefas" empty="Nenhuma tarefa encontrada com estes filtros." />
    </div>
  );
}

type Box = 'mine' | 'sector' | 'free';
export function InboxTab({ refreshKey }: { refreshKey: number }) {
  const { me } = useBvSession();
  const lk = useLookups();
  const toast = useToast();
  const [box, setBox] = useState<Box>('mine');
  const [busy, setBusy] = useState<string | null>(null);
  const extra = box === 'mine' ? { mine: '1' } : box === 'sector' ? { inbox: '1' } : { unassigned: '1' };
  const st = useTaskPage(extra, { ...NO_FILTERS, status: OPEN_CSV }, refreshKey);
  const claim = async (t: Task) => {
    setBusy(t.id);
    try { await bv.post(`/tasks/${t.id}/claim`); toast.success(`Você assumiu ${t.code}.`); await st.load(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  const cols: Column<Task>[] = [...baseCols().filter((c) => c.key !== 'cr'), {
    key: 'act', header: 'Ação', render: (t) => (!t.assigneeId
      ? <Button size="sm" loading={busy === t.id} onClick={() => void claim(t)} aria-label={`Assumir ${t.code}`}>Assumir</Button>
      : t.assigneeId === me?.user.id ? <span className="text-sm">Sua tarefa</span> : <span className="text-sm">Com {lk.userName(t.assigneeId)}</span>),
  }];
  return (
    <div>
      <div className="mb-4 max-w-sm">
        <Select label="Caixa" value={box} onChange={(e) => setBox(e.target.value as Box)} hint="Mostra apenas tarefas em aberto (abertas, em andamento ou aguardando).">
          <option value="mine">Minhas tarefas</option>
          <option value="sector" disabled={!me?.user.sectorId}>{me?.user.sectorId ? 'Caixa do meu setor (sem responsável)' : 'Caixa do meu setor (você não tem setor)'}</option>
          <option value="free">Sem responsável (todas as caixas que posso ver)</option>
        </Select>
      </div>
      <Body st={st} cols={cols} caption={box === 'mine' ? 'Minhas tarefas' : box === 'sector' ? 'Caixa do setor' : 'Tarefas sem responsável'} empty={box === 'mine' ? 'Você não tem tarefas em aberto.' : 'Caixa vazia.'} />
    </div>
  );
}
