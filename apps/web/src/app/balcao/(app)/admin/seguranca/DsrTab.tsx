'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, DataTable, Dialog, Select, TextArea, TextField, useToast, type Column } from '../../../_ui/ui';
import { flatten } from '../auditoria/AuditDetail';
import { ErrorBox, Loading, Unavailable, errFull, fieldErrors, useLoad } from '../usuarios/_shared';
import StrongConfirm from './StrongConfirm';

type DsrType = 'ACCESS' | 'EXPORT' | 'DELETE' | 'ANONYMIZE';
type DsrStatus = 'OPEN' | 'DONE' | 'REJECTED';
interface Dsr {
  id: string; contactId: string; type: DsrType; status: DsrStatus; requestedAt: string; completedAt: string | null; handledById: string | null; origin: string;
  justification: string | null; text: string | null; rejectedReason: string | null; report: Record<string, unknown> | null;
}
const TYPE_LABEL: Record<DsrType, string> = { ACCESS: 'Acesso aos dados', EXPORT: 'Exportação (portabilidade)', ANONYMIZE: 'Anonimização', DELETE: 'Exclusão' };
const STATUS_LABEL: Record<DsrStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = { OPEN: { label: 'Aberta', tone: 'warning' }, DONE: { label: 'Atendida', tone: 'success' }, REJECTED: { label: 'Recusada', tone: 'neutral' } };
const DEADLINE_DAYS = 15; // LGPD art. 19, II
const DAY = 86_400_000;

function Deadline({ d }: { d: Dsr }) {
  const due = Date.parse(d.requestedAt) + DEADLINE_DAYS * DAY;
  if (d.status !== 'OPEN') return <span className="text-xs text-bv-muted">Encerrada em {fmtDateTime(d.completedAt)}</span>;
  const left = Math.ceil((due - Date.now()) / DAY);
  return left < 0 ? <Badge tone="danger">Prazo vencido há {-left} dia(s)</Badge> : <Badge tone={left <= 3 ? 'warning' : 'neutral'}>{left === 0 ? 'Vence hoje' : `Vence em ${left} dia(s)`}</Badge>;
}

interface ContactLite { id: string; name?: string | null; email?: string | null; phone?: string | null; category?: string | null }

function NewDsrDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ContactLite[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [type, setType] = useState<DsrType>('ACCESS');
  const [note, setNote] = useState(''); const [just, setJust] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!q.trim()) { setErrors({ q: 'Informe nome, e-mail, telefone, CPF/CNPJ ou protocolo.' }); return; }
    setErrors({}); setSearching(true);
    try { setResults((await bv.get<{ items: ContactLite[] }>('/contacts', { q: q.trim(), limit: 20 })).items); } catch (e) { setErrors({ q: errMsg(e) }); } finally { setSearching(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!contact) errs.contact = 'Busque e selecione o titular.';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    setBusy(true);
    try {
      const r = await bv.post<{ created: boolean }>('/security/dsr', { contactId: contact!.id, type, ...(note.trim() ? { note: note.trim() } : {}), ...(just.trim() ? { justification: just.trim() } : {}) });
      toast.success(r.created ? 'Solicitação registrada.' : 'Já existia uma solicitação aberta do mesmo tipo para este titular.'); onSaved(); onClose();
    } catch (err) { const m = fieldErrors(err); setErrors(m); setFormErr(errFull(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Registrar solicitação do titular" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-dsr-nova" loading={busy}>Registrar</Button></>}>
      <form id="form-dsr-nova" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <div className="flex items-end gap-2">
          <TextField label="Buscar titular" value={q} onChange={(e) => setQ(e.target.value)} error={errors.q} className="flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
          <Button variant="secondary" loading={searching} onClick={() => void search()}>Buscar</Button>
        </div>
        {results && (
          <fieldset aria-describedby={errors.contact ? 'dsr-contact-err' : undefined} className="rounded-md border border-bv-border p-2">
            <legend className="px-1 text-sm font-medium">Titular <span className="bv-sr-only">(obrigatório)</span></legend>
            {results.length === 0 ? <p className="text-sm text-bv-muted">Nenhum contato encontrado.</p> : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {results.map((c) => (
                  <li key={c.id}><label className="flex items-start gap-2 text-sm"><input type="radio" name="dsr-contact" checked={contact?.id === c.id} onChange={() => setContact(c)} className="mt-1 h-4 w-4" />
                    <span>{c.name || '(sem nome)'} <span className="text-bv-muted">· {[c.email, c.phone, c.category].filter(Boolean).join(' · ') || c.id}</span></span></label></li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        {contact && <p role="status" className="text-sm">Selecionado: <strong>{contact.name || contact.id}</strong></p>}
        {errors.contact && <p id="dsr-contact-err" role="alert" className="text-sm text-bv-danger">{errors.contact}</p>}
        <Select label="Tipo de solicitação" required value={type} onChange={(e) => setType(e.target.value as DsrType)}>
          {(Object.keys(TYPE_LABEL) as DsrType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <TextArea label="Descrição do pedido" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} error={errors.note} />
        <TextArea label="Justificativa / base legal" value={just} onChange={(e) => setJust(e.target.value)} maxLength={2000} error={errors.justification} hint="Obrigatória para exclusão (mínimo de 10 caracteres) ao atender." />
      </form>
    </Dialog>
  );
}

function RejectDialog({ d, onClose, onDone }: { d: Dsr; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) { setErr('Informe o motivo da recusa (mínimo de 5 caracteres).'); return; }
    setBusy(true); setErr(null);
    try { await bv.post(`/security/dsr/${d.id}/reject`, { reason: reason.trim() }); toast.success('Solicitação recusada.'); onDone(); onClose(); } catch (e2) { setErr(errFull(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Recusar solicitação" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-dsr-rej" variant="danger" loading={busy}>Recusar</Button></>}>
      <form id="form-dsr-rej" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <TextArea label="Motivo da recusa" required value={reason} onChange={(e) => setReason(e.target.value)} error={err} maxLength={1000} hint="Fica registrado e é a base da resposta ao titular." />
      </form>
    </Dialog>
  );
}

function ProcessDialog({ d, onClose, onDone }: { d: Dsr; onClose: () => void; onDone: (r: Dsr) => void }) {
  const toast = useToast();
  const [just, setJust] = useState(d.justification ?? '');
  const [redactAll, setRedactAll] = useState(false);
  const destructive = d.type === 'DELETE' || d.type === 'ANONYMIZE';
  const needJust = d.type === 'DELETE';
  const justErr = needJust && just.trim().length < 10 ? 'A exclusão exige justificativa com a base legal (mínimo de 10 caracteres).' : null;
  const run = async () => {
    const r = await bv.post<Dsr>(`/security/dsr/${d.id}/process`, { ...(just.trim() ? { justification: just.trim() } : {}), ...(d.type === 'ANONYMIZE' ? { redactAllMessages: redactAll } : {}) });
    if (r.status === 'REJECTED') toast.error(r.rejectedReason ?? 'Solicitação recusada pelo sistema (guarda legal).'); else toast.success('Solicitação atendida.');
    onDone(r);
  };
  const body = (
    <>
      <TextArea label="Justificativa / base legal" value={just} onChange={(e) => setJust(e.target.value)} maxLength={2000} required={needJust} error={justErr} hint={needJust ? 'Obrigatória: registra a base legal da exclusão.' : 'Opcional; fica registrada na trilha de auditoria.'} />
      {d.type === 'ANONYMIZE' && <div className="flex flex-col gap-1"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={redactAll} onChange={(e) => setRedactAll(e.target.checked)} />Remover também as mensagens enviadas pelo atendimento (por padrão só as do titular)</label></div>}
    </>
  );
  if (destructive) {
    return (
      <StrongConfirm title={d.type === 'DELETE' ? 'Excluir dados do titular' : 'Anonimizar dados do titular'} phrase={d.type === 'DELETE' ? 'EXCLUIR' : 'ANONIMIZAR'} confirmLabel={d.type === 'DELETE' ? 'Excluir definitivamente' : 'Anonimizar definitivamente'}
        canSubmit={!justErr} onConfirm={run} onClose={onClose}
        warning={d.type === 'DELETE'
          ? 'A exclusão remove conversas, mensagens, anexos, gravações e o cadastro do titular. É irreversível. A trilha de auditoria é mantida por obrigação legal. Se houver guarda legal ativa, o sistema recusa a solicitação.'
          : 'A anonimização apaga nome, contatos, documento, anexos e gravações do titular e substitui o conteúdo das mensagens por um marcador. É irreversível. Se houver guarda legal ativa, o sistema recusa a solicitação.'}>
        {body}
      </StrongConfirm>
    );
  }
  return (
    <StrongConfirm title="Gerar exportação dos dados do titular" phrase="EXPORTAR" danger={false} confirmLabel="Gerar exportação" onConfirm={run} onClose={onClose}
      warning="Será gerado um arquivo JSON com todos os dados pessoais do titular (incluindo conteúdo de mensagens e documento). Baixe e entregue por canal seguro; o arquivo expira em 30 dias.">
      {body}
    </StrongConfirm>
  );
}

function DetailDialog({ d, onClose, onChanged }: { d: Dsr; onClose: () => void; onChanged: (r?: Dsr) => void }) {
  const toast = useToast();
  const [cur, setCur] = useState(d);
  const [sub, setSub] = useState<'process' | 'reject' | null>(null);
  const [contactName, setContactName] = useState<string | null>(null);
  useEffect(() => { let alive = true; bv.get<{ contact?: { name?: string | null }; name?: string | null }>(`/contacts/${d.contactId}`).then((r) => { if (alive) setContactName(r.contact?.name ?? r.name ?? null); }).catch(() => undefined); return () => { alive = false; }; }, [d.contactId]);
  const closeSub = useCallback(() => setSub(null), []);
  const download = async () => { try { await bv.download(`/security/dsr/${cur.id}/export`, `titular-${cur.id}.json`); } catch (e) { toast.error(errMsg(e)); } };
  const report = cur.report ? flatten(cur.report) : null;
  return (
    <>
      <Dialog open onClose={onClose} title="Solicitação do titular" size="lg" footer={
        <>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {cur.status === 'OPEN' && <><Button variant="secondary" onClick={() => setSub('reject')}>Recusar</Button><Button onClick={() => setSub('process')}>Atender solicitação</Button></>}
          {cur.status === 'DONE' && (cur.type === 'ACCESS' || cur.type === 'EXPORT') && <Button onClick={() => void download()}>Baixar exportação</Button>}
        </>}>
        <div className="flex flex-col gap-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-bv-muted">Tipo</dt><dd>{TYPE_LABEL[cur.type]}</dd></div>
            <div><dt className="text-bv-muted">Situação</dt><dd><Badge tone={STATUS_LABEL[cur.status].tone}>{STATUS_LABEL[cur.status].label}</Badge></dd></div>
            <div><dt className="text-bv-muted">Titular</dt><dd>{contactName ?? '—'} <span className="break-all text-xs text-bv-muted">({cur.contactId})</span></dd></div>
            <div><dt className="text-bv-muted">Origem</dt><dd>{cur.origin === 'PUBLIC' ? 'Formulário público' : 'Registrada internamente'}</dd></div>
            <div><dt className="text-bv-muted">Recebida em</dt><dd>{fmtDateTime(cur.requestedAt)}</dd></div>
            <div><dt className="text-bv-muted">Prazo (15 dias)</dt><dd><Deadline d={cur} /></dd></div>
          </dl>
          {cur.text && <div><h3 className="text-sm font-semibold">Pedido</h3><p className="whitespace-pre-line text-sm">{cur.text}</p></div>}
          {cur.justification && <div><h3 className="text-sm font-semibold">Justificativa</h3><p className="whitespace-pre-line text-sm">{cur.justification}</p></div>}
          {cur.rejectedReason && <Banner tone="warning" title="Motivo da recusa">{cur.rejectedReason}</Banner>}
          {report && (
            <div><h3 className="mb-1 text-sm font-semibold">Relatório de conclusão</h3>
              <dl className="grid gap-1 text-sm">{Object.entries(report).map(([k, v]) => <div key={k} className="flex flex-wrap gap-2"><dt className="font-mono text-xs text-bv-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
            </div>
          )}
        </div>
      </Dialog>
      {sub === 'process' && <ProcessDialog d={cur} onClose={closeSub} onDone={(r) => { setCur(r); onChanged(r); }} />}
      {sub === 'reject' && <RejectDialog d={cur} onClose={closeSub} onDone={() => { onChanged(); onClose(); }} />}
    </>
  );
}

export default function DsrTab() {
  const [status, setStatus] = useState('OPEN');
  const { data, error, loading, unavailable, reload } = useLoad(() => bv.get<{ items: Dsr[] }>('/security/dsr', { status: status || undefined, limit: 200 }).then((r) => r.items), [status]);
  const [detail, setDetail] = useState<Dsr | null>(null);
  const [creating, setCreating] = useState(false);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  if (unavailable) return <Unavailable what="O atendimento de direitos do titular" />;
  const columns: Column<Dsr>[] = [
    { key: 't', header: 'Solicitação', render: (d) => <div><div className="font-medium">{TYPE_LABEL[d.type]}</div><div className="text-xs text-bv-muted">{d.origin === 'PUBLIC' ? 'Formulário público' : 'Interna'}</div></div> },
    { key: 'c', header: 'Titular', render: (d) => <span className="break-all text-xs">{d.contactId}</span> },
    { key: 'r', header: 'Recebida em', render: (d) => fmtDateTime(d.requestedAt) },
    { key: 'p', header: 'Prazo', render: (d) => <Deadline d={d} /> },
    { key: 's', header: 'Situação', render: (d) => <Badge tone={STATUS_LABEL[d.status].tone}>{STATUS_LABEL[d.status].label}</Badge> },
    { key: 'a', header: 'Ações', render: (d) => <Button size="sm" variant="secondary" aria-label={`Abrir solicitação de ${TYPE_LABEL[d.type]} recebida em ${fmtDateTime(d.requestedAt)}`} onClick={() => setDetail(d)}>{d.status === 'OPEN' ? 'Abrir e atender' : 'Abrir'}</Button> },
  ];
  const overdue = (data ?? []).filter((d) => d.status === 'OPEN' && Date.now() > Date.parse(d.requestedAt) + DEADLINE_DAYS * DAY).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Atendimento dos direitos previstos no art. 18 da LGPD. O prazo de resposta é de 15 dias.</p>
      {overdue > 0 && <Banner tone="danger" title="Solicitações com prazo vencido">{overdue} solicitação(ões) aberta(s) há mais de 15 dias.</Banner>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} className="w-56"><option value="OPEN">Abertas</option><option value="DONE">Atendidas</option><option value="REJECTED">Recusadas</option><option value="">Todas</option></Select>
        <Button onClick={() => setCreating(true)}>Registrar solicitação</Button>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando solicitações" />
        : <DataTable caption="Solicitações de titulares" columns={columns} rows={data ?? []} rowKey={(d) => d.id} empty="Nenhuma solicitação com este filtro." />}
      {detail && <DetailDialog key={detail.id} d={detail} onClose={closeDetail} onChanged={() => reload()} />}
      {creating && <NewDsrDialog onClose={closeCreate} onSaved={reload} />}
    </div>
  );
}
