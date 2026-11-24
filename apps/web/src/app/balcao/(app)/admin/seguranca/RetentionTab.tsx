'use client';
import React, { useCallback, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime, fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, DataTable, Dialog, TextArea, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, Unavailable, errFull, useLoad } from '../usuarios/_shared';
import StrongConfirm from './StrongConfirm';

type Kind = 'MESSAGES' | 'RECORDINGS' | 'LOGS' | 'AUDIT';
const KIND_LABEL: Record<Kind, string> = { MESSAGES: 'Mensagens e anexos', RECORDINGS: 'Gravações de chamadas', LOGS: 'Logs de integração', AUDIT: 'Trilha de auditoria' };
const KIND_DAYS: Record<Kind, 'messagesDays' | 'recordingsDays' | 'logsDays' | 'auditDays'> = { MESSAGES: 'messagesDays', RECORDINGS: 'recordingsDays', LOGS: 'logsDays', AUDIT: 'auditDays' };
interface KindResult { kind: Kind; cutoff: string | null; candidates?: number; purged: number; skipped?: string; more: boolean }
interface RunResult { dryRun: boolean; legalHold: boolean; kinds: KindResult[] }
interface Run { id: string; kind: Kind; purged: number; cutoff: string; createdAt: string }
interface Hold { active: boolean; basis?: string; since?: string; until?: string | null }
interface OrgSettings { settings: { retention: Record<string, number> } }

function HoldDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [basis, setBasis] = useState(''); const [until, setUntil] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (basis.trim().length < 5) { setErr('Informe a base legal da guarda (mínimo de 5 caracteres).'); return; }
    setBusy(true); setErr(null);
    try { await bv.put('/security/legal-hold', { active: true, basis: basis.trim(), until: until ? new Date(until).toISOString() : null }); toast.success('Guarda legal ativada. Retenção, anonimização e exclusão estão suspensas.'); onSaved(); onClose(); }
    catch (e2) { setErr(errFull(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Ativar guarda legal" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-hold" loading={busy}>Ativar guarda legal</Button></>}>
      <form id="form-hold" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Banner tone="warning">Enquanto a guarda estiver ativa, a limpeza de mensagens, gravações e auditoria e as solicitações de anonimização/exclusão ficam suspensas.</Banner>
        <TextArea label="Base legal / motivo" required value={basis} onChange={(e) => setBasis(e.target.value)} error={err} maxLength={500} hint="Ex.: ordem judicial, processo nº…" />
        <TextField label="Vigente até (opcional)" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} hint="Vazio mantém a guarda até ser desativada manualmente." />
      </form>
    </Dialog>
  );
}

export default function RetentionTab() {
  const { can } = useBvSession();
  const toast = useToast();
  const org = useLoad(() => bv.get<OrgSettings>('/admin/org'), [], can('org:manage'));
  const runs = useLoad(() => bv.get<{ items: Run[] }>('/security/retention/runs').then((r) => r.items), []);
  const hold = useLoad(() => bv.get<{ legalHold: Hold | null; effective: boolean }>('/security/legal-hold'), []);
  const [sim, setSim] = useState<RunResult | null>(null);
  const [simBusy, setSimBusy] = useState(false); const [simErr, setSimErr] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [exec, setExec] = useState(false); const [holdDlg, setHoldDlg] = useState(false); const [offHold, setOffHold] = useState(false);
  const closeExec = useCallback(() => setExec(false), []);
  const closeHold = useCallback(() => setHoldDlg(false), []);
  const closeOff = useCallback(() => setOffHold(false), []);

  if (runs.unavailable) return <Unavailable what="A política de retenção" />;

  const simulate = async () => {
    setSimBusy(true); setSimErr(null);
    try { setSim(await bv.post<RunResult>('/security/retention/run', undefined, { dryRun: true })); } catch (e) { setSimErr(errFull(e)); setSim(null); } finally { setSimBusy(false); }
  };
  const execute = async () => {
    const r = await bv.post<RunResult>('/security/retention/run');
    setLastRun(r); toast.success('Retenção executada.'); runs.reload();
  };
  const deactivateHold = async () => {
    try { await bv.put('/security/legal-hold', { active: false }); toast.success('Guarda legal desativada.'); hold.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const resCols = (dry: boolean): Column<KindResult>[] => [
    { key: 'k', header: 'Tipo de dado', render: (r) => <span className="font-medium">{KIND_LABEL[r.kind]}</span> },
    { key: 'c', header: 'Apaga o que for anterior a', render: (r) => (r.cutoff ? fmtDateTime(r.cutoff) : '—') },
    { key: 'n', header: dry ? 'Registros que seriam apagados' : 'Registros apagados', render: (r) => (r.skipped ? '—' : fmtNumber(dry ? r.candidates ?? 0 : r.purged)) },
    { key: 's', header: 'Observação', render: (r) => (r.skipped ? <Badge tone="warning">Ignorado: {r.skipped}</Badge> : r.more ? <Badge tone="primary">Há mais registros: execute novamente</Badge> : <Badge tone="success">Completo</Badge>) },
  ];
  const histCols: Column<Run>[] = [
    { key: 'd', header: 'Executada em', render: (r) => fmtDateTime(r.createdAt) },
    { key: 'k', header: 'Tipo', render: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { key: 'c', header: 'Corte', render: (r) => fmtDateTime(r.cutoff) },
    { key: 'p', header: 'Registros apagados', render: (r) => fmtNumber(r.purged) },
  ];
  const ret = org.data?.settings.retention;
  const h = hold.data?.legalHold;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Política atual">
        {ret ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-4">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <div key={k}><dt className="text-bv-muted">{KIND_LABEL[k]}</dt><dd className="font-medium">{fmtNumber(ret[KIND_DAYS[k]])} dias</dd></div>)}
          </dl>
        ) : <p className="text-sm text-bv-muted">{can('org:manage') ? 'Carregando…' : 'Sem permissão para ver os prazos configurados (org:manage). A simulação abaixo mostra as datas de corte aplicadas.'}</p>}
        <p className="mt-2 text-xs text-bv-muted">Os prazos são editados em Configurações do órgão. A auditoria nunca é apagada antes do mínimo definido no servidor. A limpeza automática roda diariamente.</p>
      </Card>

      <Card title="Guarda legal" actions={hold.data && (h?.active ? <Button size="sm" variant="secondary" onClick={() => setOffHold(true)}>Desativar guarda</Button> : <Button size="sm" onClick={() => setHoldDlg(true)}>Ativar guarda legal</Button>)}>
        {hold.error ? <ErrorBox message={hold.error} onRetry={hold.reload} /> : !hold.data ? <Loading label="Carregando guarda legal" /> : (
          <div className="flex flex-col gap-2 text-sm">
            <p><Badge tone={hold.data.effective ? 'warning' : 'neutral'}>{hold.data.effective ? 'Guarda legal vigente' : h?.active ? 'Guarda expirada' : 'Sem guarda legal'}</Badge></p>
            {h?.active && <p>Base: {h.basis ?? '—'}{h.since ? ` · desde ${fmtDateTime(h.since)}` : ''}{h.until ? ` · até ${fmtDateTime(h.until)}` : ''}</p>}
            <p className="text-xs text-bv-muted">Suspende a limpeza de mensagens, gravações e auditoria e recusa anonimização/exclusão de titulares.</p>
          </div>
        )}
      </Card>

      <Card title="Simular e executar">
        <div className="flex flex-col gap-3">
          <p className="text-sm">A <strong>simulação</strong> só conta os registros que seriam apagados; nada é removido. A <strong>execução</strong> apaga definitivamente.</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={simBusy} onClick={() => void simulate()}>Simular (não apaga nada)</Button>
            <Button variant="danger" onClick={() => setExec(true)}>Executar agora…</Button>
          </div>
          <div role="status" aria-live="polite">
            {simErr && <Banner tone="danger">{simErr}</Banner>}
            {sim && (
              <div className="flex flex-col gap-2">
                <Banner tone="primary" title="Resultado da simulação">{sim.legalHold ? 'Há guarda legal vigente: mensagens, gravações e auditoria serão ignoradas.' : 'Nenhum dado foi apagado.'}</Banner>
                <DataTable caption="Simulação da retenção" columns={resCols(true)} rows={sim.kinds} rowKey={(r) => r.kind} />
              </div>
            )}
            {lastRun && (
              <div className="mt-2 flex flex-col gap-2">
                <Banner tone="success" title="Execução concluída">Os números abaixo foram apagados.</Banner>
                <DataTable caption="Resultado da execução da retenção" columns={resCols(false)} rows={lastRun.kinds} rowKey={(r) => r.kind} />
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title="Histórico de execuções">
        {runs.error ? <ErrorBox message={runs.error} onRetry={runs.reload} /> : runs.loading && !runs.data ? <Loading label="Carregando histórico" />
          : <DataTable caption="Execuções anteriores da retenção" columns={histCols} rows={runs.data ?? []} rowKey={(r) => r.id} empty="Nenhuma execução registrada." />}
      </Card>

      {exec && <StrongConfirm title="Executar retenção agora" phrase="EXECUTAR" confirmLabel="Apagar dados vencidos" onConfirm={execute} onClose={closeExec}
        warning="Os dados anteriores às datas de corte serão apagados de forma definitiva (corpo e anexos das mensagens, gravações, logs e auditoria vencida). Rode a simulação antes para conferir o volume." />}
      {holdDlg && <HoldDialog onClose={closeHold} onSaved={hold.reload} />}
      {offHold && <StrongConfirm title="Desativar guarda legal" phrase="DESATIVAR" danger={false} confirmLabel="Desativar guarda" onConfirm={deactivateHold} onClose={closeOff}
        warning="Ao desativar, a limpeza automática volta a apagar dados vencidos e as solicitações de anonimização/exclusão voltam a ser atendidas." />}
    </div>
  );
}
