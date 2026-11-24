'use client';
/**
 * Service desk (TR 8.2.8): solicitações de serviço com nível L1–L4 e SLA/ANS, indicadores ISA1–4/IOSA/IR com glosa INDICATIVA.
 * API: GET /tasks/service-desk/indicators|requests (?from&to&format=csv), GET /tasks?kind=SERVICE_REQUEST.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime, fmtNumber, fmtPercent } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, DataTable, EmptyState, LoadMore, Spinner, StatCard, TextField, useToast, type Column } from '../../_ui/ui';
import { DueInfo, LEVEL_LABEL, PriorityBadge, StatusBadge, type Task } from './common';

interface Indicator { code: string; name: string; level?: string; target: number; direction: 'min' | 'max'; considered: number; onTime?: number; late?: number; value: number | null; met: boolean | null; shortfallPoints: number | null; glosaPercent: number; extra?: Record<string, any> }
interface Indicators { period: { from: string; to: string }; generatedAt: string; totals: { created: number; considered: number; done: number; open: number; cancelled: number }; indicators: Indicator[]; glosaIndicativeTotalPercent: number; disclaimer: string }
interface Req { code: string; title: string; level: string; priority: string; status: string; createdAt: string; respondedAt: string | null; dueAt: string | null; completedAt: string | null; onTime: boolean | null; lateDays: number | null; rating: number | null }

const monthStart = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

export default function ServiceDesk({ onNew, refreshKey }: { onNew: () => void; refreshKey: number }) {
  const { can } = useBvSession();
  const toast = useToast();
  const canReport = can('report:read');
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today());
  const [ind, setInd] = useState<Indicators | null>(null); const [reqs, setReqs] = useState<Req[] | null>(null);
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<Task[]>([]); const [liveNext, setLiveNext] = useState<string | null>(null); const [liveLoading, setLiveLoading] = useState(true); const [liveMore, setLiveMore] = useState(false); const [liveErr, setLiveErr] = useState<string | null>(null);
  const [dl, setDl] = useState<string | null>(null);

  const range = () => ({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() });

  const loadReports = useCallback(async () => {
    if (!canReport) return;
    setLoading(true); setErr(null);
    try {
      const r = range();
      const [i, q] = await Promise.all([bv.get<Indicators>('/tasks/service-desk/indicators', r), bv.get<{ items: Req[] }>('/tasks/service-desk/requests', r)]);
      setInd(i); setReqs(q.items);
    } catch (e) { setErr(errMsg(e)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReport, from, to]);
  useEffect(() => { void loadReports(); }, [loadReports, refreshKey]);

  const loadLive = useCallback(async (cursor?: string) => {
    if (cursor) setLiveMore(true); else { setLiveLoading(true); setLiveErr(null); }
    try {
      const r = await bv.get<{ items: Task[]; nextCursor: string | null }>('/tasks', { kind: 'SERVICE_REQUEST', status: 'OPEN,IN_PROGRESS,WAITING', limit: 50, cursor });
      setLive((c) => (cursor ? [...c, ...r.items] : r.items)); setLiveNext(r.nextCursor);
    } catch (e) { setLiveErr(errMsg(e)); } finally { setLiveLoading(false); setLiveMore(false); }
  }, []);
  useEffect(() => { void loadLive(); }, [loadLive, refreshKey]);

  const exportCsv = async (what: 'indicators' | 'requests') => {
    setDl(what);
    try { await bv.download(`/tasks/service-desk/${what}`, what === 'indicators' ? 'indicadores-service-desk.csv' : 'solicitacoes-de-servico.csv', { ...range(), format: 'csv' }); toast.success('Exportação iniciada.'); }
    catch (e) { toast.error(errMsg(e)); } finally { setDl(null); }
  };

  const indCols: Column<Indicator>[] = [
    { key: 'c', header: 'Indicador', render: (i) => <strong>{i.code}</strong> },
    { key: 'n', header: 'O que mede', render: (i) => i.name },
    { key: 't', header: 'Meta', render: (i) => `${i.direction === 'min' ? 'mínimo' : 'máximo'} ${fmtPercent(i.target, 0)}` },
    { key: 'k', header: 'Considerados', render: (i) => fmtNumber(i.considered) },
    { key: 'o', header: 'No prazo / em atraso', render: (i) => (i.onTime != null ? `${i.onTime} / ${i.late ?? 0}` : i.late != null ? `— / ${i.late}` : '—') },
    { key: 'v', header: 'Resultado', render: (i) => <span>{i.value == null ? 'Sem dados' : fmtPercent(i.value, 2)} {i.met === null ? null : <Badge tone={i.met ? 'success' : 'danger'}>{i.met ? 'Meta atingida' : 'Meta não atingida'}</Badge>}</span> },
    { key: 's', header: 'Pontos abaixo da meta', render: (i) => (i.shortfallPoints == null ? '—' : fmtNumber(i.shortfallPoints, 2)) },
    { key: 'g', header: 'Glosa indicativa', render: (i) => <strong>{fmtPercent(i.glosaPercent, 0)}</strong> },
  ];
  const reqCols: Column<Req>[] = [
    { key: 'c', header: 'Código', render: (r) => <Link className="font-semibold text-bv-primary underline" href={`/balcao/tarefas?aba=lista&q=${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { key: 't', header: 'Título', render: (r) => r.title },
    { key: 'l', header: 'Nível', render: (r) => r.level },
    { key: 's', header: 'Situação', render: (r) => <StatusBadge s={r.status as Task['status']} /> },
    { key: 'cr', header: 'Criada', render: (r) => fmtDateTime(r.createdAt) },
    { key: 'd', header: 'Prazo ANS', render: (r) => fmtDateTime(r.dueAt) },
    { key: 'p', header: 'No prazo?', render: (r) => (r.onTime === null ? (r.lateDays && r.lateDays > 0 ? `Atrasada (${fmtNumber(r.lateDays, 2)} dia(s))` : 'Em andamento') : r.onTime ? 'Sim' : `Não (${fmtNumber(r.lateDays ?? 0, 2)} dia(s) de atraso)`) },
    { key: 'a', header: 'Nota', render: (r) => (r.rating == null ? 'Sem avaliação' : `${r.rating}/10`) },
  ];
  const liveCols: Column<Task>[] = [
    { key: 'c', header: 'Código', render: (t) => <Link className="font-semibold text-bv-primary underline" href={`/balcao/tarefas/${t.id}`}>{t.code}</Link> },
    { key: 't', header: 'Título', render: (t) => t.title },
    { key: 'l', header: 'Nível', render: (t) => (t.supportLevel ? LEVEL_LABEL[t.supportLevel] : 'Automático') },
    { key: 'p', header: 'Prioridade', render: (t) => <PriorityBadge p={t.priority} /> },
    { key: 's', header: 'Situação', render: (t) => <StatusBadge s={t.status} /> },
    { key: 'd', header: 'Prazo e ANS', render: (t) => <DueInfo t={t} /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-bv-muted">Solicitações de serviço à contratada, com prazo conforme o nível de suporte (ANS padrão: L1 1 h, L2 2 h, L3 1 dia útil, L4 2 dias úteis; o órgão pode ajustar).</p>
        <Button onClick={onNew}>Nova solicitação de serviço</Button>
      </div>

      <Card title="Solicitações em andamento">
        {liveErr && <Banner tone="danger">{liveErr}</Banner>}
        {liveLoading ? <Spinner /> : !live.length && !liveErr ? <EmptyState title="Nenhuma solicitação de serviço em aberto" /> : <DataTable caption="Solicitações de serviço em andamento" columns={liveCols} rows={live} rowKey={(t) => t.id} />}
        <LoadMore hasMore={!!liveNext} loading={liveMore} onClick={() => liveNext && void loadLive(liveNext)} />
        <p className="mt-2 text-xs text-bv-muted">Para avaliar uma solicitação concluída, abra-a e use "Avaliar atendimento".</p>
      </Card>

      {canReport && (
        <Card title="Indicadores do período (ISA1–ISA4, IOSA e IR)">
          <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void loadReports(); }} aria-label="Período dos indicadores">
            <TextField label="De" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="Até" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            <Button type="submit" loading={loading}>Atualizar</Button>
            {can('report:export') && <>
              <Button variant="secondary" loading={dl === 'indicators'} onClick={() => void exportCsv('indicators')}>Exportar indicadores (CSV)</Button>
              <Button variant="secondary" loading={dl === 'requests'} onClick={() => void exportCsv('requests')}>Exportar solicitações (CSV)</Button>
            </>}
          </form>
          {err && <Banner tone="danger" title="Não foi possível carregar os indicadores">{err}</Banner>}
          {loading && !ind ? <Spinner /> : ind && (
            <div className="flex flex-col gap-4">
              <Banner tone="warning" title="Glosa indicativa">{ind.disclaimer} As faixas de glosa são configuráveis e não contratuais.</Banner>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard label="Criadas no período" value={ind.totals.created} />
                <StatCard label="Consideradas nos indicadores" value={ind.totals.considered} />
                <StatCard label="Concluídas" value={ind.totals.done} tone="success" />
                <StatCard label="Em aberto" value={ind.totals.open} />
                <StatCard label="Glosa indicativa total" value={fmtPercent(ind.glosaIndicativeTotalPercent, 0)} tone={ind.glosaIndicativeTotalPercent > 0 ? 'danger' : 'success'} hint="Soma das faixas por indicador" />
              </div>
              <DataTable caption="Indicadores do service desk no período" columns={indCols} rows={ind.indicators} rowKey={(i) => i.code} />
              {ind.indicators.find((i) => i.code === 'IR')?.extra && (() => { const x = ind.indicators.find((i) => i.code === 'IR')!.extra!; return (
                <p className="text-sm">Avaliações: {x.rated} avaliada(s); cobertura {x.coveragePct == null ? '—' : fmtPercent(x.coveragePct)}; satisfatórias (nota ≥ {x.satisfactoryMinScore}) {x.satisfactoryPct == null ? '—' : fmtPercent(x.satisfactoryPct)}; nota média {x.averageScore ?? '—'}.</p>); })()}
              <p className="text-xs text-bv-muted">Gerado em {fmtDateTime(ind.generatedAt)}.</p>
            </div>
          )}
        </Card>
      )}

      {canReport && reqs && (
        <Card title="Solicitações criadas no período">
          {!reqs.length ? <EmptyState title="Nenhuma solicitação criada no período" /> : <DataTable caption="Solicitações de serviço do período, com prazo e atraso" columns={reqCols} rows={reqs} rowKey={(r) => r.code} />}
        </Card>
      )}
    </div>
  );
}
