'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBvSession } from '@/lib/balcao/session';
import { fmtBRL, fmtDateTime, fmtNumber, fmtPercent } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, DataTable, EmptyState, PageHeader, Select, StatCard, Tabs, TextField } from '../../_ui/ui';
import { BarChart, ChartFrame } from '../relatorios/charts';
import { DownloadButton, StateGate, addDays, daysBetween, fmtMonth, fmtYmd, todayStr, useApi } from '../relatorios/lib';
import { ACTION_LABEL, ITEM_FALLBACK, ITEM_ORDER, ItemCard, QPERIOD_LABEL, fmtQty, fmtStorage, itemTitle } from './parts';
import { QuotasTab, type ItemOpt } from './quotas';

const POLL_MS = 30_000;
const clock = (ms: number | null) => (ms ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Araguaina', timeStyle: 'medium' }).format(new Date(ms)) : '—');
const sortItems = <T extends { item: string }>(l: T[]) => [...l].sort((a, b) => ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item));

// ── Aba: consumo do mês ──────────────────────────────────────────────────────
function MonthTab({ dash }: { dash: any }) {
  const items = sortItems<any>(dash.items ?? []);
  const contract = items.filter((i) => i.trItem);
  const others = items.filter((i) => !i.trItem);
  const alerts = useMemo(() => items.flatMap((i) => (i.quotas ?? []).filter((q: any) => q.pct >= q.alertAtPct || q.willExceed).map((q: any) => ({ it: i, q }))), [items]);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Custo estimado até hoje" value={fmtBRL(dash.totals?.estimatedCostToDate)} hint={`Mês ${fmtMonth(dash.month)} · ${dash.daysElapsed} de ${dash.daysInMonth} dias`} />
        <StatCard label="Custo projetado no mês" value={fmtBRL(dash.totals?.projectedCost)} hint="Estimativa; não substitui a fatura" />
        <StatCard label="Cotas em alerta" value={fmtNumber(alerts.length)} tone={alerts.length ? 'warning' : 'success'} hint={alerts.length ? 'Veja a lista abaixo' : 'Nenhuma cota em alerta'} />
        <StatCard label="Licenças em uso no mês" value={fmtNumber(dash.licenses?.total ?? 0)} hint={`${dash.licenses?.atendente ?? 0} atendentes · ${dash.licenses?.supervisor ?? 0} supervisores`} />
      </section>

      <Card title="Alertas de cota">
        {alerts.length === 0 ? <p className="text-sm">Nenhuma cota atingiu o percentual de alerta e nenhuma projeção excede o limite.</p> : (
          <ul className="flex flex-col gap-2">
            {alerts.map(({ it, q }: any) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={q.pct >= 100 ? 'danger' : 'warning'}><span aria-hidden="true">{q.pct >= 100 ? '✖' : '▲'}&nbsp;</span>{q.pct >= 100 ? 'Cota esgotada' : q.pct >= q.alertAtPct ? 'Em alerta' : 'Projeção excede'}</Badge>
                <span><strong>{itemTitle(it)}</strong> — cota {QPERIOD_LABEL[q.period].toLowerCase()}: {fmtPercent(q.pct, 1)} usado ({fmtQty(it.item, q.used)} de {fmtQty(it.item, q.limit)}); ação: {ACTION_LABEL[q.action]}.{q.willExceed ? ' A projeção do mês excede o limite.' : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {(dash.recentAlerts ?? []).length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Notificações recentes ({dash.recentAlerts.length})</summary>
            <ul className="mt-2 list-disc pl-5 text-sm">{dash.recentAlerts.map((a: any, i: number) => <li key={i}><strong>{a.title}</strong> — {a.body} <span className="text-bv-muted">({fmtDateTime(a.createdAt)})</span></li>)}</ul>
          </details>
        )}
      </Card>

      <Card title="Consumo e custo por item (tabela)">
        <DataTable caption={`Consumo do mês ${fmtMonth(dash.month)} por item`} rows={items} rowKey={(i: any) => i.item} columns={[
          { key: 'i', header: 'Item', render: (i: any) => itemTitle(i) },
          { key: 'h', header: 'Hoje', render: (i: any) => fmtQty(i.item, i.today) },
          { key: 'm', header: 'Mês até agora', render: (i: any) => fmtQty(i.item, i.monthToDate) },
          { key: 'p', header: 'Projeção fim do mês', render: (i: any) => fmtQty(i.item, i.projection?.monthEnd) },
          { key: 'q', header: 'Cota mensal usada', render: (i: any) => { const q = (i.quotas ?? []).find((x: any) => x.period === 'MONTH'); return q ? `${fmtPercent(q.pct, 1)} de ${fmtQty(i.item, q.limit)}` : 'Sem cota'; } },
          { key: 'c', header: 'Custo estimado', render: (i: any) => fmtBRL(i.estimatedCostToDate) },
          { key: 'cp', header: 'Custo projetado', render: (i: any) => fmtBRL(i.projectedCost) },
        ]} />
      </Card>

      <h2 className="text-lg font-semibold">Itens do contrato (TR)</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{contract.map((i) => <ItemCard key={i.item} it={i} daysElapsed={dash.daysElapsed} daysInMonth={dash.daysInMonth} />)}</div>
      <h2 className="text-lg font-semibold">E-mail, chat e inteligência artificial</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{others.map((i) => <ItemCard key={i.item} it={i} daysElapsed={dash.daysElapsed} daysInMonth={dash.daysInMonth} />)}</div>
    </div>
  );
}

// ── Aba: histórico ───────────────────────────────────────────────────────────
function HistoryTab({ itemOpts }: { itemOpts: ItemOpt[] }) {
  const today = todayStr();
  const [gran, setGran] = useState<'DAY' | 'MONTH'>('DAY');
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const [draft, setDraft] = useState(range);
  const [item, setItem] = useState('WA_SERVICE');
  const [err, setErr] = useState<string | null>(null);
  const q = { period: gran, from: range.from, to: range.to };
  const { data, loading, error, reload } = useApi<any>('/fiscal/consumption', q);
  const apply = (r: { from: string; to: string }) => {
    if (!r.from || !r.to || r.from > r.to) { setErr('A data inicial deve ser anterior ou igual à final.'); return; }
    if (daysBetween(r.from, r.to) > 799) { setErr('O período máximo é de 800 dias.'); return; }
    setErr(null); setRange(r); setDraft(r);
  };
  const sel = (data?.items ?? []).find((i: any) => i.item === item);
  const series: any[] = sel?.series ?? [];
  const lab = (s: any) => (s.day ? `${s.day.slice(8, 10)}/${s.day.slice(5, 7)}` : fmtMonth(s.month));
  const labLong = (s: any) => (s.day ? fmtYmd(s.day) : fmtMonth(s.month));
  const fmt = (n: number) => (item === 'STORAGE_BYTES' ? fmtStorage(n) : fmtNumber(n, 0));
  const total = series.reduce((s, x) => s + x.quantity, 0);
  const gauge = sel?.aggregation === 'MAX';
  return (
    <div className="flex flex-col gap-4">
      <Card title="Período e item">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); apply(draft); }}>
          <Select label="Agrupar por" value={gran} onChange={(e) => setGran(e.target.value as any)}><option value="DAY">Dia</option><option value="MONTH">Mês</option></Select>
          <TextField label="De" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="Até (inclusive)" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Select label="Item do gráfico" value={item} onChange={(e) => setItem(e.target.value)}>{itemOpts.map((o) => <option key={o.item} value={o.item}>{o.trItem ? `Item ${o.trItem} — ` : ''}{o.label}</option>)}</Select>
          <div className="flex items-end gap-2"><Button type="submit">Aplicar</Button></div>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => apply({ from: addDays(today, -6), to: today })}>Últimos 7 dias</Button>
          <Button size="sm" variant="secondary" onClick={() => apply({ from: addDays(today, -29), to: today })}>Últimos 30 dias</Button>
          <Button size="sm" variant="secondary" onClick={() => apply({ from: `${today.slice(0, 7)}-01`, to: today })}>Mês atual</Button>
          <Button size="sm" variant="secondary" onClick={() => { setGran('MONTH'); apply({ from: `${addDays(`${today.slice(0, 7)}-01`, -150).slice(0, 7)}-01`, to: today }); }}>Últimos 6 meses</Button>
        </div>
        {err && <div className="mt-3"><Banner tone="danger">{err}</Banner></div>}
        <p className="mt-2 text-xs text-bv-muted">Os dias de consumo são contados em UTC, como registrados pela plataforma.</p>
      </Card>
      <StateGate loading={loading} error={error} data={data} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-end"><DownloadButton path="/fiscal/consumption" filename="consumo.csv" query={{ ...q, format: 'csv' }} /></div>
            <ChartFrame title={`${sel ? itemTitle(sel) : 'Item'} — ${gran === 'DAY' ? 'por dia' : 'por mês'}`}
              summary={sel ? `${gauge ? 'Maior valor registrado' : 'Total'} no período: ${fmtQty(item, gauge ? Math.max(0, ...series.map((s) => s.quantity)) : total)}. Custo estimado do item: ${fmtBRL(sel.estimatedCost)}.` : 'Selecione um item.'}
              table={<DataTable caption="Consumo por período" rows={series} rowKey={(s: any) => s.day ?? s.month} empty="Sem dados no período." columns={[
                { key: 'p', header: gran === 'DAY' ? 'Dia' : 'Mês', render: (s: any) => labLong(s) }, { key: 'q', header: gauge ? 'Valor' : 'Quantidade', render: (s: any) => fmtQty(item, s.quantity) },
                ...(gran === 'MONTH' ? [{ key: 'c', header: 'Custo estimado', render: (s: any) => fmtBRL(s.estimatedCost) }] : [])]} />}>
              <BarChart title={sel ? itemTitle(sel) : 'Consumo'} desc={`${series.length} ponto(s); ${gauge ? 'máximo' : 'total'} ${fmtQty(item, gauge ? Math.max(0, ...series.map((s) => s.quantity)) : total)}`}
                items={series.map((s) => ({ label: lab(s), value: s.quantity }))} yFmt={fmt} />
            </ChartFrame>
            <Card title="Resumo do período por item">
              <DataTable caption="Consumo e custo estimado por item no período" rows={sortItems<any>(data.items)} rowKey={(i: any) => i.item} columns={[
                { key: 'i', header: 'Item', render: (i: any) => itemTitle(i) }, { key: 'q', header: 'Quantidade (soma; máximo em armazenamento e canais)', render: (i: any) => fmtQty(i.item, i.quantity) },
                { key: 'u', header: 'Preço unitário estimado', render: (i: any) => (i.unitPrice ? `${fmtBRL(i.unitPrice)} (${i.unitPriceUnit})` : '—') }, { key: 'c', header: 'Custo estimado', render: (i: any) => fmtBRL(i.estimatedCost) }]} />
              <p className="mt-2 text-sm font-semibold">Custo estimado total no período: {fmtBRL(data.totals?.estimatedCost)}</p>
              {data.notes && <p className="mt-1 text-xs text-bv-muted">{data.notes}</p>}
            </Card>
            {gran === 'MONTH' && (data.licenses ?? []).length > 0 && (
              <Card title="Licenças em uso por mês"><DataTable caption="Licenças em uso por mês" rows={data.licenses} rowKey={(l: any) => l.month} columns={[
                { key: 'm', header: 'Mês', render: (l: any) => fmtMonth(l.month) }, { key: 'a', header: 'Atendentes', render: (l: any) => l.atendente }, { key: 's', header: 'Supervisores', render: (l: any) => l.supervisor },
                { key: 'ad', header: 'Administradores', render: (l: any) => l.admin }, { key: 'f', header: 'Fiscais', render: (l: any) => l.fiscal }, { key: 'c', header: 'Custo estimado', render: (l: any) => fmtBRL(l.estimatedCost) }]} /></Card>
            )}
          </div>
        )}
      </StateGate>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function FiscalPage() {
  const { can } = useBvSession();
  const allowed = can('fiscal:read');
  const dash = useApi<any>(allowed ? '/fiscal/dashboard' : null, undefined, { pollMs: POLL_MS });
  const quotas = useApi<{ quotas: any[] }>(allowed ? '/fiscal/quotas' : null, undefined, { pollMs: POLL_MS });
  const [version, setVersion] = useState(0);
  const onChanged = useCallback(() => { setVersion((v) => v + 1); void dash.reload(); void quotas.reload(); }, [dash, quotas]);

  const itemOpts: ItemOpt[] = useMemo(() => {
    const fromDash = (dash.data?.items ?? []).map((i: any) => ({ item: i.item, label: i.label, trItem: i.trItem ?? null }));
    const list: ItemOpt[] = fromDash.length ? fromDash : ITEM_ORDER.map((item) => ({ item, label: ITEM_FALLBACK[item], trItem: null }));
    return sortItems(list);
  }, [dash.data]);

  // anuncia (educadamente, no máximo a cada 30 s) mudança na quantidade de cotas em alerta
  const alertCount = (dash.data?.items ?? []).reduce((n: number, i: any) => n + (i.quotas ?? []).filter((q: any) => q.pct >= q.alertAtPct).length, 0);
  const [announce, setAnnounce] = useState('');
  const last = useRef<{ n: number | null; at: number }>({ n: null, at: 0 });
  useEffect(() => {
    if (!dash.data || last.current.n === alertCount) return;
    const first = last.current.n === null;
    last.current = { n: alertCount, at: Date.now() };
    if (!first) setAnnounce(alertCount ? `${alertCount} cota(s) em alerta.` : 'Nenhuma cota em alerta.');
  }, [alertCount, dash.data]);

  if (!allowed) return <Banner tone="danger" title="Acesso negado">Você não tem permissão para o painel do fiscal.</Banner>;

  return (
    <div>
      <PageHeader title="Painel do fiscal do contrato" subtitle={`Atualizado às ${clock(dash.updatedAt)} · consumo atualizado automaticamente a cada 30 s`}
        actions={<Button variant="secondary" size="sm" onClick={onChanged}>Atualizar agora</Button>} />
      <div aria-live="polite" aria-atomic="true" className="bv-sr-only">{announce}</div>
      <Banner tone="primary">Os valores em reais são estimativas calculadas com os preços unitários do TR (ou configurados para o órgão) e não substituem a fatura.</Banner>
      <div className="mt-4">
        <Tabs label="Seções do painel do fiscal" tabs={[
          { id: 'mes', title: 'Consumo do mês', content: <StateGate loading={dash.loading} error={dash.error} data={dash.data} onRetry={dash.reload}>{dash.data ? <MonthTab dash={dash.data} /> : <EmptyState title="Sem dados." />}</StateGate> },
          { id: 'hist', title: 'Histórico', content: <HistoryTab itemOpts={itemOpts} /> },
          { id: 'cotas', title: 'Cotas e log de alterações', content: <QuotasTab items={itemOpts} quotas={quotas.data?.quotas ?? null} loading={quotas.loading} error={quotas.error} reload={quotas.reload} onChanged={onChanged} version={version} /> },
        ]} />
      </div>
    </div>
  );
}
