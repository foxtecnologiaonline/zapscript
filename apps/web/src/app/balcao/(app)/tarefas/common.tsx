'use client';
/** Tipos, rótulos e componentes compartilhados das telas de tarefas (task:read / task:write). Contratos: docs/balcao/api-tasks.md + apps/api/src/balcao/tasks. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { PRIORITY_LABEL, fmtDateTime, fmtDuration } from '@/lib/balcao/format';
import { Badge, Banner, Button, Checkbox, Dialog, Select, TextArea, TextField, useToast } from '../../_ui/ui';

export type Status = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'CANCELLED';
export type Kind = 'INTERNAL' | 'DEMAND' | 'SERVICE_REQUEST';
export interface Ref { id: string; name: string | null }
export interface Sla { responseDueAt: string | null; resolutionDueAt: string | null; responseBreached: boolean; resolutionBreached: boolean; overdue: boolean; remainingSec: number | null; paused?: boolean; pausedAt?: string | null }
export interface Task {
  id: string; code: string; kind: Kind; title: string; description: string | null; status: Status; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; origin: string;
  sectorId: string | null; assigneeId: string | null; creatorId: string | null; conversationId: string | null; contactId: string | null;
  dueAt: string | null; completedAt: string | null; notifyOnClose: boolean; notifyChannel: 'EMAIL' | 'WHATSAPP' | null; closeNoticeSentAt: string | null;
  supportLevel: 'L1' | 'L2' | 'L3' | 'L4' | null; respondedAt: string | null; slaResponseDueAt: string | null; slaResolutionDueAt: string | null; externalRef: string | null;
  slaPaused: boolean; slaPausedAt: string | null; tags: string[]; createdAt: string; updatedAt: string; assignee: Ref | null; creator: Ref | null; sector: Ref | null; sla: Sla;
}
export interface TaskDetail extends Task {
  conversation: { id: string; protocol: string; channel: string; status: string; subject?: string | null } | null;
  contact: { id: string; name: string | null; category?: string | null } | null;
  rating: number | null;
  comments: Array<{ id: string; body: string; internal: boolean; createdAt: string; user: Ref }>;
  history: Array<{ id: string; field: string; fromValue: string | null; toValue: string | null; createdAt: string; actor: Ref | null }>;
  permissions: { canEdit: boolean; canReopen: boolean; canRate: boolean };
}

export const STATUS_LABEL: Record<Status, string> = { OPEN: 'Aberta', IN_PROGRESS: 'Em andamento', WAITING: 'Aguardando', DONE: 'Concluída', CANCELLED: 'Cancelada' };
export const STATUS_TONE: Record<Status, 'primary' | 'warning' | 'neutral' | 'success'> = { OPEN: 'primary', IN_PROGRESS: 'warning', WAITING: 'neutral', DONE: 'success', CANCELLED: 'neutral' };
export const KIND_LABEL: Record<Kind, string> = { INTERNAL: 'Tarefa interna', DEMAND: 'Demanda', SERVICE_REQUEST: 'Solicitação de serviço' };
export const ORIGIN_LABEL: Record<string, string> = { CHATBOT: 'Assistente virtual', AGENT: 'Atendente', BACKOFFICE: 'Retaguarda', SYSTEM: 'Sistema' };
export const LEVEL_LABEL: Record<string, string> = { L1: 'L1 — crítico (ANS 1 h)', L2: 'L2 — alto (ANS 2 h)', L3: 'L3 — médio (ANS 1 dia útil)', L4: 'L4 — baixo (ANS 2 dias úteis)' };
export const OPEN_STATUSES: Status[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
/** Espelha TRANSITIONS de apps/api/src/balcao/tasks/model.ts. Reabrir (DONE/CANCELLED → OPEN) exige task:manage. */
export const TRANSITIONS: Record<Status, Status[]> = { OPEN: ['IN_PROGRESS', 'WAITING', 'CANCELLED'], IN_PROGRESS: ['WAITING', 'DONE', 'CANCELLED'], WAITING: ['IN_PROGRESS', 'DONE', 'CANCELLED'], DONE: ['OPEN'], CANCELLED: ['OPEN'] };
export const FIELD_LABEL: Record<string, string> = {
  status: 'Situação', assigneeId: 'Responsável', sectorId: 'Setor', title: 'Título', description: 'Descrição', priority: 'Prioridade', dueAt: 'Prazo', tags: 'Etiquetas',
  notifyChannel: 'Canal do aviso ao cidadão', notifyOnClose: 'Avisar o cidadão ao encerrar', supportLevel: 'Nível de suporte', externalRef: 'Referência externa', rating: 'Avaliação (nota)',
  respondedAt: 'Primeira resposta', closeNotice: 'Aviso de encerramento', 'sla.breach': 'Violação de SLA', 'sla.pause': 'SLA pausado (aguardando)', 'sla.resume': 'SLA retomado', completedAt: 'Conclusão',
};

export const dtLocalToIso = (v: string) => (v ? new Date(v).toISOString() : undefined);
export const PriorityBadge = ({ p }: { p: Task['priority'] }) => <Badge tone={p === 'URGENT' ? 'danger' : p === 'HIGH' ? 'warning' : 'neutral'}>Prioridade {PRIORITY_LABEL[p].toLowerCase()}</Badge>;
export const StatusBadge = ({ s }: { s: Status }) => <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;

/** Selo "SLA pausado (aguardando)": a tarefa está em "Aguardando", então o relógio do SLA está parado. Sempre com texto (nunca só cor/ícone). */
export const isSlaPaused = (t: { slaPaused?: boolean; sla?: { paused?: boolean } | null }) => !!(t.slaPaused || t.sla?.paused);
export function SlaPausedBadge({ t, withSince }: { t: Pick<Task, 'slaPausedAt'> & { slaPaused?: boolean; sla?: { paused?: boolean; pausedAt?: string | null } | null }; withSince?: boolean }) {
  if (!isSlaPaused(t)) return null;
  const since = t.slaPausedAt ?? t.sla?.pausedAt ?? null;
  return <span className="inline-flex flex-wrap items-center gap-1"><Badge tone="primary"><span aria-hidden="true">❚❚&nbsp;</span>SLA pausado (aguardando)</Badge>{withSince && since && <span className="text-xs text-bv-muted">desde {fmtDateTime(since)}</span>}</span>;
}

/** Prazo e SLA em TEXTO (nunca só cor): "Vencida há 2 h", "Resta 1h 20min". Com o SLA pausado, o prazo não é tratado como vencido. */
export function DueInfo({ t, compact }: { t: Pick<Task, 'dueAt' | 'status' | 'sla' | 'kind' | 'slaPaused' | 'slaPausedAt'>; compact?: boolean }) {
  const closed = t.status === 'DONE' || t.status === 'CANCELLED';
  const paused = !closed && isSlaPaused(t);
  const parts: React.ReactNode[] = [];
  if (t.dueAt) {
    const late = t.sla.overdue && !paused;
    const diff = Math.round((new Date(t.dueAt).getTime() - Date.now()) / 1000);
    parts.push(<span key="due">Prazo: {fmtDateTime(t.dueAt)}{!closed && !paused && (late ? <> <Badge tone="danger">Vencida há {fmtDuration(-diff)}</Badge></> : diff < 86400 ? ` (resta ${fmtDuration(diff)})` : '')}{paused ? ' (contagem parada)' : ''}</span>);
  } else if (!compact) parts.push(<span key="due">Sem prazo definido</span>);
  if (paused) parts.push(<SlaPausedBadge key="pz" t={t} withSince={!compact} />);
  if (t.kind !== 'INTERNAL') {
    if (t.sla.resolutionBreached) parts.push(<Badge key="r" tone="danger">SLA de resolução violado</Badge>);
    else if (!closed && t.sla.remainingSec != null && t.kind === 'SERVICE_REQUEST') parts.push(<span key="r">Resta {fmtDuration(Math.max(0, t.sla.remainingSec))} para o ANS{paused ? ' (parado enquanto aguarda)' : ''}</span>);
    if (t.sla.responseBreached) parts.push(<Badge key="p" tone="warning">SLA de resposta violado</Badge>);
  }
  return <span className="flex flex-col gap-1 text-sm">{parts.map((p, i) => <span key={i}>{p}</span>)}</span>;
}

// ── Listas auxiliares (setores/usuários) — só para quem tem permissão de consultá-las ──────────────
export interface Opt { id: string; name: string }
export function useLookups() {
  const { me, can, status } = useBvSession();
  const [sectors, setSectors] = useState<Opt[]>([]);
  const [users, setUsers] = useState<Opt[]>([]);
  const canSectors = can('user:manage') || can('queue:manage');
  const canUsers = can('conversation:monitor') || can('user:manage');
  useEffect(() => {
    if (status !== 'authed') return;
    if (canSectors) bv.get<{ items: Opt[] }>('/admin/sectors', { active: 'true' }).then((r) => setSectors(r.items)).catch(() => undefined);
    if (can('conversation:monitor')) bv.get<{ items: Opt[] }>('/agents').then((r) => setUsers(r.items)).catch(() => undefined);
    else if (can('user:manage')) bv.get<{ items: Opt[] }>('/admin/users', { limit: 200, active: 'true' }).then((r) => setUsers(r.items)).catch(() => undefined);
  }, [status, can, canSectors]);
  const allUsers = useMemo(() => (me && !users.some((u) => u.id === me.user.id) ? [{ id: me.user.id, name: `${me.user.name} (eu)` }, ...users] : users), [users, me]);
  const userName = useCallback((id?: string | null) => (id ? allUsers.find((u) => u.id === id)?.name ?? 'Outro usuário' : '—'), [allUsers]);
  const sectorName = useCallback((id?: string | null) => (id ? sectors.find((s) => s.id === id)?.name ?? (id === me?.user.sectorId ? 'Meu setor' : 'Outro setor') : '—'), [sectors, me]);
  return { sectors, users: allUsers, canSectors, canUsers, userName, sectorName, mySectorId: me?.user.sectorId ?? null, myId: me?.user.id ?? null };
}

// ── Mudança de situação (com texto de solução ao encerrar) ─────────────────────────────────────────
export function StatusDialog({ task, to, onClose, onDone }: { task: Pick<Task, 'id' | 'code' | 'notifyOnClose'> | null; to: Status | null; onClose: () => void; onDone: (t: Task) => void }) {
  const toast = useToast();
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(''); setErr(null); }, [task?.id, to]);
  if (!task || !to) return null;
  const closing = to === 'DONE' || to === 'CANCELLED';
  const go = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      const t = await bv.post<Task>(`/tasks/${task.id}/status`, { status: to, ...(closing && text.trim() ? { resolution: text.trim() } : {}) });
      toast.success(`${task.code}: ${STATUS_LABEL[to].toLowerCase()}.`); onDone(t); onClose();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`${task.code}: mover para "${STATUS_LABEL[to]}"`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} variant={to === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => void go()}>Confirmar</Button></>}>
      <form onSubmit={go} className="flex flex-col gap-3">
        {closing ? (
          <TextArea label={to === 'DONE' ? 'Como foi resolvida (opcional)' : 'Motivo (opcional)'} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)}
            hint={task.notifyOnClose ? 'Este texto fica visível no histórico e será enviado ao cidadão no aviso de encerramento.' : 'Este texto fica visível no histórico da tarefa.'} />
        ) : <p className="text-sm">Confirmar a mudança de situação para <strong>{STATUS_LABEL[to]}</strong>?</p>}
        {err && <Banner tone="danger">{err}</Banner>}
      </form>
    </Dialog>
  );
}

/** Botões "Mover para…" (alternativa ao arrastar). `onPick` abre o diálogo de confirmação. */
export function MoveButtons({ t, canManage, onPick, exclude }: { t: Pick<Task, 'status' | 'code'>; canManage: boolean; onPick: (to: Status) => void; exclude?: Status[] }) {
  const targets = TRANSITIONS[t.status].filter((s) => !(exclude ?? []).includes(s) && (t.status !== 'DONE' && t.status !== 'CANCELLED' ? true : canManage));
  if (!targets.length) return null;
  return (
    <div role="group" aria-label={`Mover ${t.code} para`} className="flex flex-wrap gap-1">
      {targets.map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => onPick(s)} aria-label={`Mover ${t.code} para ${STATUS_LABEL[s]}`}>{t.status === 'DONE' || t.status === 'CANCELLED' ? 'Reabrir' : `→ ${STATUS_LABEL[s]}`}</Button>)}
    </div>
  );
}

// ── Criar tarefa ────────────────────────────────────────────────────────────────────────────────────
export function NewTaskDialog({ open, onClose, onCreated, presetKind, presetConversationId }: { open: boolean; onClose: () => void; onCreated: (t: Task) => void; presetKind?: Kind; presetConversationId?: string | null }) {
  const { can, me } = useBvSession();
  const toast = useToast();
  const lk = useLookups();
  const fiscal = !can('task:manage') && me?.user.role === 'FISCAL';
  const canLink = can('conversation:read') && !fiscal;
  const [kind, setKind] = useState<Kind>('INTERNAL');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL'); const [due, setDue] = useState('');
  const [sectorId, setSectorId] = useState(''); const [assigneeId, setAssigneeId] = useState('');
  const [level, setLevel] = useState(''); const [tags, setTags] = useState('');
  const [protocol, setProtocol] = useState(''); const [conv, setConv] = useState<{ id: string; protocol: string } | null>(null); const [convErr, setConvErr] = useState<string | null>(null);
  const [notify, setNotify] = useState(false); const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [titleErr, setTitleErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(fiscal ? 'SERVICE_REQUEST' : presetKind ?? (presetConversationId ? 'DEMAND' : 'INTERNAL'));
    setTitle(''); setDescription(''); setPriority('NORMAL'); setDue(''); setSectorId(''); setAssigneeId(''); setLevel(''); setTags(''); setProtocol(''); setConv(presetConversationId ? { id: presetConversationId, protocol: '' } : null);
    setConvErr(null); setNotify(false); setChannel(''); setErr(null); setTitleErr(null);
  }, [open, presetKind, presetConversationId, fiscal]);

  const lookupConv = async () => {
    const p = protocol.trim(); setConvErr(null);
    if (!p) { setConv(null); return; }
    try {
      const r = await bv.get<{ items: Array<{ id: string; protocol: string }> }>('/conversations', { protocol: p, limit: 5 });
      const hit = r.items.find((c) => c.protocol.toLowerCase() === p.toLowerCase()) ?? r.items[0];
      if (!hit) { setConv(null); setConvErr('Nenhum atendimento encontrado com esse protocolo.'); return; }
      setConv({ id: hit.id, protocol: hit.protocol });
      if (kind === 'INTERNAL') setKind('DEMAND');
    } catch (e) { setConv(null); setConvErr(errMsg(e)); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (title.trim().length < 3) { setTitleErr('O título precisa ter pelo menos 3 caracteres.'); return; }
    setTitleErr(null); setBusy(true);
    const common = {
      title: title.trim(), description: description.trim() || undefined, priority, dueAt: dtLocalToIso(due), tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
      ...(sectorId ? { sectorId } : {}), ...(assigneeId ? { assigneeId } : {}), ...(level ? { supportLevel: level } : {}),
      ...(conv ? { notifyOnClose: notify, notifyChannel: notify && channel ? channel : undefined } : {}),
    };
    try {
      const t = conv ? await bv.post<Task>('/tasks/from-conversation', { conversationId: conv.id, kind: kind === 'SERVICE_REQUEST' ? 'SERVICE_REQUEST' : 'DEMAND', ...common })
        : await bv.post<Task>('/tasks', { kind, ...common });
      toast.success(`Tarefa ${t.code} criada.`); onCreated(t); onClose();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };

  const kinds: Kind[] = fiscal ? ['SERVICE_REQUEST'] : conv ? ['DEMAND', 'SERVICE_REQUEST'] : ['INTERNAL', 'DEMAND', 'SERVICE_REQUEST'];
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={kind === 'SERVICE_REQUEST' ? 'Nova solicitação de serviço' : 'Nova tarefa'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-new-task" loading={busy}>Criar</Button></>}>
      <form id="bv-new-task" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as Kind)} hint="Interna: sem vínculo com atendimento. Demanda: pedido a outro setor. Solicitação de serviço: pedido à contratada, com prazo (ANS)." disabled={kinds.length === 1}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
        <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <div className="sm:col-span-2"><TextField label="Título" required maxLength={200} value={title} error={titleErr} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="sm:col-span-2"><TextArea label="Descrição" maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <TextField label="Prazo (opcional)" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} hint={kind === 'SERVICE_REQUEST' ? 'Em branco: usa o prazo do ANS conforme a prioridade/nível.' : undefined} />
        <TextField label="Etiquetas (separadas por vírgula)" value={tags} onChange={(e) => setTags(e.target.value)} />
        {kind === 'SERVICE_REQUEST' && can('task:manage') && (
          <Select label="Nível de suporte (ANS)" value={level} onChange={(e) => setLevel(e.target.value)} hint="Em branco: derivado da prioridade (urgente = L1 … baixa = L4).">
            <option value="">Automático pela prioridade</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
        {!fiscal && (lk.canSectors ? (
          <Select label="Setor (caixa do setor)" value={sectorId} onChange={(e) => setSectorId(e.target.value)}><option value="">Sem setor (caixa geral)</option>{lk.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        ) : lk.mySectorId ? (
          <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)}><option value="">Sem setor (caixa geral)</option><option value={lk.mySectorId}>Meu setor</option></Select>
        ) : null)}
        {!fiscal && (
          <Select label="Responsável" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} hint={lk.canUsers ? undefined : 'Você pode atribuir a si mesmo; outras pessoas assumem pela caixa.'}>
            <option value="">Sem responsável (qualquer pessoa pode assumir)</option>
            {(lk.canUsers ? lk.users : lk.users.filter((u) => u.id === lk.myId)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        {canLink && (
          <div className="sm:col-span-2 flex flex-col gap-2 rounded-md border border-bv-border p-3">
            <TextField label="Vincular a um atendimento (protocolo, opcional)" value={protocol} onChange={(e) => setProtocol(e.target.value)} onBlur={() => void lookupConv()} error={convErr}
              hint={conv ? `Vinculada ao atendimento ${conv.protocol || 'selecionado'}.` : 'Ao vincular, a tarefa herda o contato e permite avisar o cidadão quando for encerrada.'} />
            {conv && (
              <>
                <Checkbox label="Avisar o cidadão quando a tarefa for encerrada" checked={notify} onChange={(e) => setNotify(e.target.checked)} hint="O aviso leva o protocolo, o código e o texto da solução." />
                {notify && (
                  <Select label="Canal do aviso" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    <option value="">Automático (conversa vinculada, depois e-mail)</option><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option>
                  </Select>
                )}
              </>
            )}
          </div>
        )}
        {err && <div className="sm:col-span-2"><Banner tone="danger">{err}</Banner></div>}
      </form>
    </Dialog>
  );
}
