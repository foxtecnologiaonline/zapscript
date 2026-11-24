'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, DataTable, Dialog, Select, TextArea, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, Unavailable, errFull, fieldErrors, useLoad } from '../usuarios/_shared';

type Sev = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type IncStatus = 'OPEN' | 'CONTAINED' | 'CLOSED';
interface Incident {
  id: string; version: number; title: string; description: string; dataAffected: string[]; affectedSubjects: number | null; severity: Sev; status: IncStatus; awareAt: string; deadlineAt: string;
  notifiedAt: string | null; notifiedTo: string | null; measures: string | null; createdAt: string; updatedAt: string;
}
const SEV: Record<Sev, { label: string; tone: 'neutral' | 'primary' | 'warning' | 'danger' }> = { LOW: { label: 'Baixa', tone: 'neutral' }, MEDIUM: { label: 'Média', tone: 'primary' }, HIGH: { label: 'Alta', tone: 'warning' }, CRITICAL: { label: 'Crítica', tone: 'danger' } };
const STATUS: Record<IncStatus, string> = { OPEN: 'Aberto', CONTAINED: 'Contido', CLOSED: 'Encerrado' };

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(+d)) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function hoursLeft(ms: number): string { const a = Math.abs(ms); const h = Math.floor(a / 3_600_000); const m = Math.floor((a % 3_600_000) / 60_000); return `${h}h ${String(m).padStart(2, '0')}min`; }

/** Estado do prazo de 24 h; nunca só cor: sempre texto. */
function DeadlineBadge({ i, now }: { i: Incident; now: number }) {
  if (i.notifiedAt) {
    const late = Date.parse(i.notifiedAt) > Date.parse(i.deadlineAt);
    return <div className="text-xs"><Badge tone={late ? 'warning' : 'success'}>{late ? 'Comunicado fora do prazo' : 'Comunicado no prazo'}</Badge><div className="mt-1">{fmtDateTime(i.notifiedAt)}</div></div>;
  }
  if (i.status === 'CLOSED') return <Badge tone="neutral">Encerrado sem comunicação registrada</Badge>;
  const left = Date.parse(i.deadlineAt) - now;
  return left < 0
    ? <div className="text-xs"><Badge tone="danger">PRAZO VENCIDO há {hoursLeft(left)}</Badge><div className="mt-1">Limite: {fmtDateTime(i.deadlineAt)}</div></div>
    : <div className="text-xs"><Badge tone={left < 6 * 3_600_000 ? 'warning' : 'primary'}>Faltam {hoursLeft(left)}</Badge><div className="mt-1">Limite: {fmtDateTime(i.deadlineAt)}</div></div>;
}

function IncidentDialog({ inc, onClose, onSaved }: { inc: Incident | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!inc;
  const [title, setTitle] = useState(inc?.title ?? ''); const [desc, setDesc] = useState(inc?.description ?? '');
  const [data, setData] = useState((inc?.dataAffected ?? []).join(', ')); const [subjects, setSubjects] = useState(inc?.affectedSubjects != null ? String(inc.affectedSubjects) : '');
  const [sev, setSev] = useState<Sev>(inc?.severity ?? 'MEDIUM'); const [status, setStatus] = useState<IncStatus>(inc?.status ?? 'OPEN');
  const [aware, setAware] = useState(toLocal(inc?.awareAt ?? new Date().toISOString()));
  const [notifiedAt, setNotifiedAt] = useState(toLocal(inc?.notifiedAt ?? null)); const [notifiedTo, setNotifiedTo] = useState(inc?.notifiedTo ?? ''); const [measures, setMeasures] = useState(inc?.measures ?? '');
  const [history, setHistory] = useState<Array<{ version: number; at: string }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!inc) return; let alive = true; bv.get<{ history: Array<{ version: number; at: string }> }>(`/security/incidents/${inc.id}`).then((r) => { if (alive) setHistory(r.history ?? []); }).catch(() => undefined); return () => { alive = false; }; }, [inc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (title.trim().length < 5) errs.title = 'Informe o título (mínimo de 5 caracteres).';
    if (desc.trim().length < 10) errs.description = 'Descreva o incidente (mínimo de 10 caracteres).';
    if (!editing && !aware) errs.awareAt = 'Informe quando a equipe tomou ciência do incidente.';
    const n = subjects.trim() === '' ? null : Number(subjects); if (n !== null && (!Number.isInteger(n) || n < 0)) errs.affectedSubjects = 'Informe um número inteiro (0 ou mais).';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    const common = {
      title: title.trim(), description: desc.trim(), dataAffected: [...new Set(data.split(',').map((x) => x.trim()).filter(Boolean))], affectedSubjects: n, severity: sev,
      notifiedAt: toIso(notifiedAt), notifiedTo: notifiedTo.trim() || null, measures: measures.trim() || null,
    };
    setBusy(true);
    try {
      if (inc) await bv.patch(`/security/incidents/${inc.id}`, { ...common, status }); else await bv.post('/security/incidents', { ...common, awareAt: toIso(aware) });
      toast.success(editing ? 'Incidente atualizado.' : 'Incidente registrado. O prazo de 24 h para comunicar o contratante já está correndo.'); onSaved(); onClose();
    } catch (err) { const m = fieldErrors(err); setErrors(m); setFormErr(errFull(err)); } finally { setBusy(false); }
  };
  const deadline = aware ? new Date(new Date(aware).getTime() + 24 * 3_600_000).toISOString() : null;
  return (
    <Dialog open onClose={onClose} title={editing ? 'Incidente de segurança' : 'Registrar incidente de segurança'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-incidente" loading={busy}>{editing ? 'Salvar' : 'Registrar incidente'}</Button></>}>
      <form id="form-incidente" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <Banner tone="warning" title="Prazo de 24 horas">O contratante deve ser comunicado em até 24 h da ciência do incidente{deadline ? <> (limite atual: <strong>{fmtDateTime(deadline)}</strong>)</> : ''}. Registre abaixo quando e a quem a comunicação foi feita.</Banner>
        <TextField label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} maxLength={200} />
        <TextArea label="Descrição" required rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} error={errors.description} maxLength={5000} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Severidade" value={sev} onChange={(e) => setSev(e.target.value as Sev)}>{(Object.keys(SEV) as Sev[]).map((s) => <option key={s} value={s}>{SEV[s].label}</option>)}</Select>
          {editing && <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value as IncStatus)}>{(Object.keys(STATUS) as IncStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</Select>}
          <TextField label="Data e hora da ciência" type="datetime-local" required={!editing} value={aware} onChange={(e) => setAware(e.target.value)} disabled={editing} error={errors.awareAt} hint={editing ? 'Não pode ser alterada depois do registro.' : 'Quando a equipe soube do incidente (início do prazo de 24 h).'} />
          <TextField label="Titulares afetados (quantidade)" type="number" min={0} value={subjects} onChange={(e) => setSubjects(e.target.value)} error={errors.affectedSubjects} hint="Opcional; deixe vazio se desconhecido." />
          <TextField label="Dados afetados" value={data} onChange={(e) => setData(e.target.value)} error={errors.dataAffected} hint="Separe por vírgula. Ex.: mensagens, CPF, gravações." className="sm:col-span-2" />
          <TextField label="Comunicação ao contratante: data e hora" type="datetime-local" value={notifiedAt} onChange={(e) => setNotifiedAt(e.target.value)} error={errors.notifiedAt} hint="Preencha quando o contratante for comunicado." />
          <TextField label="Comunicado a (nome/cargo/e-mail)" value={notifiedTo} onChange={(e) => setNotifiedTo(e.target.value)} error={errors.notifiedTo} maxLength={200} />
        </div>
        <TextArea label="Medidas tomadas" rows={3} value={measures} onChange={(e) => setMeasures(e.target.value)} error={errors.measures} maxLength={5000} />
        {history.length > 0 && <p className="text-xs text-bv-muted">Histórico: {history.length} versão(ões) registrada(s); última em {fmtDateTime(history[0].at)}.</p>}
      </form>
    </Dialog>
  );
}

export default function IncidentsTab() {
  const { data, error, loading, unavailable, reload } = useLoad(() => bv.get<{ items: Incident[] }>('/security/incidents').then((r) => r.items), []);
  const [dlg, setDlg] = useState<{ inc: Incident | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const close = useCallback(() => setDlg(null), []);
  if (unavailable) return <Unavailable what="O registro de incidentes" />;
  const pending = (data ?? []).filter((i) => !i.notifiedAt && i.status !== 'CLOSED');
  const overdue = pending.filter((i) => Date.parse(i.deadlineAt) < now);
  const cols: Column<Incident>[] = [
    { key: 't', header: 'Incidente', render: (i) => <div><div className="font-medium">{i.title}</div><div className="text-xs text-bv-muted">{i.dataAffected.join(', ') || 'Dados não informados'}</div></div> },
    { key: 'sv', header: 'Severidade', render: (i) => <Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge> },
    { key: 'st', header: 'Situação', render: (i) => STATUS[i.status] },
    { key: 'a', header: 'Ciência', render: (i) => fmtDateTime(i.awareAt) },
    { key: 'd', header: 'Prazo de 24 h', render: (i) => <DeadlineBadge i={i} now={now} /> },
    { key: 'x', header: 'Ações', render: (i) => <Button size="sm" variant="secondary" aria-label={`Abrir incidente ${i.title}`} onClick={() => setDlg({ inc: i })}>{!i.notifiedAt && i.status !== 'CLOSED' ? 'Abrir e comunicar' : 'Abrir'}</Button> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Registro de incidentes de segurança com controle do prazo de 24 h para comunicar o contratante. Administradores recebem avisos internos enquanto o prazo estiver correndo.</p>
      {overdue.length > 0 && <Banner tone="danger" title="Prazo de 24 h vencido">{overdue.length} incidente(s) sem comunicação ao contratante: {overdue.map((i) => i.title).join('; ')}.</Banner>}
      {overdue.length === 0 && pending.length > 0 && <Banner tone="warning" title="Comunicação pendente">{pending.length} incidente(s) aguardam comunicação ao contratante dentro do prazo.</Banner>}
      <div className="flex justify-end"><Button onClick={() => setDlg({ inc: null })}>Registrar incidente</Button></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando incidentes" />
        : <DataTable caption="Incidentes de segurança" columns={cols} rows={data ?? []} rowKey={(i) => i.id} empty="Nenhum incidente registrado." />}
      {dlg && <IncidentDialog key={dlg.inc?.id ?? 'novo'} inc={dlg.inc} onClose={close} onSaved={reload} />}
    </div>
  );
}
