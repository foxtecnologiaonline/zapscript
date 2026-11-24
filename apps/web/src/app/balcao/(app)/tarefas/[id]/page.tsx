'use client';
/** Detalhe da tarefa: histórico por campo, comentários (internos/visíveis), vínculo com atendimento, SLA, atribuição, reabrir, avaliação. */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { PRIORITY_LABEL, fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, Dialog, EmptyState, PageHeader, Select, Spinner, TextArea, TextField, useToast } from '../../../_ui/ui';
import { DueInfo, FIELD_LABEL, KIND_LABEL, LEVEL_LABEL, MoveButtons, ORIGIN_LABEL, PriorityBadge, STATUS_LABEL, StatusBadge, StatusDialog, dtLocalToIso, useLookups, type Status, type TaskDetail } from '../common';

const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function TarefaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useBvSession();
  const toast = useToast();
  const lk = useLookups();
  const [t, setT] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<Status | null>(null);
  const [editOpen, setEditOpen] = useState(false); const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setT(await bv.get<TaskDetail>(`/tasks/${id}`)); setError(null); } catch (e) { setError(errMsg(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (error && !t) return <><PageHeader title="Tarefa" /><Banner tone="danger" title="Não foi possível abrir a tarefa">{error}</Banner><p className="mt-3"><Link className="underline" href="/balcao/tarefas">Voltar às tarefas</Link></p></>;
  if (!t) return <div className="flex justify-center p-10"><Spinner size={28} /></div>;

  const fiscal = !can('task:manage') && me?.user.role === 'FISCAL';
  const closed = t.status === 'DONE' || t.status === 'CANCELLED';
  const act = async (name: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  const histVal = (field: string, v: string | null) => {
    if (v == null || v === '') return '—';
    if (field === 'assigneeId') return lk.userName(v);
    if (field === 'sectorId') return lk.sectorName(v);
    if (field === 'status') return STATUS_LABEL[v as Status] ?? v;
    if (field === 'priority') return PRIORITY_LABEL[v] ?? v;
    if (field === 'dueAt' || field === 'respondedAt' || field === 'completedAt') return fmtDateTime(v);
    if (field === 'notifyOnClose') return v === 'true' ? 'Sim' : 'Não';
    return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  };

  return (
    <div className="flex flex-col gap-4">
      <p><Link className="text-sm underline" href="/balcao/tarefas">← Voltar às tarefas</Link></p>
      <PageHeader title={`${t.code} — ${t.title}`} subtitle={`${KIND_LABEL[t.kind]} · criada em ${fmtDateTime(t.createdAt)}${t.creator?.name ? ` por ${t.creator.name}` : ''}`}
        actions={<><StatusBadge s={t.status} /><PriorityBadge p={t.priority} />{t.supportLevel && <Badge tone="neutral">Nível {t.supportLevel}</Badge>}</>} />
      {error && <Banner tone="danger">{error}</Banner>}

      <Card title="Ações">
        <div className="flex flex-wrap items-center gap-2">
          <MoveButtons t={t} canManage={t.permissions.canReopen} onPick={setMove} />
          {!t.assigneeId && !closed && can('task:write') && !fiscal && <Button size="sm" loading={busy === 'claim'} onClick={() => void act('claim', () => bv.post(`/tasks/${t.id}/claim`), 'Você assumiu a tarefa.')}>Assumir</Button>}
          {t.permissions.canEdit && !closed && <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Editar</Button>}
          {t.permissions.canEdit && !closed && !fiscal && <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>Atribuir</Button>}
          {closed && t.notifyOnClose && !t.closeNoticeSentAt && t.permissions.canEdit && <Button size="sm" variant="secondary" loading={busy === 'notice'} onClick={() => void act('notice', () => bv.post(`/tasks/${t.id}/resend-close-notice`), 'Reenvio do aviso solicitado.')}>Reenviar aviso ao cidadão</Button>}
        </div>
        {closed && !t.permissions.canReopen && <p className="mt-2 text-sm text-bv-muted">Somente supervisão/administração pode reabrir uma tarefa encerrada.</p>}
      </Card>

      <Card title="Resumo">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-bv-muted">Situação</dt><dd><StatusBadge s={t.status} /></dd></div>
          <div><dt className="text-bv-muted">Responsável</dt><dd>{t.assignee?.name ?? 'Sem responsável'}</dd></div>
          <div><dt className="text-bv-muted">Setor</dt><dd>{t.sector?.name ?? '—'}</dd></div>
          <div><dt className="text-bv-muted">Origem</dt><dd>{ORIGIN_LABEL[t.origin] ?? t.origin}</dd></div>
          <div><dt className="text-bv-muted">Prazo e SLA</dt><dd><DueInfo t={t} /></dd></div>
          <div><dt className="text-bv-muted">Prazo de resposta (SLA)</dt><dd>{t.sla.responseDueAt ? fmtDateTime(t.sla.responseDueAt) : '—'}{t.sla.responseBreached ? <> <Badge tone="warning">Violado</Badge></> : null}{t.respondedAt ? ` · respondida em ${fmtDateTime(t.respondedAt)}` : ''}</dd></div>
          <div><dt className="text-bv-muted">Prazo de resolução (SLA)</dt><dd>{t.sla.resolutionDueAt ? fmtDateTime(t.sla.resolutionDueAt) : '—'}{t.sla.resolutionBreached ? <> <Badge tone="danger">Violado</Badge></> : null}</dd></div>
          {t.supportLevel && <div><dt className="text-bv-muted">Nível de suporte (ANS)</dt><dd>{LEVEL_LABEL[t.supportLevel]}</dd></div>}
          {t.completedAt && <div><dt className="text-bv-muted">Concluída em</dt><dd>{fmtDateTime(t.completedAt)}</dd></div>}
          {t.externalRef && <div><dt className="text-bv-muted">Referência externa</dt><dd>{t.externalRef}</dd></div>}
          <div><dt className="text-bv-muted">Etiquetas</dt><dd>{t.tags.length ? t.tags.join(', ') : '—'}</dd></div>
          <div><dt className="text-bv-muted">Atendimento vinculado</dt><dd>{t.conversation ? <Link className="underline" href={`/balcao/atendimento/${encodeURIComponent(t.conversation.id)}`}>Protocolo {t.conversation.protocol}</Link> : 'Nenhum'}</dd></div>
          {t.contact && <div><dt className="text-bv-muted">Cidadão</dt><dd>{t.contact.name ?? 'Sem nome'}</dd></div>}
          <div><dt className="text-bv-muted">Aviso ao cidadão ao encerrar</dt><dd>{t.notifyOnClose ? `Sim${t.notifyChannel ? ` (${t.notifyChannel === 'EMAIL' ? 'e-mail' : 'WhatsApp'})` : ' (canal automático)'}${closed ? (t.closeNoticeSentAt ? ` — enviado em ${fmtDateTime(t.closeNoticeSentAt)}` : ' — ainda não enviado') : ''}` : 'Não'}</dd></div>
        </dl>
        {t.description && <><h3 className="mt-4 text-sm font-semibold">Descrição</h3><p className="whitespace-pre-wrap text-sm">{t.description}</p></>}
      </Card>

      {t.kind === 'SERVICE_REQUEST' && t.status === 'DONE' && <Rating t={t} onDone={load} />}
      <Comments t={t} fiscal={fiscal} onDone={load} />

      <Card title="Histórico de alterações">
        {!t.history.length ? <EmptyState title="Sem alterações registradas" /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="bv-sr-only">Histórico de alterações da tarefa</caption>
            <thead className="bg-bv-subtle"><tr><th scope="col" className="px-3 py-2">Quando</th><th scope="col" className="px-3 py-2">Quem</th><th scope="col" className="px-3 py-2">Campo</th><th scope="col" className="px-3 py-2">De</th><th scope="col" className="px-3 py-2">Para</th></tr></thead>
            <tbody>{[...t.history].reverse().map((h) => (
              <tr key={h.id} className="border-t border-bv-border"><td className="px-3 py-2">{fmtDateTime(h.createdAt)}</td><td className="px-3 py-2">{h.actor?.name ?? 'Sistema'}</td><td className="px-3 py-2">{FIELD_LABEL[h.field] ?? h.field}</td><td className="px-3 py-2">{histVal(h.field, h.fromValue)}</td><td className="px-3 py-2">{histVal(h.field, h.toValue)}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>

      <StatusDialog task={move ? t : null} to={move} onClose={() => setMove(null)} onDone={() => void load()} />
      {editOpen && <EditDialog t={t} manager={can('task:manage')} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); }} />}
      {assignOpen && <AssignDialog t={t} onClose={() => setAssignOpen(false)} onSaved={() => { setAssignOpen(false); void load(); }} />}
    </div>
  );
}

function Comments({ t, fiscal, onDone }: { t: TaskDetail; fiscal: boolean; onDone: () => void }) {
  const { can } = useBvSession();
  const toast = useToast();
  const [body, setBody] = useState(''); const [internal, setInternal] = useState(true); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!body.trim()) return; setBusy(true);
    try { await bv.post(`/tasks/${t.id}/comments`, { body: body.trim(), ...(fiscal ? {} : { internal }) }); setBody(''); toast.success('Comentário adicionado.'); onDone(); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Card title={`Comentários (${t.comments.length})`}>
      {!t.comments.length ? <p className="mb-3 text-sm text-bv-muted">Nenhum comentário ainda.</p> : (
        <ul className="mb-4 flex flex-col gap-2">{t.comments.map((c) => (
          <li key={c.id} className="rounded-md border border-bv-border p-3 text-sm">
            <p className="mb-1 flex flex-wrap items-center gap-2"><strong>{c.user.name ?? 'Sistema'}</strong><span className="text-bv-muted">{fmtDateTime(c.createdAt)}</span><Badge tone={c.internal ? 'warning' : 'primary'}>{c.internal ? 'Interno (só equipe)' : 'Visível ao solicitante'}</Badge></p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>))}</ul>
      )}
      {can('task:write') && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <TextArea label="Novo comentário" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} hint="Use @email para mencionar alguém." />
          {fiscal ? <p className="text-xs text-bv-muted">Seu comentário fica visível ao solicitante.</p> : <Checkbox label="Comentário interno (só a equipe vê)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
          <div><Button type="submit" loading={busy} disabled={!body.trim()}>Comentar</Button></div>
        </form>
      )}
    </Card>
  );
}

function Rating({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const toast = useToast();
  const [score, setScore] = useState(t.rating != null ? String(t.rating) : ''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  if (!t.permissions.canRate) return t.rating != null ? <Card title="Avaliação da solicitação"><p className="text-sm">Nota atribuída: <strong>{t.rating}/10</strong></p></Card> : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (score === '') return; setBusy(true);
    try { await bv.post(`/tasks/${t.id}/rating`, { score: Number(score), ...(comment.trim() ? { comment: comment.trim() } : {}) }); toast.success('Avaliação registrada.'); setComment(''); onDone(); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Avaliar atendimento da solicitação">
      {t.rating != null && <p className="mb-2 text-sm">Nota atual: <strong>{t.rating}/10</strong>. Enviar de novo substitui a nota (vale a última).</p>}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Select label="Nota (0 a 10)" required value={score} onChange={(e) => setScore(e.target.value)}><option value="">Escolha…</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}</Select>
        <TextField label="Comentário (opcional)" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={score === ''}>Registrar avaliação</Button></div>
      </form>
    </Card>
  );
}

function EditDialog({ t, manager, onClose, onSaved }: { t: TaskDetail; manager: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(t.title); const [description, setDescription] = useState(t.description ?? ''); const [priority, setPriority] = useState(t.priority);
  const [due, setDue] = useState(toLocalInput(t.dueAt)); const [tags, setTags] = useState(t.tags.join(', ')); const [notify, setNotify] = useState(t.notifyOnClose); const [channel, setChannel] = useState(t.notifyChannel ?? '');
  const [level, setLevel] = useState(t.supportLevel ?? ''); const [ext, setExt] = useState(t.externalRef ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      await bv.patch(`/tasks/${t.id}`, {
        title: title.trim(), description: description.trim() || null, priority, dueAt: due ? dtLocalToIso(due) : null, tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
        ...(t.contactId ? { notifyOnClose: notify, notifyChannel: channel || null } : {}),
        ...(manager ? { ...(t.kind === 'SERVICE_REQUEST' ? { supportLevel: level || null } : {}), externalRef: ext.trim() || null } : {}),
      });
      toast.success('Tarefa atualizada.'); onSaved();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={`Editar ${t.code}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => void save()}>Salvar</Button></>}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><TextField label="Título" required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="sm:col-span-2"><TextArea label="Descrição" value={description} maxLength={8000} onChange={(e) => setDescription(e.target.value)} /></div>
        <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <TextField label="Prazo" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <TextField label="Etiquetas (vírgula)" value={tags} onChange={(e) => setTags(e.target.value)} />
        {manager && t.kind === 'SERVICE_REQUEST' && <Select label="Nível de suporte (ANS)" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="">Automático pela prioridade</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        {manager && <TextField label="Referência externa (ex.: chave Jira)" value={ext} maxLength={100} onChange={(e) => setExt(e.target.value)} />}
        {t.contactId && (
          <div className="sm:col-span-2 flex flex-col gap-2">
            <Checkbox label="Avisar o cidadão quando a tarefa for encerrada" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {notify && <Select label="Canal do aviso" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}><option value="">Automático</option><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option></Select>}
          </div>
        )}
        {err && <div className="sm:col-span-2"><Banner tone="danger">{err}</Banner></div>}
      </form>
    </Dialog>
  );
}

function AssignDialog({ t, onClose, onSaved }: { t: TaskDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const lk = useLookups();
  const [assigneeId, setAssigneeId] = useState(t.assigneeId ?? ''); const [sectorId, setSectorId] = useState(t.sectorId ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await bv.post(`/tasks/${t.id}/assign`, { assigneeId: assigneeId || null, sectorId: sectorId || null }); toast.success('Atribuição atualizada.'); onSaved(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`Atribuir ${t.code}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => void save()}>Salvar</Button></>}>
      <div className="flex flex-col gap-3">
        {(lk.canSectors || lk.mySectorId) && <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)} hint="Só o setor, sem responsável: a tarefa vai para a caixa do setor."><option value="">Sem setor</option>{lk.canSectors ? lk.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : <option value={lk.mySectorId!}>Meu setor</option>}</Select>}
        <Select label="Responsável" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Sem responsável</option>{(lk.canUsers ? lk.users : lk.users.filter((u) => u.id === lk.myId)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        {err && <Banner tone="danger">{err}</Banner>}
      </div>
    </Dialog>
  );
}
