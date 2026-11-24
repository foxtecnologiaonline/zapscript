'use client';
/** Abas de relatórios padrão: visão geral, séries, atendentes, filas, canais, NPS, SLA, IQA, voz e service desk. */
import React, { useMemo, useState } from 'react';
import { useBvSession } from '@/lib/balcao/session';
import { CHANNEL_LABEL, fmtBytes, fmtDateTime, fmtNumber, fmtPercent, PRESENCE_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Card, DataTable, EmptyState, Select, StatCard, TextField } from '../../_ui/ui';
import { BarChart, ChartFrame, HBarChart, LineChart, type BarItem } from './charts';
import {
  DownloadButton, SortableTable, StateGate, agentLabel, fmtMonth, fmtUnit, fmtYmd, num, queueLabel, addDays, useApi,
  type SCol, type TabProps, type Unit,
} from './lib';

const chLabel = (c: string | null) => (c ? CHANNEL_LABEL[c] ?? c : '—');
const Toolbar = ({ children }: { children: React.ReactNode }) => <div className="mb-3 flex flex-wrap items-end justify-end gap-2">{children}</div>;
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
const Note = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-xs text-bv-muted">{children}</p>;
const PeriodNote = ({ p }: { p: any }) => (p ? <p className="mb-3 text-sm text-bv-muted">Período analisado: {fmtYmd(p.fromLocal)} a {fmtYmd(p.toLocal)} (fuso {p.timezone}). Atendimentos contados pela data de início.</p> : null);

// ── Visão geral ──────────────────────────────────────────────────────────────
const KPIS: Array<{ key: string; label: string; unit: Unit; better: 'up' | 'down' | null; hint?: string }> = [
  { key: 'total', label: 'Volume de atendimentos', unit: 'count', better: null },
  { key: 'tmeAvg', label: 'TME — 1ª resposta humana', unit: 'seconds', better: 'down', hint: 'Tempo médio até a primeira resposta' },
  { key: 'tmaAvg', label: 'TMA — atendimento', unit: 'seconds', better: 'down', hint: 'Da atribuição ao encerramento' },
  { key: 'tmrAvg', label: 'TMR — resolução', unit: 'seconds', better: 'down', hint: 'Do início ao encerramento' },
  { key: 'nps', label: 'NPS', unit: 'score', better: 'up', hint: 'De −100 a 100' },
  { key: 'abandonRate', label: 'Taxa de abandono', unit: 'percent', better: 'down' },
  { key: 'botContainmentRate', label: 'Contenção do bot', unit: 'percent', better: 'up', hint: 'Resolvidos só pelo assistente' },
  { key: 'fcrRate', label: 'FCR — resolução no 1º contato', unit: 'percent', better: 'up' },
  { key: 'slaRate', label: 'SLA cumprido', unit: 'percent', better: 'up' },
];

function deltaText(k: (typeof KPIS)[number], c: any): { text: string; tone: 'neutral' | 'success' | 'danger' } {
  if (!c) return { text: 'Sem comparação disponível.', tone: 'neutral' };
  if (c.current == null) return { text: 'Sem dados no período.', tone: 'neutral' };
  if (c.previous == null) return { text: 'Sem dados no período anterior para comparar.', tone: 'neutral' };
  const d: number = c.delta ?? 0;
  const pp = k.unit === 'percent';
  const abs = Math.abs(d);
  const rel = pp ? `${fmtNumber(abs, 1)} p.p.` : c.deltaPct != null ? fmtPercent(Math.abs(c.deltaPct), 1) : fmtUnit(k.unit, abs);
  const prev = `anterior: ${fmtUnit(k.unit, c.previous)}`;
  if (abs < 0.005) return { text: `■ Estável em relação ao período anterior (${prev})`, tone: 'neutral' };
  const up = d > 0;
  const verdict = k.better == null ? '' : (up === (k.better === 'up')) ? ' — melhora' : ' — piora';
  const tone = k.better == null ? 'neutral' : (up === (k.better === 'up')) ? 'success' : 'danger';
  return { text: `${up ? '▲ Aumento' : '▼ Queda'} de ${rel} vs. período anterior${verdict} (${prev})`, tone };
}

export function OverviewTab({ q, names }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/overview', { ...q, compare: 'true' });
  const hours = useMemo<BarItem[]>(() => {
    const m = new Map<number, number>((data?.volumeByHourOfDay ?? []).map((r: any) => [Number(r.hourOfDay), r.total]));
    return Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}h`, value: m.get(h) ?? 0 }));
  }, [data]);
  void names;
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/overview" filename="visao-geral.csv" query={{ ...q, compare: 'true', format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          {data.previous && <p className="text-sm text-bv-muted">Comparação com o período anterior de mesma duração: {fmtYmd(data.previous.period.fromLocal)} a {fmtYmd(data.previous.period.toLocal)}.</p>}
          <Grid>
            {KPIS.map((k) => {
              const v = num(data.kpis?.[k.key]);
              const d = deltaText(k, data.comparison?.[k.key]);
              return <StatCard key={k.key} label={k.label} value={fmtUnit(k.unit, v)} tone={d.tone} hint={[k.hint, d.text].filter(Boolean).join(' · ')} />;
            })}
          </Grid>
          <ChartFrame title="Volume por canal" summary={`Total de ${fmtNumber(data.kpis?.total ?? 0)} atendimentos no período.`}
            table={<DataTable caption="Volume por canal" rows={data.volumeByChannel ?? []} rowKey={(r: any) => r.channel ?? 'x'} columns={[
              { key: 'c', header: 'Canal', render: (r: any) => chLabel(r.channel) }, { key: 't', header: 'Atendimentos', render: (r: any) => fmtNumber(r.total) },
              { key: 'e', header: 'Encerrados', render: (r: any) => fmtNumber(r.closed) }, { key: 'me', header: 'TME médio', render: (r: any) => fmtUnit('seconds', r.tmeAvg) },
              { key: 'ma', header: 'TMA médio', render: (r: any) => fmtUnit('seconds', r.tmaAvg) }, { key: 'n', header: 'NPS', render: (r: any) => fmtUnit('score', r.nps) }]} />}>
            <HBarChart title="Volume por canal" desc={(data.volumeByChannel ?? []).map((r: any) => `${chLabel(r.channel)}: ${r.total}`).join('; ') || 'Sem dados'}
              items={(data.volumeByChannel ?? []).map((r: any) => ({ label: chLabel(r.channel), value: r.total }))} valueFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
          <ChartFrame title="Volume por hora do dia" summary="Distribuição dos atendimentos pela hora de início (fuso do órgão)."
            table={<DataTable caption="Volume por hora do dia" rows={hours} rowKey={(r) => r.label} columns={[{ key: 'h', header: 'Hora', render: (r) => r.label }, { key: 'v', header: 'Atendimentos', render: (r) => fmtNumber(r.value) }]} />}>
            <BarChart title="Volume por hora do dia" desc={`Pico às ${hours.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a), hours[0])?.label ?? '—'}`} items={hours} yFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
        </div>
      )}
    </StateGate>
  );
}

// ── Séries temporais ─────────────────────────────────────────────────────────
const GRANS = [{ v: 'day', l: 'Por dia' }, { v: 'hour', l: 'Por hora' }, { v: 'week', l: 'Por semana' }, { v: 'month', l: 'Por mês' }];
const GROUPS: Record<string, { label: string; unit: Unit; metrics: Array<[string, string]> }> = {
  volume: { label: 'Volume de atendimentos', unit: 'count', metrics: [['total', 'Iniciados'], ['closed', 'Encerrados'], ['abandoned', 'Abandonados'], ['botResolved', 'Resolvidos pelo bot']] },
  tempos: { label: 'Tempos médios (TME, TMA, TMR)', unit: 'seconds', metrics: [['tmeAvg', 'TME'], ['tmaAvg', 'TMA'], ['tmrAvg', 'TMR']] },
  sla: { label: 'SLA e FCR (%)', unit: 'percent', metrics: [['slaRate', 'SLA cumprido'], ['fcrRate', 'FCR']] },
  nps: { label: 'NPS', unit: 'score', metrics: [['nps', 'NPS']] },
};
function bucketLabel(gran: string, b: string, long = false): string {
  if (gran === 'day') return long ? fmtYmd(b) : `${b.slice(8, 10)}/${b.slice(5, 7)}`;
  if (gran === 'hour') return `${b.slice(8, 10)}/${b.slice(5, 7)} ${b.slice(11, 16)}`;
  if (gran === 'week') return `Sem. ${b.slice(8, 10)}/${b.slice(5, 7)}${long ? `/${b.slice(0, 4)}` : ''}`;
  return fmtMonth(b);
}

export function SeriesTab({ q }: TabProps) {
  const [gran, setGran] = useState('day');
  const [group, setGroup] = useState('volume');
  const [kind, setKind] = useState<'line' | 'bar'>('line');
  const g = GROUPS[group];
  const { data, loading, error, reload } = useApi<any>('/reports/timeseries', { ...q, granularity: gran, metrics: g.metrics.map((m) => m[0]).join(',') });
  const { labels, longLabels, cols } = useMemo(() => {
    const rows: any[] = data?.series ?? [];
    const key = data?.bucketKey ?? 'day';
    let buckets: string[] = rows.map((r) => r[key]);
    const byB = new Map<string, any>(rows.map((r) => [r[key], r]));
    // preenche dias sem atendimento (contagens = 0; taxas/tempos = sem dado)
    if (gran === 'day' && data?.period && rows.length) {
      const all: string[] = []; let d = data.period.fromLocal as string; let guard = 0;
      while (d <= data.period.toLocal && guard++ < 900) { all.push(d); d = addDays(d, 1); }
      buckets = all;
    }
    const cols = g.metrics.map(([k, name]) => ({ key: k, name, values: buckets.map((b) => { const r = byB.get(b); return r ? num(r[k]) : g.unit === 'count' ? 0 : null; }) }));
    return { labels: buckets.map((b) => bucketLabel(gran, b)), longLabels: buckets.map((b) => bucketLabel(gran, b, true)), cols };
  }, [data, gran, g]);
  const fmt = (n: number) => fmtUnit(g.unit, g.unit === 'percent' ? Math.round(n * 10) / 10 : g.unit === 'seconds' ? n : n);
  const first = cols[0];
  const total = g.unit === 'count' && first ? first.values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  const MAXROWS = 400;
  const tableRows = labels.map((_, i) => i).slice(0, MAXROWS);
  const summary = first && first.values.length
    ? `${first.values.length} ${GRANS.find((x) => x.v === gran)?.l.toLowerCase()}${total != null ? `; ${first.name}: ${fmtNumber(total)} no total` : ''}.`
    : 'Sem dados para o período.';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Indicador" value={group} onChange={(e) => setGroup(e.target.value)}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select label="Agrupamento no tempo" value={gran} onChange={(e) => setGran(e.target.value)} hint={gran === 'hour' ? 'Por hora gera muitos pontos em períodos longos.' : undefined}>{GRANS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</Select>
        <Select label="Tipo de gráfico" value={kind} onChange={(e) => setKind(e.target.value as any)} hint={kind === 'bar' ? `Barras mostram só: ${first?.name}.` : undefined}><option value="line">Linhas</option><option value="bar">Barras</option></Select>
      </div>
      <StateGate loading={loading} error={error} data={data} onRetry={reload}>
        {data && (
          <>
            <Toolbar><DownloadButton path="/reports/timeseries" filename="serie-temporal.csv" query={{ ...q, granularity: gran, metrics: g.metrics.map((m) => m[0]).join(','), format: 'csv' }} /></Toolbar>
            <PeriodNote p={data.period} />
            <ChartFrame title={g.label} summary={summary}
              table={labels.length ? (<>
                <DataTable caption={`${g.label} — ${GRANS.find((x) => x.v === gran)?.l}`} rows={tableRows} rowKey={(i) => String(i)} columns={[{ key: 'b', header: gran === 'hour' ? 'Hora' : gran === 'day' ? 'Dia' : gran === 'week' ? 'Semana' : 'Mês', render: (i: number) => longLabels[i] }, ...cols.map((c) => ({ key: c.key, header: c.name, render: (i: number) => fmtUnit(g.unit, c.values[i]) }))]} />
                {labels.length > MAXROWS && <Note>Exibindo as primeiras {MAXROWS} de {labels.length} linhas. Use “Exportar CSV” para o conjunto completo.</Note>}
              </>) : <EmptyState title="Sem dados no período." />}>
              {kind === 'line'
                ? <LineChart title={g.label} desc={`${cols.map((c) => c.name).join(', ')} ${GRANS.find((x) => x.v === gran)?.l.toLowerCase()}. ${summary}`} labels={labels} series={cols.map((c) => ({ name: c.name, values: c.values }))} yFmt={fmt} />
                : <BarChart title={first?.name ?? g.label} desc={summary} items={labels.map((l, i) => ({ label: l, value: first?.values[i] ?? null }))} yFmt={fmt} />}
            </ChartFrame>
          </>
        )}
      </StateGate>
    </div>
  );
}

// ── Atendentes ───────────────────────────────────────────────────────────────
export function AgentsTab({ q }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/agents', q);
  const rows: any[] = data?.agents ?? [];
  const cols: SCol<any>[] = [
    { key: 'name', header: 'Atendente', value: (r) => r.agentName ?? '—' },
    { key: 'presence', header: 'Presença atual', value: (r) => r.presence ?? '', render: (r) => (r.presence ? PRESENCE_LABEL[r.presence] ?? r.presence : '—') },
    { key: 'total', header: 'Atendimentos', value: (r) => r.total, numeric: true, render: (r) => fmtNumber(r.total) },
    { key: 'closed', header: 'Encerrados', value: (r) => r.closed, numeric: true, render: (r) => fmtNumber(r.closed) },
    { key: 'tme', header: 'TME médio', value: (r) => r.tmeAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmeAvg) },
    { key: 'tme90', header: 'TME P90', value: (r) => r.tmeP90, numeric: true, render: (r) => fmtUnit('seconds', r.tmeP90) },
    { key: 'tma', header: 'TMA médio', value: (r) => r.tmaAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmaAvg) },
    { key: 'tmr', header: 'TMR médio', value: (r) => r.tmrAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmrAvg) },
    { key: 'sla', header: 'SLA cumprido', value: (r) => r.slaRate, numeric: true, render: (r) => fmtUnit('percent', r.slaRate) },
    { key: 'fcr', header: 'FCR', value: (r) => r.fcrRate, numeric: true, render: (r) => fmtUnit('percent', r.fcrRate) },
    { key: 'transf', header: 'Transferidos', value: (r) => r.transferred, numeric: true, render: (r) => fmtNumber(r.transferred) },
    { key: 'nps', header: 'NPS', value: (r) => r.nps, numeric: true, render: (r) => fmtUnit('score', r.nps) },
    { key: 'csat', header: 'Nota média', value: (r) => r.csatAvg, numeric: true, render: (r) => fmtUnit('score', r.csatAvg) },
    { key: 'simAvg', header: 'Simultâneas (média)', value: (r) => r.simultaneousAvg, numeric: true, render: (r) => fmtUnit('score', r.simultaneousAvg) },
    { key: 'simPeak', header: 'Simultâneas (pico)', value: (r) => r.simultaneousPeak, numeric: true, render: (r) => fmtNumber(r.simultaneousPeak) },
    { key: 'busy', header: 'Tempo em atendimento', value: (r) => r.busySeconds, numeric: true, render: (r) => fmtUnit('seconds', r.busySeconds) },
  ];
  const top: BarItem[] = [...rows].sort((a, b) => b.total - a.total).slice(0, 10).map((r) => ({ label: r.agentName ?? 'Sem nome', value: r.total }));
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/agents" filename="atendentes.csv" query={{ ...q, format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          {data.note && <Banner tone="primary">{data.note}</Banner>}
          <ChartFrame title="Atendimentos por atendente" summary={`${rows.length} atendente(s) com atendimentos no período; exibindo os 10 com maior volume.`}
            table={<SortableTable caption="Atendimentos por atendente" rows={rows} rowKey={(r) => r.agent} columns={cols.slice(0, 4)} defaultSort={{ key: 'total', dir: 'desc' }} />}>
            <HBarChart title="Atendimentos por atendente" desc={top.map((t) => `${t.label}: ${t.value}`).join('; ')} items={top} valueFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
          <Card title="Produtividade detalhada"><SortableTable caption="Produtividade por atendente" rows={rows} rowKey={(r) => r.agent} columns={cols} defaultSort={{ key: 'total', dir: 'desc' }} empty="Nenhum atendente com atendimentos no período." /></Card>
        </div>
      )}
    </StateGate>
  );
}

// ── Filas ────────────────────────────────────────────────────────────────────
export function QueuesTab({ q, names }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/queues', q);
  const rows: any[] = data?.queues ?? [];
  const cols: SCol<any>[] = [
    { key: 'q', header: 'Fila', value: (r) => queueLabel(names, r.queue, r.queueName) },
    { key: 'total', header: 'Atendimentos', value: (r) => r.total, numeric: true, render: (r) => fmtNumber(r.total) },
    { key: 'closed', header: 'Encerrados', value: (r) => r.closed, numeric: true, render: (r) => fmtNumber(r.closed) },
    { key: 'ab', header: 'Abandonados', value: (r) => r.abandoned, numeric: true, render: (r) => `${fmtNumber(r.abandoned)} (${fmtUnit('percent', r.abandonRate)})` },
    { key: 'wait', header: 'Espera em fila (média)', value: (r) => r.queueWaitAvg, numeric: true, render: (r) => fmtUnit('seconds', r.queueWaitAvg) },
    { key: 'wait90', header: 'Espera em fila (P90)', value: (r) => r.queueWaitP90, numeric: true, render: (r) => fmtUnit('seconds', r.queueWaitP90) },
    { key: 'tme', header: 'TME médio', value: (r) => r.tmeAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmeAvg) },
    { key: 'tma', header: 'TMA médio', value: (r) => r.tmaAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmaAvg) },
    { key: 'tmr', header: 'TMR médio', value: (r) => r.tmrAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmrAvg) },
    { key: 'sla', header: 'SLA cumprido', value: (r) => r.slaRate, numeric: true, render: (r) => `${fmtUnit('percent', r.slaRate)} (${fmtNumber(r.slaViolations)} viol.)` },
    { key: 'fcr', header: 'FCR', value: (r) => r.fcrRate, numeric: true, render: (r) => fmtUnit('percent', r.fcrRate) },
    { key: 'tr', header: 'Transferidos', value: (r) => r.transferred, numeric: true, render: (r) => fmtNumber(r.transferred) },
    { key: 'nps', header: 'NPS', value: (r) => r.nps, numeric: true, render: (r) => fmtUnit('score', r.nps) },
  ];
  const items: BarItem[] = rows.slice(0, 12).map((r) => ({ label: queueLabel(names, r.queue, r.queueName), value: r.total }));
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/queues" filename="filas.csv" query={{ ...q, format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          <ChartFrame title="Atendimentos por fila" summary={`${rows.length} fila(s) com atendimentos no período.`}
            table={<SortableTable caption="Atendimentos por fila" rows={rows} rowKey={(r) => r.queue ?? 'sem-fila'} columns={cols.slice(0, 3)} defaultSort={{ key: 'total', dir: 'desc' }} />}>
            <HBarChart title="Atendimentos por fila" desc={items.map((t) => `${t.label}: ${t.value}`).join('; ')} items={items} valueFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
          <Card title="Indicadores por fila"><SortableTable caption="Indicadores por fila" rows={rows} rowKey={(r) => r.queue ?? 'sem-fila'} columns={cols} defaultSort={{ key: 'total', dir: 'desc' }} /></Card>
        </div>
      )}
    </StateGate>
  );
}

// ── Canais ───────────────────────────────────────────────────────────────────
export function ChannelsTab({ q }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/channels', q);
  const rows: any[] = data?.channels ?? [];
  const cols: SCol<any>[] = [
    { key: 'c', header: 'Canal', value: (r) => chLabel(r.channel) },
    { key: 'total', header: 'Atendimentos', value: (r) => r.total, numeric: true, render: (r) => fmtNumber(r.total) },
    { key: 'closed', header: 'Encerrados', value: (r) => r.closed, numeric: true, render: (r) => fmtNumber(r.closed) },
    { key: 'ab', header: 'Abandono', value: (r) => r.abandonRate, numeric: true, render: (r) => `${fmtNumber(r.abandoned)} (${fmtUnit('percent', r.abandonRate)})` },
    { key: 'tme', header: 'TME médio', value: (r) => r.tmeAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmeAvg) },
    { key: 'tme90', header: 'TME P90', value: (r) => r.tmeP90, numeric: true, render: (r) => fmtUnit('seconds', r.tmeP90) },
    { key: 'tma', header: 'TMA médio', value: (r) => r.tmaAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmaAvg) },
    { key: 'tmr', header: 'TMR médio', value: (r) => r.tmrAvg, numeric: true, render: (r) => fmtUnit('seconds', r.tmrAvg) },
    { key: 'bot', header: 'Via chatbot', value: (r) => r.botInvolved, numeric: true, render: (r) => fmtNumber(r.botInvolved) },
    { key: 'cont', header: 'Contenção do bot', value: (r) => r.botContainmentRate, numeric: true, render: (r) => fmtUnit('percent', r.botContainmentRate) },
    { key: 'fcr', header: 'FCR', value: (r) => r.fcrRate, numeric: true, render: (r) => fmtUnit('percent', r.fcrRate) },
    { key: 'sla', header: 'SLA cumprido', value: (r) => r.slaRate, numeric: true, render: (r) => fmtUnit('percent', r.slaRate) },
    { key: 'nps', header: 'NPS', value: (r) => r.nps, numeric: true, render: (r) => fmtUnit('score', r.nps) },
    { key: 'csat', header: 'Nota média', value: (r) => r.csatAvg, numeric: true, render: (r) => fmtUnit('score', r.csatAvg) },
  ];
  const items: BarItem[] = rows.map((r) => ({ label: chLabel(r.channel), value: r.total }));
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/channels" filename="canais.csv" query={{ ...q, format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          <ChartFrame title="Atendimentos por canal" summary={`${rows.length} canal(is) com atendimentos no período.`}
            table={<SortableTable caption="Atendimentos por canal" rows={rows} rowKey={(r) => r.channel} columns={cols.slice(0, 3)} defaultSort={{ key: 'total', dir: 'desc' }} />}>
            <HBarChart title="Atendimentos por canal" desc={items.map((t) => `${t.label}: ${t.value}`).join('; ')} items={items} valueFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
          <Card title="Indicadores por canal"><SortableTable caption="Indicadores por canal" rows={rows} rowKey={(r) => r.channel} columns={cols} defaultSort={{ key: 'total', dir: 'desc' }} /></Card>
        </div>
      )}
    </StateGate>
  );
}

// ── NPS / CSAT ───────────────────────────────────────────────────────────────
const npsCat = (s: number) => (s >= 9 ? { name: 'Promotor', tone: 'success' as const, pattern: 0 } : s >= 7 ? { name: 'Neutro', tone: 'warning' as const, pattern: 2 } : { name: 'Detrator', tone: 'danger' as const, pattern: 1 });

export function NpsTab({ q, names }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/nps', { ...q, granularity: 'day' });
  const dist: Array<{ score: number; count: number }> = data?.distribution ?? [];
  const totalResp = dist.reduce((s, d) => s + d.count, 0);
  const s = data?.summary ?? {};
  const group = (title: string, rows: any[], label: (r: any) => string, key: (r: any) => string) => {
    const cols: SCol<any>[] = [
      { key: 'n', header: title, value: label },
      { key: 'r', header: 'Respostas', value: (r) => r.npsResponses, numeric: true, render: (r) => fmtNumber(r.npsResponses) },
      { key: 'p', header: 'Promotores', value: (r) => r.npsPromoters, numeric: true, render: (r) => fmtNumber(r.npsPromoters) },
      { key: 'ne', header: 'Neutros', value: (r) => r.npsPassives, numeric: true, render: (r) => fmtNumber(r.npsPassives) },
      { key: 'd', header: 'Detratores', value: (r) => r.npsDetractors, numeric: true, render: (r) => fmtNumber(r.npsDetractors) },
      { key: 'nps', header: 'NPS', value: (r) => r.nps, numeric: true, render: (r) => fmtUnit('score', r.nps) },
      { key: 'c', header: 'Nota média', value: (r) => r.csatAvg, numeric: true, render: (r) => fmtUnit('score', r.csatAvg) },
    ];
    return <Card title={`NPS por ${title.toLowerCase()}`}><SortableTable caption={`NPS por ${title.toLowerCase()}`} rows={rows.filter((r) => r.npsResponses > 0)} rowKey={key} columns={cols} defaultSort={{ key: 'r', dir: 'desc' }} empty="Sem respostas de pesquisa no período." /></Card>;
  };
  const series: any[] = data?.series ?? [];
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/nps" filename="nps.csv" query={{ ...q, granularity: 'day', format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          <Grid>
            <StatCard label="NPS" value={fmtUnit('score', num(s.nps))} hint="% promotores − % detratores (−100 a 100)" />
            <StatCard label="Nota média (0–10)" value={fmtUnit('score', num(s.csatAvg))} />
            <StatCard label="Respostas" value={fmtNumber(s.npsResponses ?? 0)} hint={`${fmtNumber(s.npsPromoters ?? 0)} promotores · ${fmtNumber(s.npsPassives ?? 0)} neutros · ${fmtNumber(s.npsDetractors ?? 0)} detratores`} />
          </Grid>
          <ChartFrame title="Distribuição das notas (0 a 10)" summary={`${fmtNumber(totalResp)} resposta(s). Detratores: notas 0 a 6; neutros: 7 e 8; promotores: 9 e 10.`}
            table={<DataTable caption="Distribuição das notas de satisfação" rows={dist} rowKey={(d) => String(d.score)} columns={[
              { key: 's', header: 'Nota', render: (d) => d.score }, { key: 'c', header: 'Classificação', render: (d) => <Badge tone={npsCat(d.score).tone}>{npsCat(d.score).name}</Badge> },
              { key: 'n', header: 'Respostas', render: (d) => fmtNumber(d.count) }, { key: 'p', header: '% do total', render: (d) => (totalResp ? fmtPercent((100 * d.count) / totalResp, 1) : '—') }]} />}>
            <BarChart title="Distribuição das notas de satisfação" desc={dist.map((d) => `nota ${d.score}: ${d.count}`).join('; ')}
              items={dist.map((d) => ({ label: String(d.score), value: d.count, tone: npsCat(d.score).tone, pattern: npsCat(d.score).pattern }))} yFmt={(n) => fmtNumber(n)}
              legend={[{ label: 'Detratores (0–6)', tone: 'danger', pattern: 1 }, { label: 'Neutros (7–8)', tone: 'warning', pattern: 2 }, { label: 'Promotores (9–10)', tone: 'success', pattern: 0 }]} />
          </ChartFrame>
          <ChartFrame title="NPS ao longo do tempo" summary="NPS diário (dias sem respostas ficam sem ponto)."
            table={<DataTable caption="NPS por dia" rows={series} rowKey={(r) => r.day} columns={[{ key: 'd', header: 'Dia', render: (r) => fmtYmd(r.day) }, { key: 'r', header: 'Respostas', render: (r) => fmtNumber(r.npsResponses) }, { key: 'n', header: 'NPS', render: (r) => fmtUnit('score', r.nps) }, { key: 'c', header: 'Nota média', render: (r) => fmtUnit('score', r.csatAvg) }]} />}>
            <LineChart title="NPS por dia" desc={`${series.length} dia(s) com atendimentos`} labels={series.map((r) => `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`)} series={[{ name: 'NPS', values: series.map((r) => num(r.nps)) }]} yFmt={(n) => fmtNumber(n, 0)} />
          </ChartFrame>
          {group('Fila', data.byQueue ?? [], (r) => queueLabel(names, r.queue, r.queueName), (r) => r.queue ?? 'sem-fila')}
          {group('Canal', data.byChannel ?? [], (r) => chLabel(r.channel), (r) => r.channel)}
          {group('Atendente', data.byAgent ?? [], (r) => agentLabel(names, r.agent, r.agentName), (r) => r.agent ?? 'sem')}
        </div>
      )}
    </StateGate>
  );
}

// ── SLA ──────────────────────────────────────────────────────────────────────
const SLA_KIND: Record<string, string> = { FIRST_RESPONSE: 'Prazo de 1ª resposta', RESOLUTION: 'Prazo de resolução', FLAGGED: 'Sinalizada pelo sistema' };
export function SlaTab({ q, names }: TabProps) {
  const { data, loading, error, reload } = useApi<any>('/reports/sla', q);
  const s = data?.summary ?? {};
  const byDay: any[] = data?.byDay ?? [];
  const byQueue: any[] = data?.byQueue ?? [];
  const viol: any[] = data?.violations ?? [];
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/sla" filename="sla.csv" query={{ ...q, format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          <Grid>
            <StatCard label="SLA cumprido" value={fmtUnit('percent', num(s.slaRate))} tone={num(s.slaRate) != null && s.slaRate < 90 ? 'warning' : 'neutral'} hint={`Base: ${fmtNumber(s.slaBase ?? 0)} atendimento(s) com prazo apurável`} />
            <StatCard label="Violações" value={fmtNumber(s.slaViolations ?? 0)} tone={(s.slaViolations ?? 0) > 0 ? 'danger' : 'success'} />
            <StatCard label="1ª resposta / resolução" value={`${fmtUnit('percent', num(s.slaFirstResponseRate))} / ${fmtUnit('percent', num(s.slaResolutionRate))}`} hint="Cumprimento por tipo de prazo" />
          </Grid>
          <ChartFrame title="SLA cumprido por dia" summary={`${byDay.length} dia(s) com prazo apurável.`}
            table={<DataTable caption="SLA por dia" rows={byDay} rowKey={(r) => r.day} columns={[{ key: 'd', header: 'Dia', render: (r) => fmtYmd(r.day) }, { key: 'b', header: 'Base', render: (r) => fmtNumber(r.slaBase) }, { key: 'v', header: 'Violações', render: (r) => fmtNumber(r.slaViolations) }, { key: 'r', header: 'SLA cumprido', render: (r) => fmtUnit('percent', r.slaRate) }]} />}>
            <LineChart title="SLA cumprido por dia" desc={`${byDay.length} dias`} labels={byDay.map((r) => `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`)} series={[{ name: 'SLA cumprido (%)', values: byDay.map((r) => num(r.slaRate)) }, { name: '1ª resposta (%)', values: byDay.map((r) => num(r.slaFirstResponseRate)) }, { name: 'Resolução (%)', values: byDay.map((r) => num(r.slaResolutionRate)) }]} yFmt={(n) => `${fmtNumber(n, 0)}%`} yMax={100} />
          </ChartFrame>
          <Card title="SLA por fila"><SortableTable caption="SLA por fila" rows={byQueue} rowKey={(r) => r.queue ?? 'sem-fila'} defaultSort={{ key: 'v', dir: 'desc' }} columns={[
            { key: 'q', header: 'Fila', value: (r) => queueLabel(names, r.queue, r.queueName) }, { key: 'b', header: 'Base', value: (r) => r.slaBase, numeric: true, render: (r) => fmtNumber(r.slaBase) },
            { key: 'v', header: 'Violações', value: (r) => r.slaViolations, numeric: true, render: (r) => fmtNumber(r.slaViolations) }, { key: 'r', header: 'SLA cumprido', value: (r) => r.slaRate, numeric: true, render: (r) => fmtUnit('percent', r.slaRate) },
            { key: 'fr', header: '1ª resposta', value: (r) => r.slaFirstResponseRate, numeric: true, render: (r) => fmtUnit('percent', r.slaFirstResponseRate) }, { key: 're', header: 'Resolução', value: (r) => r.slaResolutionRate, numeric: true, render: (r) => fmtUnit('percent', r.slaResolutionRate) }]} /></Card>
          <Card title="Violações recentes (até 100)">
            <DataTable caption="Atendimentos com violação de SLA" rows={viol} rowKey={(r) => r.id} empty="Nenhuma violação no período." columns={[
              { key: 'p', header: 'Protocolo', render: (r) => r.protocol }, { key: 'k', header: 'Tipo', render: (r) => <Badge tone="danger">{SLA_KIND[r.kind] ?? r.kind}</Badge> },
              { key: 'c', header: 'Canal', render: (r) => chLabel(r.channel) }, { key: 'q', header: 'Fila', render: (r) => queueLabel(names, r.queue) }, { key: 'a', header: 'Atendente', render: (r) => (r.agent ? agentLabel(names, r.agent) : '—') },
              { key: 's', header: 'Início', render: (r) => fmtDateTime(r.startedAt) }, { key: 'd', header: 'Prazo', render: (r) => fmtDateTime(r.kind === 'RESOLUTION' ? r.slaResolutionDueAt : r.slaFirstResponseDueAt) },
              { key: 'e', header: 'Ocorrido', render: (r) => fmtDateTime(r.kind === 'RESOLUTION' ? r.closedAt : r.firstResponseAt) }]} />
          </Card>
        </div>
      )}
    </StateGate>
  );
}

// ── IQA ──────────────────────────────────────────────────────────────────────
export function IqaTab({ q }: TabProps) {
  const [start, setStart] = useState('');
  const iq = { channel: q.channel, queueId: q.queueId, agentId: q.agentId, startDate: start || undefined };
  const { data, loading, error, reload } = useApi<any>('/reports/iqa', iq);
  const months: any[] = data?.months ?? [];
  const bands: any[] = data?.glosaBands ?? [];
  const status = (m: any) => (m.value == null ? <Badge>Sem dados</Badge> : m.reachedGoal ? <Badge tone="success">✔ Meta atingida</Badge> : <Badge tone="danger">✖ Abaixo da meta</Badge>);
  const labels = months.map((m) => `Mês ${m.contractMonth}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs"><TextField label="Início do contrato (opcional)" type="date" value={start} onChange={(e) => setStart(e.target.value)} hint="Em branco: usa a data configurada para o órgão." /></div>
      <StateGate loading={loading} error={error} data={data} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-4">
            <Toolbar><DownloadButton path="/reports/iqa" filename="iqa.csv" query={{ ...iq, format: 'csv' }} /></Toolbar>
            <Banner tone="primary" title={data.indicator}>{data.definition}. Metas: {(data.goals ?? []).map((g: any) => `meses ${g.months} → ${g.goalPct}%`).join('; ')}. Meses de contrato começam em {fmtYmd(data.contract?.startDate)}{data.contract?.source !== 'settings' ? ' (data inferida da 1ª conversa; configure o início do contrato nas configurações do órgão)' : ''}.</Banner>
            <ChartFrame title="IQA por mês de contrato" summary={months.length ? `${months.length} mês(es) de contrato. Último: ${labels[months.length - 1]} com ${fmtUnit('percent', months[months.length - 1].value)} (meta ${months[months.length - 1].goal}%).` : 'Sem meses de contrato apurados.'}
              table={<DataTable caption="IQA por mês de contrato" rows={months} rowKey={(m) => String(m.contractMonth)} empty="Sem meses de contrato apurados." columns={[
                { key: 'm', header: 'Mês de contrato', render: (m) => `Mês ${m.contractMonth}` }, { key: 'p', header: 'Período', render: (m) => `${fmtYmd(m.from.slice(0, 10))} a ${fmtYmd(addDays(m.to.slice(0, 10), -1))}` },
                { key: 'b', header: 'Via chatbot', render: (m) => fmtNumber(m.botInvolved) }, { key: 'n', header: 'Numerador', render: (m) => fmtNumber(m.numerator) },
                { key: 'v', header: 'IQA', render: (m) => fmtUnit('percent', m.value) }, { key: 'g', header: 'Meta', render: (m) => `${m.goal}%` }, { key: 's', header: 'Situação', render: status },
                { key: 'gap', header: 'Distância da meta', render: (m) => (m.gapPp == null ? '—' : m.gapPp <= 0 ? 'Meta superada' : `${fmtNumber(m.gapPp, 1)} p.p. abaixo`) },
                { key: 'gl', header: 'Faixa de glosa', render: (m) => (m.glosaPct == null ? (m.value == null ? '—' : 'Mês em andamento') : `${m.glosaPct}%`) }]} />}>
              <LineChart title="IQA e meta por mês de contrato" desc={months.map((m, i) => `${labels[i]}: IQA ${fmtUnit('percent', m.value)}, meta ${m.goal}%`).join('; ')} labels={labels}
                series={[{ name: 'IQA (%)', values: months.map((m) => num(m.value)) }, { name: 'Meta (%)', values: months.map((m) => m.goal) }]} yFmt={(n) => `${fmtNumber(n, 0)}%`} yMax={100} />
            </ChartFrame>
            <Card title="Faixas de glosa aplicadas">
              <ul className="list-disc pl-5 text-sm">{bands.map((b: any, i: number) => <li key={i}>{b.maxGapPp == null ? `Mais de ${bands[i - 1]?.maxGapPp ?? 0} p.p. abaixo da meta` : `Até ${b.maxGapPp} p.p. abaixo da meta`}: glosa de {b.glosaPct}%.</li>)}</ul>
              <Note>Glosa apurada apenas em mês encerrado; meta atingida = 0%. Interpretação adotada pelo sistema — confirmar com o contrato.</Note>
            </Card>
          </div>
        )}
      </StateGate>
    </div>
  );
}

// ── Voz ──────────────────────────────────────────────────────────────────────
export function VoiceTab({ q }: TabProps) {
  const vq = { from: q.from, to: q.to, agentId: q.agentId };
  const { data, loading, error, reload } = useApi<any>('/reports/voice', vq);
  const t = data?.totals ?? {};
  const byDay: any[] = data?.byDay ?? [];
  const byAgent: any[] = data?.byAgent ?? [];
  const lbl = (r: any) => `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`;
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          <Toolbar><DownloadButton path="/reports/voice" filename="voz.csv" query={{ ...vq, format: 'csv' }} /></Toolbar>
          <PeriodNote p={data.period} />
          {(q.channel || q.queueId) && <Banner tone="primary">Os filtros de canal e fila não se aplicam às chamadas de voz; apenas período e atendente.</Banner>}
          <Grid>
            <StatCard label="Chamadas" value={fmtNumber(t.total ?? 0)} hint={`${fmtNumber(t.inbound ?? 0)} recebidas · ${fmtNumber(t.outbound ?? 0)} realizadas · média ${fmtNumber(t.avgPerDay ?? 0, 1)} por dia`} />
            <StatCard label="Atendidas" value={fmtNumber(t.answered ?? 0)} hint={`Espera média até atender: ${fmtUnit('seconds', num(t.waitAvg))} (P90 ${fmtUnit('seconds', num(t.waitP90))})`} />
            <StatCard label="Taxa de abandono" value={fmtUnit('percent', num(t.abandonRate))} tone={(t.abandonRate ?? 0) > 10 ? 'warning' : 'neutral'} hint={`${fmtNumber(t.abandoned ?? 0)} abandonada(s) · ${fmtNumber(t.failed ?? 0)} falha(s)`} />
            <StatCard label="Minutos falados" value={fmtNumber(t.minutes ?? 0, 1)} hint="Soma das chamadas atendidas" />
            <StatCard label="Duração média" value={fmtUnit('seconds', num(t.durationAvg))} hint={`Mediana ${fmtUnit('seconds', num(t.durationP50))} · P90 ${fmtUnit('seconds', num(t.durationP90))}`} />
            <StatCard label="Pico de chamadas simultâneas" value={fmtNumber(t.peakConcurrent ?? 0)} hint={`${fmtNumber(t.recordings ?? 0)} gravação(ões) · ${fmtBytes(t.recordingBytes ?? 0)}`} />
          </Grid>
          <ChartFrame title="Chamadas por dia" summary={`${byDay.length} dia(s) com chamadas.`}
            table={<DataTable caption="Chamadas por dia" rows={byDay} rowKey={(r) => r.day} columns={[{ key: 'd', header: 'Dia', render: (r) => fmtYmd(r.day) }, { key: 't', header: 'Chamadas', render: (r) => fmtNumber(r.total) }, { key: 'a', header: 'Atendidas', render: (r) => fmtNumber(r.answered) }, { key: 'ab', header: 'Abandonadas', render: (r) => fmtNumber(r.abandoned) }, { key: 'm', header: 'Minutos', render: (r) => fmtNumber(r.minutes, 1) }, { key: 'du', header: 'Duração média', render: (r) => fmtUnit('seconds', r.durationAvg) }]} />}>
            <LineChart title="Chamadas por dia" desc={`${byDay.length} dias`} labels={byDay.map(lbl)} series={[{ name: 'Total', values: byDay.map((r) => r.total) }, { name: 'Atendidas', values: byDay.map((r) => r.answered) }, { name: 'Abandonadas', values: byDay.map((r) => r.abandoned) }]} yFmt={(n) => fmtNumber(n)} />
          </ChartFrame>
          <Card title="Chamadas por atendente"><SortableTable caption="Chamadas por atendente" rows={byAgent} rowKey={(r) => r.agent} defaultSort={{ key: 't', dir: 'desc' }} empty="Sem chamadas atendidas por atendentes no período." columns={[
            { key: 'n', header: 'Atendente', value: (r) => r.agentName ?? '—' }, { key: 't', header: 'Chamadas', value: (r) => r.total, numeric: true, render: (r) => fmtNumber(r.total) }, { key: 'a', header: 'Atendidas', value: (r) => r.answered, numeric: true, render: (r) => fmtNumber(r.answered) },
            { key: 'm', header: 'Minutos', value: (r) => r.minutes, numeric: true, render: (r) => fmtNumber(r.minutes, 1) }, { key: 'd', header: 'Duração média', value: (r) => r.durationAvg, numeric: true, render: (r) => fmtUnit('seconds', r.durationAvg) }]} /></Card>
        </div>
      )}
    </StateGate>
  );
}

// ── Service desk (ISA) ───────────────────────────────────────────────────────
export function ServiceDeskTab({ q }: TabProps) {
  const { can } = useBvSession();
  const sd = { from: `${q.from}T00:00:00-03:00`, to: `${addDays(String(q.to), 1)}T00:00:00-03:00` };
  const { data, loading, error, reload } = useApi<any>('/service-desk/indicators', sd);
  const rows: any[] = data?.indicators ?? [];
  const tot = data?.totals ?? {};
  return (
    <StateGate loading={loading} error={error} data={data} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          {can('report:export') && <Toolbar><DownloadButton path="/service-desk/indicators" filename="indicadores-service-desk.csv" query={{ ...sd, format: 'csv' }} /></Toolbar>}
          <p className="text-sm text-bv-muted">Solicitações de serviço criadas de {fmtYmd(String(q.from))} a {fmtYmd(String(q.to))}. Os filtros de canal, fila e atendente não se aplicam.</p>
          <Grid>
            <StatCard label="Solicitações criadas" value={fmtNumber(tot.created ?? 0)} hint={`${fmtNumber(tot.done ?? 0)} concluída(s) · ${fmtNumber(tot.open ?? 0)} em aberto · ${fmtNumber(tot.cancelled ?? 0)} cancelada(s)`} />
            <StatCard label="Consideradas nos indicadores" value={fmtNumber(tot.considered ?? 0)} />
            <StatCard label="Glosa indicativa total" value={fmtPercent(num(data.glosaIndicativeTotalPercent) ?? 0, 1)} tone={(data.glosaIndicativeTotalPercent ?? 0) > 0 ? 'warning' : 'success'} />
          </Grid>
          <Card title="Indicadores de nível de serviço (ISA, IOSA, IR)">
            <DataTable caption="Indicadores do service desk" rows={rows} rowKey={(r) => r.code} columns={[
              { key: 'c', header: 'Indicador', render: (r) => <><strong>{r.code}</strong><span className="block text-xs text-bv-muted">{r.name}</span></> },
              { key: 'm', header: 'Meta', render: (r) => `${r.direction === 'min' ? '≥' : '≤'} ${r.target}%` },
              { key: 'n', header: 'Considerados', render: (r) => fmtNumber(r.considered) }, { key: 'o', header: 'No prazo', render: (r) => (r.onTime == null ? '—' : fmtNumber(r.onTime)) }, { key: 'l', header: 'Em atraso', render: (r) => (r.late == null ? '—' : fmtNumber(r.late)) },
              { key: 'v', header: 'Resultado', render: (r) => fmtUnit('percent', r.value) },
              { key: 's', header: 'Situação', render: (r) => (r.met == null ? <Badge>Sem dados</Badge> : r.met ? <Badge tone="success">✔ Meta atingida</Badge> : <Badge tone="danger">✖ Meta não atingida</Badge>) },
              { key: 'g', header: 'Glosa indicativa', render: (r) => fmtPercent(r.glosaPercent, 1) }]} />
            {data.disclaimer && <Note>{data.disclaimer}</Note>}
          </Card>
        </div>
      )}
    </StateGate>
  );
}
