'use client';
/** Relatório mensal da contratada (TR 8.2.9): geração, visualização do documento e download (JSON/CSV) com SHA-256. */
import React, { useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { CHANNEL_LABEL, fmtBytes, fmtDateTime, fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, DataTable, StatCard, TextField, useToast } from '../../_ui/ui';
import { StateGate, fmtMonth, fmtUnit, fmtYmd, todayStr, useApi } from './lib';

const KIND: Record<string, string> = { MONTHLY: 'Relatório mensal (JSON)', MONTHLY_CSV: 'Relatório mensal (CSV)' };
const TASK_KIND: Record<string, string> = { INTERNAL: 'Tarefas internas', DEMAND: 'Demandas', SERVICE_REQUEST: 'Solicitações de serviço' };

function MonthlyDoc({ doc }: { doc: any }) {
  const ind = doc.indicators ?? {};
  const iqa = ind.iqa ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Atendimentos" value={fmtNumber(doc.attendances?.total ?? 0)} hint={`${fmtNumber(doc.attendances?.closed ?? 0)} encerrados · ${fmtNumber(doc.attendances?.abandoned ?? 0)} abandonados`} />
        <StatCard label="Licenças em uso" value={fmtNumber(doc.licenses?.total ?? 0)} hint={`${doc.licenses?.atendentes ?? 0} atendentes · ${doc.licenses?.supervisores ?? 0} supervisores`} />
        <StatCard label="IQA do mês" value={fmtUnit('percent', iqa.value)} hint={iqa.goal != null ? `Meta ${iqa.goal}% (mês ${iqa.contractMonth} do contrato) · ${iqa.reachedGoal ? 'meta atingida' : 'abaixo da meta'} · glosa ${iqa.glosaPct == null ? 'não apurada' : `${iqa.glosaPct}%`}` : iqa.note} tone={iqa.reachedGoal === false ? 'danger' : 'neutral'} />
        <StatCard label="Armazenamento (máximo)" value={fmtBytes(doc.storage?.maxBytes ?? 0)} />
      </div>
      <Card title="Indicadores do mês">
        <DataTable caption="Indicadores do mês" rows={[
          ['NPS', fmtUnit('score', ind.nps), `${fmtNumber(ind.npsResponses ?? 0)} resposta(s)`], ['TME médio / P90', `${fmtUnit('seconds', ind.tmeAvgSec)} / ${fmtUnit('seconds', ind.tmeP90Sec)}`, ''],
          ['TMA médio / P90', `${fmtUnit('seconds', ind.tmaAvgSec)} / ${fmtUnit('seconds', ind.tmaP90Sec)}`, ''], ['TMR médio', fmtUnit('seconds', ind.tmrAvgSec), ''],
          ['FCR', fmtUnit('percent', ind.fcrRate), ''], ['SLA cumprido', fmtUnit('percent', ind.slaRate), `${fmtNumber(ind.slaViolations ?? 0)} violação(ões)`], ['Contenção do bot', fmtUnit('percent', ind.botContainmentRate), ''],
        ]} rowKey={(r) => r[0]} columns={[{ key: 'a', header: 'Indicador', render: (r) => r[0] }, { key: 'b', header: 'Valor', render: (r) => r[1] }, { key: 'c', header: 'Observação', render: (r) => r[2] || '—' }]} />
      </Card>
      <Card title="Mensageria e canais">
        <DataTable caption="Consumo de mensageria no mês" rows={doc.messaging ?? []} rowKey={(r: any) => r.item} columns={[{ key: 'i', header: 'Item', render: (r: any) => (r.trItem ? `Item ${r.trItem} — ` : '') + r.label }, { key: 'q', header: 'Quantidade', render: (r: any) => fmtNumber(r.quantity) }]} />
        <p className="mt-3 text-sm">Voz: {fmtNumber(doc.voice?.minutes ?? 0)} min · {fmtNumber(doc.voice?.calls ?? 0)} chamadas ({fmtNumber(doc.voice?.answered ?? 0)} atendidas, {fmtNumber(doc.voice?.abandoned ?? 0)} abandonadas) · pico de {fmtNumber(doc.voice?.peakConcurrentCalls ?? 0)} chamadas simultâneas.</p>
        <div className="mt-3"><DataTable caption="Atendimentos por canal" rows={doc.attendances?.byChannel ?? []} rowKey={(r: any) => r.channel} columns={[{ key: 'c', header: 'Canal', render: (r: any) => CHANNEL_LABEL[r.channel] ?? r.channel }, { key: 't', header: 'Iniciados', render: (r: any) => fmtNumber(r.total) }, { key: 'e', header: 'Encerrados', render: (r: any) => fmtNumber(r.closed) }]} /></div>
      </Card>
      <Card title="Service desk e horas contratuais">
        <DataTable caption="Tarefas criadas no mês" rows={Object.entries(doc.serviceDesk?.createdByKind ?? {}) as Array<[string, any]>} rowKey={(r) => r[0]} empty="Nenhuma tarefa criada no mês."
          columns={[{ key: 'k', header: 'Tipo', render: (r) => TASK_KIND[r[0]] ?? r[0] }, { key: 't', header: 'Criadas', render: (r) => fmtNumber(r[1].total) }, { key: 's', header: 'Por situação', render: (r) => Object.entries(r[1].byStatus).map(([s, n]) => `${s}: ${n}`).join(' · ') }]} />
        <p className="mt-3 text-sm">Concluídas no mês: {fmtNumber(doc.serviceDesk?.completedInMonth ?? 0)}.</p>
        {Object.keys(doc.contractHours ?? {}).length > 0 && <p className="mt-1 text-sm">Horas contratuais: {Object.entries(doc.contractHours).map(([k, v]) => `${k}: ${v} h`).join(' · ')}.</p>}
        <p className="mt-1 text-xs text-bv-muted">Início do contrato: {fmtYmd(doc.contractStartDate?.value)} ({doc.contractStartDate?.source === 'settings' ? 'configurado' : 'inferido da primeira conversa'}).</p>
      </Card>
    </div>
  );
}

export function MonthlyTab() {
  const { can } = useBvSession();
  const toast = useToast();
  const canExport = can('report:export');
  const prev = (() => { const t = todayStr(); const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); })();
  const [month, setMonth] = useState(prev);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<any | null>(null);
  const files = useApi<{ exports: any[] }>('/reports/exports');
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) { setErr('Informe o mês no formato AAAA-MM (ex.: 2026-11).'); return; }
    setBusy(true); setErr(null);
    try { setOut(await bv.post('/reports/monthly', { month })); toast.success(`Relatório mensal de ${fmtMonth(month)} gerado.`); await files.reload(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const dl = async (id: string, name: string) => { try { await bv.download(`/reports/exports/${id}/download`, name); } catch (x) { toast.error(errMsg(x)); } };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Gerar relatório mensal da contratada (TR 8.2.9)">
        <form onSubmit={generate} className="flex flex-wrap items-end gap-3">
          <div className="w-48"><TextField label="Mês de referência" type="month" placeholder="AAAA-MM" pattern="\d{4}-\d{2}" value={month} max={todayStr().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} hint="Formato AAAA-MM" /></div>
          <Button type="submit" loading={busy} disabled={!canExport}>Gerar relatório</Button>
        </form>
        {!canExport && <div className="mt-3"><Banner tone="warning">Seu perfil não tem permissão para gerar o relatório mensal (report:export). Os arquivos já gerados podem ser baixados abaixo.</Banner></div>}
        {err && <div className="mt-3"><Banner tone="danger">{err}</Banner></div>}
        <p className="mt-3 text-xs text-bv-muted">Cada geração cria novos arquivos (JSON e CSV) armazenados com SHA-256 para conferência.</p>
      </Card>
      {out && (
        <Card title={`Relatório de ${fmtMonth(out.document?.month)} gerado`} actions={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => void dl(out.jobId, `relatorio-mensal-${out.document.month}.json`)}>Baixar JSON</Button><Button size="sm" variant="secondary" onClick={() => void dl(out.csvJobId, `relatorio-mensal-${out.document.month}.csv`)}>Baixar CSV</Button></div>}>
          <p className="mb-3 break-all text-xs text-bv-muted">SHA-256 (JSON): <code>{out.sha256}</code><br />SHA-256 (CSV): <code>{out.csvSha256}</code></p>
          <MonthlyDoc doc={out.document} />
        </Card>
      )}
      <Card title="Arquivos gerados">
        <StateGate loading={files.loading} error={files.error} data={files.data} onRetry={files.reload}>
          {files.data && <DataTable caption="Arquivos de relatórios gerados" rows={files.data.exports} rowKey={(r) => r.id} empty="Nenhum arquivo gerado ainda." columns={[
            { key: 'n', header: 'Arquivo', render: (r) => <>{KIND[r.kind] ?? r.name ?? 'Relatório agendado'}{r.month && <span className="block text-xs text-bv-muted">Mês {fmtMonth(r.month)}</span>}</> },
            { key: 'f', header: 'Formato', render: (r) => r.format }, { key: 's', header: 'Situação', render: (r) => <Badge tone={r.status === 'DONE' ? 'success' : r.status === 'FAILED' ? 'danger' : 'neutral'}>{r.status === 'DONE' ? 'Concluído' : r.status === 'FAILED' ? 'Falhou' : 'Em processamento'}</Badge> },
            { key: 'z', header: 'Tamanho', render: (r) => (r.sizeBytes == null ? '—' : fmtBytes(r.sizeBytes)) }, { key: 'c', header: 'Gerado em', render: (r) => fmtDateTime(r.createdAt) }, { key: 'e', header: 'Expira em', render: (r) => fmtDateTime(r.expiresAt) },
            { key: 'a', header: 'Ação', render: (r) => (r.status === 'DONE' ? <Button size="sm" variant="secondary" onClick={() => void dl(r.id, `relatorio-${r.month ?? r.id}.${String(r.format).toLowerCase()}`)}>Baixar<span className="bv-sr-only"> {KIND[r.kind] ?? r.name ?? 'relatório'} de {fmtDateTime(r.createdAt)}</span></Button> : r.error ? <span className="text-xs text-bv-danger">{r.error}</span> : '—') },
          ]} />}
        </StateGate>
      </Card>
    </div>
  );
}
