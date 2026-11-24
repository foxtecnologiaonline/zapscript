'use client';
/** Relatórios personalizados: montagem (métricas, agrupamentos, filtros, período), execução, CSV, salvamento e agendamento. */
import React, { useEffect, useMemo, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { CHANNEL_LABEL, fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, Select, TextArea, TextField, useToast } from '../../_ui/ui';
import { StateGate, fmtUnit, fmtYmd, saveBlob, useApi, type NameMaps } from './lib';

interface Def { metrics: Array<{ key: string; label: string; unit: string; description: string }>; dimensions: Array<{ key: string; label: string; time: boolean }>; filters: Array<{ key: string; values?: string[] }>; periods: { presets: string[] }; limits: { maxMetrics: number; maxGroupBy: number; maxRows: number } }
const PRESET_LABEL: Record<string, string> = { TODAY: 'Hoje', YESTERDAY: 'Ontem', LAST_7_DAYS: 'Últimos 7 dias', LAST_30_DAYS: 'Últimos 30 dias', MONTH_TO_DATE: 'Mês atual até hoje', PREVIOUS_WEEK: 'Semana anterior', PREVIOUS_MONTH: 'Mês anterior' };
const STATUS_LABEL: Record<string, string> = { BOT: 'Com o assistente', WAITING: 'Aguardando', ACTIVE: 'Em atendimento', CLOSED: 'Encerrada' };
const CLOSE_LABEL: Record<string, string> = { RESOLVED: 'Resolvida', ABANDONED: 'Abandonada', TRANSFERRED_OUT: 'Transferida', SPAM: 'Spam', TIMEOUT: 'Encerrada por inatividade' };
const FREQ_LABEL: Record<string, string> = { DAILY: 'Diário', WEEKLY: 'Semanal', MONTHLY: 'Mensal' };
const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

interface Form {
  name: string; description: string; metrics: string[]; groupBy: [string, string];
  channel: string[]; queueId: string[]; agentId: string[]; status: string[]; closeReason: string[];
  periodKind: 'preset' | 'range' | 'auto'; preset: string; from: string; to: string;
  orderKey: string; orderDir: 'asc' | 'desc'; limit: number;
  schedule: boolean; frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; format: 'CSV' | 'JSON'; recipients: string; hour: number; weekday: number; dayOfMonth: number; active: boolean;
}
const EMPTY: Form = {
  name: '', description: '', metrics: ['total', 'tmeAvg'], groupBy: ['channel', ''], channel: [], queueId: [], agentId: [], status: [], closeReason: [],
  periodKind: 'preset', preset: 'LAST_30_DAYS', from: '', to: '', orderKey: '', orderDir: 'desc', limit: 1000,
  schedule: false, frequency: 'WEEKLY', format: 'CSV', recipients: '', hour: 6, weekday: 1, dayOfMonth: 1, active: true,
};

function toDefinition(f: Form): Record<string, unknown> {
  const filters: Record<string, string[]> = {};
  for (const k of ['channel', 'queueId', 'agentId', 'status', 'closeReason'] as const) if (f[k].length) filters[k] = f[k];
  const groupBy = f.groupBy.filter(Boolean);
  const d: Record<string, unknown> = { metrics: f.metrics, groupBy, filters, limit: f.limit };
  if (f.periodKind === 'preset') d.period = { preset: f.preset };
  else if (f.periodKind === 'range') d.period = { from: f.from, to: f.to };
  if (f.orderKey && (f.metrics.includes(f.orderKey) || groupBy.includes(f.orderKey))) d.orderBy = { key: f.orderKey, dir: f.orderDir };
  return d;
}
function toSchedule(f: Form) {
  return { frequency: f.frequency, format: f.format, recipients: f.recipients.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean), hour: f.hour, ...(f.frequency === 'WEEKLY' ? { weekday: f.weekday } : {}), ...(f.frequency === 'MONTHLY' ? { dayOfMonth: f.dayOfMonth } : {}), active: f.active };
}
function fromSaved(r: any): Form {
  const d = r.definition ?? {}; const s = r.schedule; const f = d.filters ?? {};
  return {
    ...EMPTY, name: r.name, description: r.description ?? '', metrics: d.metrics ?? [], groupBy: [d.groupBy?.[0] ?? '', d.groupBy?.[1] ?? ''],
    channel: f.channel ?? [], queueId: f.queueId ?? [], agentId: f.agentId ?? [], status: f.status ?? [], closeReason: f.closeReason ?? [],
    periodKind: d.period?.preset ? 'preset' : d.period?.from || d.period?.to ? 'range' : 'auto', preset: d.period?.preset ?? 'LAST_30_DAYS', from: d.period?.from ?? '', to: d.period?.to ?? '',
    orderKey: d.orderBy?.key ?? '', orderDir: d.orderBy?.dir ?? 'desc', limit: d.limit ?? 1000,
    schedule: !!s, frequency: s?.frequency ?? 'WEEKLY', format: s?.format ?? 'CSV', recipients: (s?.recipients ?? []).join('\n'), hour: s?.hour ?? 6, weekday: s?.weekday ?? 1, dayOfMonth: s?.dayOfMonth ?? 1, active: s?.active ?? true,
  };
}

function CheckGroup({ legend, options, value, onChange, cols = 'sm:grid-cols-2' }: { legend: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void; cols?: string }) {
  return (
    <fieldset className="rounded-md border border-bv-border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {options.length === 0 ? <p className="text-sm text-bv-muted">Nenhuma opção disponível.</p> : (
        <div className={`grid grid-cols-1 gap-x-4 gap-y-1 ${cols}`}>
          {options.map((o) => <Checkbox key={o.value} label={o.label} checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} />)}
        </div>
      )}
    </fieldset>
  );
}

export function CustomTab({ names }: { names: NameMaps }) {
  const { can } = useBvSession();
  const toast = useToast();
  const canExport = can('report:export');
  const defs = useApi<Def>('/reports/definitions');
  const saved = useApi<{ reports: any[] }>('/reports/saved');
  const [f, setF] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState<'run' | 'csv' | 'save' | null>(null);
  const [result, setResult] = useState<{ columns: Array<{ key: string; label: string; unit?: string }>; rows: any[]; period: any } | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const metricOpts = defs.data?.metrics ?? [];
  const orderOptions = useMemo(() => [...f.groupBy.filter(Boolean).map((k) => ({ v: k, l: defs.data?.dimensions.find((d) => d.key === k)?.label ?? k })), ...f.metrics.map((k) => ({ v: k, l: metricOpts.find((m) => m.key === k)?.label ?? k }))], [f.groupBy, f.metrics, defs.data, metricOpts]);
  useEffect(() => { if (f.orderKey && !orderOptions.some((o) => o.v === f.orderKey)) set('orderKey', ''); }, [orderOptions, f.orderKey]);

  const validate = (forSave: boolean): string[] => {
    const e: string[] = [];
    const lim = defs.data?.limits;
    if (!f.metrics.length) e.push('Selecione ao menos uma métrica.');
    if (lim && f.metrics.length > lim.maxMetrics) e.push(`Selecione no máximo ${lim.maxMetrics} métricas.`);
    if (f.groupBy[0] && f.groupBy[0] === f.groupBy[1]) e.push('Os dois agrupamentos devem ser diferentes.');
    if (!f.groupBy[0] && f.groupBy[1]) e.push('Use o primeiro agrupamento antes do segundo.');
    if (f.periodKind === 'range' && (!f.from || !f.to || f.from > f.to)) e.push('Informe um período válido (data inicial anterior ou igual à final).');
    if (f.limit < 1 || f.limit > (lim?.maxRows ?? 5000)) e.push(`O limite de linhas deve estar entre 1 e ${lim?.maxRows ?? 5000}.`);
    if (forSave) {
      if (!f.name.trim()) e.push('Informe um nome para o relatório.');
      if (f.schedule) {
        const rec = toSchedule(f).recipients;
        if (!rec.length) e.push('Informe ao menos um destinatário para o agendamento.');
        if (rec.length > 20) e.push('No máximo 20 destinatários.');
        const bad = rec.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
        if (bad.length) e.push(`E-mail(s) inválido(s): ${bad.join(', ')}.`);
      } else if (f.periodKind === 'auto') e.push('Período automático só vale para relatórios agendados.');
    }
    return e;
  };
  const defForRun = () => { const d = toDefinition(f); if (!d.period) d.period = { preset: 'LAST_30_DAYS' }; return d; };

  const run = async () => {
    const e = validate(false); setErrs(e); if (e.length) return;
    setBusy('run'); setRunErr(null);
    try { setResult(await bv.post('/reports/custom', defForRun())); } catch (x) { setRunErr(errMsg(x)); setResult(null); } finally { setBusy(null); }
  };
  const csv = async () => {
    const e = validate(false); setErrs(e); if (e.length) return;
    setBusy('csv');
    try { const t = await bv.post<string>('/reports/custom', defForRun(), { format: 'csv' }); saveBlob('relatorio-personalizado.csv', t); toast.success('Arquivo relatorio-personalizado.csv gerado.'); }
    catch (x) { toast.error(errMsg(x)); } finally { setBusy(null); }
  };
  const save = async () => {
    const e = validate(true); setErrs(e); if (e.length) return;
    setBusy('save');
    const body: any = { name: f.name.trim(), description: f.description.trim() || undefined, definition: toDefinition(f) };
    if (f.schedule) body.schedule = toSchedule(f); else if (editing) body.schedule = null; else body.schedule = undefined;
    try {
      if (editing) await bv.put(`/reports/saved/${editing}`, body); else await bv.post('/reports/saved', body);
      toast.success(editing ? 'Relatório atualizado.' : 'Relatório salvo.');
      setEditing(null); setF(EMPTY); await saved.reload();
    } catch (x) { setErrs([errMsg(x)]); } finally { setBusy(null); }
  };
  const runSaved = async (r: any, send: boolean) => {
    try {
      const out = await bv.post<any>(`/reports/saved/${r.id}/run`, undefined, send ? { send: 'true' } : undefined);
      const isCsv = (r.schedule?.format ?? 'CSV') === 'CSV';
      await bv.download(`/reports/exports/${out.jobId}/download`, `${r.name.replace(/[^\w-]+/g, '-').toLowerCase()}.${isCsv ? 'csv' : 'json'}`);
      toast.success(send && out.sent ? `Relatório gerado e enviado a ${out.sent} destinatário(s).` : 'Relatório gerado.');
    } catch (x) { toast.error(errMsg(x)); }
  };

  const colLabel = (c: { key: string; label: string; unit?: string }) => c.label;
  const cell = (c: { key: string; unit?: string }, v: any) => {
    if (v == null) return '—';
    if (c.key === 'channel') return CHANNEL_LABEL[v] ?? v;
    if (c.key === 'queue' || c.key === 'agent') return v;
    if (c.key === 'status') return STATUS_LABEL[v] ?? v;
    if (c.key === 'closeReason') return CLOSE_LABEL[v] ?? v;
    if (c.key === 'weekday') return WEEKDAYS[v] ?? v;
    if (c.key === 'hourOfDay') return `${String(v).padStart(2, '0')}h`;
    if (c.key === 'day') return fmtYmd(v);
    if (typeof v === 'number') return fmtUnit(c.unit ?? 'count', v);
    return String(v);
  };

  return (
    <div className="flex flex-col gap-4">
      <StateGate loading={defs.loading} error={defs.error} data={defs.data} onRetry={defs.reload}>
        <Card title={editing ? 'Editar relatório personalizado' : 'Montar relatório personalizado'}>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
            {errs.length > 0 && <Banner tone="danger" title="Corrija antes de continuar">{<ul className="list-disc pl-5">{errs.map((x) => <li key={x}>{x}</li>)}</ul>}</Banner>}
            <div className="max-h-72 overflow-y-auto rounded-md">
              <CheckGroup legend={`Métricas (${f.metrics.length} de até ${defs.data?.limits.maxMetrics ?? 20})`} options={metricOpts.map((m) => ({ value: m.key, label: m.label }))} value={f.metrics} onChange={(v) => set('metrics', v)} cols="sm:grid-cols-2 lg:grid-cols-3" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Agrupar por (1º nível)" value={f.groupBy[0]} onChange={(e) => set('groupBy', [e.target.value, f.groupBy[1]])}><option value="">Sem agrupamento (total geral)</option>{defs.data?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select>
              <Select label="Agrupar por (2º nível)" value={f.groupBy[1]} disabled={!f.groupBy[0]} onChange={(e) => set('groupBy', [f.groupBy[0], e.target.value])}><option value="">Nenhum</option>{defs.data?.dimensions.filter((d) => d.key !== f.groupBy[0]).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select>
            </div>
            <fieldset className="rounded-md border border-bv-border p-3">
              <legend className="px-1 text-sm font-medium">Período</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select label="Tipo" value={f.periodKind} onChange={(e) => set('periodKind', e.target.value as any)}><option value="preset">Período pré-definido</option><option value="range">Intervalo de datas</option><option value="auto">Automático (só agendados)</option></Select>
                {f.periodKind === 'preset' && <Select label="Período" value={f.preset} onChange={(e) => set('preset', e.target.value)}>{(defs.data?.periods.presets ?? []).map((p) => <option key={p} value={p}>{PRESET_LABEL[p] ?? p}</option>)}</Select>}
                {f.periodKind === 'range' && <><TextField label="De" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /><TextField label="Até (inclusive)" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></>}
                {f.periodKind === 'auto' && <p className="self-end text-sm text-bv-muted">Diário: ontem · Semanal: semana anterior · Mensal: mês anterior.</p>}
              </div>
            </fieldset>
            <details className="rounded-md border border-bv-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Filtros ({f.channel.length + f.queueId.length + f.agentId.length + f.status.length + f.closeReason.length} selecionado(s))</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <CheckGroup legend="Canal" options={(defs.data?.filters.find((x) => x.key === 'channel')?.values ?? []).map((v) => ({ value: v, label: CHANNEL_LABEL[v] ?? v }))} value={f.channel} onChange={(v) => set('channel', v)} cols="" />
                <CheckGroup legend="Situação" options={['BOT', 'WAITING', 'ACTIVE', 'CLOSED'].map((v) => ({ value: v, label: STATUS_LABEL[v] }))} value={f.status} onChange={(v) => set('status', v)} cols="" />
                <CheckGroup legend="Motivo de encerramento" options={Object.entries(CLOSE_LABEL).map(([value, label]) => ({ value, label }))} value={f.closeReason} onChange={(v) => set('closeReason', v)} cols="" />
                <CheckGroup legend="Fila" options={Object.entries(names.queues).map(([value, label]) => ({ value, label }))} value={f.queueId} onChange={(v) => set('queueId', v)} cols="" />
                <CheckGroup legend="Atendente" options={Object.entries(names.agents).map(([value, label]) => ({ value, label }))} value={f.agentId} onChange={(v) => set('agentId', v)} cols="" />
              </div>
              <p className="mt-2 text-xs text-bv-muted">Filas e atendentes listados são os que tiveram atendimentos nos últimos 30 dias.</p>
            </details>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select label="Ordenar por" value={f.orderKey} onChange={(e) => set('orderKey', e.target.value)}><option value="">Padrão</option>{orderOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select>
              <Select label="Sentido" value={f.orderDir} disabled={!f.orderKey} onChange={(e) => set('orderDir', e.target.value as any)}><option value="desc">Decrescente</option><option value="asc">Crescente</option></Select>
              <TextField label="Máximo de linhas" type="number" min={1} max={defs.data?.limits.maxRows ?? 5000} value={f.limit} onChange={(e) => set('limit', Number(e.target.value))} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'run'}>Executar</Button>
              <Button variant="secondary" loading={busy === 'csv'} onClick={csv}>Exportar CSV</Button>
              {editing && <Button variant="ghost" onClick={() => { setEditing(null); setF(EMPTY); setErrs([]); }}>Cancelar edição</Button>}
            </div>

            {canExport && (
              <fieldset className="flex flex-col gap-3 rounded-md border border-bv-border p-3">
                <legend className="px-1 text-sm font-medium">Salvar e agendar</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField label="Nome do relatório" maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} />
                  <TextField label="Descrição (opcional)" maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} />
                </div>
                <Checkbox label="Enviar automaticamente por e-mail (agendamento)" checked={f.schedule} onChange={(e) => set('schedule', e.target.checked)} />
                {f.schedule && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Select label="Frequência" value={f.frequency} onChange={(e) => set('frequency', e.target.value as any)}>{Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                    <Select label="Formato do arquivo" value={f.format} onChange={(e) => set('format', e.target.value as any)}><option value="CSV">CSV</option><option value="JSON">JSON</option></Select>
                    <Select label="Hora do envio" value={f.hour} onChange={(e) => set('hour', Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</Select>
                    {f.frequency === 'WEEKLY' && <Select label="Dia da semana" value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>}
                    {f.frequency === 'MONTHLY' && <Select label="Dia do mês" value={f.dayOfMonth} onChange={(e) => set('dayOfMonth', Number(e.target.value))}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select>}
                    <div className="sm:col-span-3"><TextArea label="Destinatários (e-mails, um por linha)" hint="Até 20. O e-mail leva um link autenticado para o arquivo; apenas usuários do Balcão conseguem baixá-lo." value={f.recipients} onChange={(e) => set('recipients', e.target.value)} /></div>
                    <Checkbox label="Agendamento ativo" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
                  </div>
                )}
                <div><Button variant="secondary" loading={busy === 'save'} onClick={save}>{editing ? 'Salvar alterações' : 'Salvar relatório'}</Button></div>
              </fieldset>
            )}
          </form>
        </Card>
      </StateGate>

      {runErr && <Banner tone="danger" title="Não foi possível executar">{runErr}</Banner>}
      {result && (
        <Card title="Resultado">
          <p className="mb-2 text-sm text-bv-muted">{result.rows.length} linha(s) · período {fmtYmd(result.period?.fromLocal)} a {fmtYmd(result.period?.toLocal)}.</p>
          <DataTable caption="Resultado do relatório personalizado" rows={result.rows.map((r, i) => ({ r, i }))} rowKey={(x) => String(x.i)} empty="Nenhum dado para os critérios informados."
            columns={result.columns.map((c) => ({ key: c.key, header: colLabel(c), className: typeof result.rows[0]?.[c.key] === 'number' ? 'text-right tabular-nums' : undefined, render: (x: { r: any }) => (c.key === 'queue' ? (x.r.queueName ?? names.queues[x.r.queue] ?? (x.r.queue ? 'Fila removida' : 'Sem fila')) : c.key === 'agent' ? (x.r.agentName ?? names.agents[x.r.agent] ?? (x.r.agent ? 'Atendente removido' : 'Sem atendente')) : cell(c, x.r[c.key])) }))
              .filter((c) => c.key !== 'queueName' && c.key !== 'agentName')} />
        </Card>
      )}

      <Card title="Relatórios salvos">
        <StateGate loading={saved.loading} error={saved.error} data={saved.data} onRetry={saved.reload}>
          {saved.data && (saved.data.reports.length === 0 ? <EmptyState title="Nenhum relatório salvo.">Monte um relatório acima e use “Salvar relatório”.</EmptyState> : (
            <DataTable caption="Relatórios personalizados salvos" rows={saved.data.reports} rowKey={(r) => r.id} columns={[
              { key: 'n', header: 'Relatório', render: (r) => <><strong>{r.name}</strong>{r.description && <span className="block text-xs text-bv-muted">{r.description}</span>}</> },
              { key: 's', header: 'Agendamento', render: (r) => (r.schedule ? <><Badge tone={r.schedule.active ? 'success' : 'neutral'}>{r.schedule.active ? 'Ativo' : 'Pausado'}</Badge> <span className="text-xs">{FREQ_LABEL[r.schedule.frequency]} · {r.schedule.format} · {r.schedule.recipients.length} destinatário(s){r.schedule.nextRunAt ? ` · próximo: ${fmtDateTime(r.schedule.nextRunAt)}` : ''}</span></> : <span className="text-bv-muted">Sem agendamento</span>) },
              { key: 'u', header: 'Última execução', render: (r) => (r.schedule?.lastRunAt ? fmtDateTime(r.schedule.lastRunAt) : '—') },
              { key: 'a', header: 'Ações', render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => { setF(fromSaved(r)); setEditing(canExport ? r.id : null); setErrs([]); setResult(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{canExport ? 'Editar' : 'Abrir'}<span className="bv-sr-only"> {r.name}</span></Button>
                  {canExport && <Button size="sm" variant="secondary" onClick={() => void runSaved(r, false)}>Gerar e baixar<span className="bv-sr-only"> {r.name}</span></Button>}
                  {canExport && r.schedule?.recipients?.length > 0 && <Button size="sm" variant="secondary" onClick={() => void runSaved(r, true)}>Gerar e enviar<span className="bv-sr-only"> {r.name}</span></Button>}
                  {canExport && <Button size="sm" variant="danger" onClick={() => setDel(r)}>Excluir<span className="bv-sr-only"> {r.name}</span></Button>}
                </div>) },
            ]} />
          ))}
        </StateGate>
      </Card>
      <ConfirmDialog open={!!del} danger title="Excluir relatório salvo" confirmLabel="Excluir" onClose={() => setDel(null)}
        message={<>Excluir “{del?.name}”? O agendamento também será removido. Arquivos já gerados continuam disponíveis.</>}
        onConfirm={async () => { try { await bv.del(`/reports/saved/${del.id}`); toast.success('Relatório excluído.'); await saved.reload(); } catch (x) { toast.error(errMsg(x)); } }} />
    </div>
  );
}
