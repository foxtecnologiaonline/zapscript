'use client';
/** Peças da supervisão: relógio compartilhado, duração ao vivo, alerta sonoro, monitor (somente leitura) e atribuição. */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { emitSocket, useBvSocket } from '@/lib/balcao/socket';
import { CHANNEL_LABEL, PRESENCE_LABEL, STATUS_LABEL, fmtDateTime, fmtDuration, fmtTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Dialog, Select, Spinner, useToast } from '../../_ui/ui';
import { useApi } from '../relatorios/lib';

// ── Relógio de 1 s compartilhado (um único setInterval para todos os contadores) ──
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let nowCache = 0;
const subscribe = (fn: () => void) => {
  subs.add(fn);
  if (!timer) timer = setInterval(() => { nowCache = Date.now(); subs.forEach((f) => f()); }, 1000);
  return () => { subs.delete(fn); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
};
const snapshot = () => { if (!nowCache) nowCache = Date.now(); return nowCache; };
export const useTick = (): number => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Duração que continua a contar entre as atualizações: `baseSec` medido no instante `at` (ms). Não é região aria-live. */
export function Elapsed({ baseSec, at }: { baseSec: number | null | undefined; at: number | null }) {
  const now = useTick();
  if (baseSec == null || at == null) return <>—</>;
  return <>{fmtDuration(baseSec + Math.max(0, (now - at) / 1000))}</>;
}
/** Tempo decorrido desde um instante ISO. */
export function Since({ iso }: { iso: string | null | undefined }) {
  const now = useTick();
  if (!iso) return <>—</>;
  return <>{fmtDuration(Math.max(0, (now - Date.parse(iso)) / 1000))}</>;
}

// ── Alerta sonoro (opcional, desligado por padrão) ───────────────────────────
let audioCtx: AudioContext | null = null;
export function ensureAudio() {
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return false;
    audioCtx ??= new AC();
    void audioCtx.resume();
    return true;
  } catch { return false; }
}
let lastBeep = 0;
export function beep() {
  if (!audioCtx || Date.now() - lastBeep < 10_000) return; // no máximo um bipe a cada 10 s
  lastBeep = Date.now();
  try {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.35);
  } catch { /* sem áudio */ }
}

export const PRESENCE_ICON: Record<string, string> = { ONLINE: '●', BUSY: '◐', AWAY: '◑', OFFLINE: '○' };
export const presenceTone = (p: string) => (p === 'ONLINE' ? 'success' : p === 'BUSY' ? 'warning' : p === 'AWAY' ? 'warning' : 'neutral') as 'success' | 'warning' | 'neutral';
export const PresenceBadge = ({ presence }: { presence: string }) => <Badge tone={presenceTone(presence)}><span aria-hidden="true">{PRESENCE_ICON[presence] ?? '○'}&nbsp;</span>{PRESENCE_LABEL[presence] ?? presence}</Badge>;

const SENDER: Record<string, string> = { CONTACT: 'Cidadão', AGENT: 'Atendente', BOT: 'Assistente (IA)', SYSTEM: 'Sistema' };
const EVENT_LABEL: Record<string, string> = {
  QUEUED: 'Entrou na fila', ASSIGNED: 'Atribuída', TRANSFERRED: 'Transferida', OVERFLOW: 'Transbordo de fila', SLA_BREACH: 'SLA violado', TIMEOUT: 'Encerrada por inatividade',
  TAKEOVER: 'Assumida pela supervisão', CLOSED: 'Encerrada', ESCALATED: 'Escalada para atendente', ATTACHMENT_UPLOADED: 'Anexo enviado',
};

// ── Monitor: visualização somente leitura ────────────────────────────────────
export function MonitorDialog({ id, token, onClose, onTakeover, onAssign }: { id: string | null; token: string | null; onClose: () => void; onTakeover: (c: any) => void; onAssign: (c: any) => void }) {
  const { data, loading, error, reload } = useApi<any>(id ? `/conversations/${id}` : null);
  const idRef = useRef(id); idRef.current = id;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // entra na sala da conversa para receber mensagens novas (cada recarga é auditada, então só quando há mensagem nova)
  useEffect(() => {
    if (!id || !token) return;
    emitSocket(token, 'conv:join', id);
    return () => emitSocket(token, 'conv:leave', id);
  }, [id, token]);
  useBvSocket(token, {
    'message:new': (p: any) => {
      if (!idRef.current || p?.conversationId !== idRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void reload(); }, 1000);
    },
  });
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const conv = data?.conversation;
  return (
    <Dialog open={!!id} onClose={onClose} size="lg" title={conv ? `Monitorando ${conv.protocol}` : 'Monitorar conversa'}
      footer={<>
        <Button variant="secondary" onClick={() => void reload()}>Atualizar</Button>
        {conv && conv.status !== 'CLOSED' && <Button variant="secondary" onClick={() => onAssign(conv)}>Atribuir…</Button>}
        {conv && conv.status !== 'CLOSED' && <Button onClick={() => onTakeover(conv)}>Assumir conversa</Button>}
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      </>}>
      {loading && !data && <div className="flex justify-center p-6"><Spinner size={28} /></div>}
      {error && !data && <Banner tone="danger">{error}</Banner>}
      {data && (
        <div className="flex flex-col gap-3">
          <Banner tone="primary">Visualização somente leitura. O acesso a esta conversa fica registrado em auditoria; a conversa é atualizada quando chega uma nova mensagem.</Banner>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div><dt className="text-bv-muted">Canal</dt><dd>{CHANNEL_LABEL[conv.channel] ?? conv.channel}</dd></div>
            <div><dt className="text-bv-muted">Situação</dt><dd>{STATUS_LABEL[conv.status] ?? conv.status}</dd></div>
            <div><dt className="text-bv-muted">Prioridade</dt><dd>{conv.priority} <span className="text-xs text-bv-muted">(maior = mais urgente)</span></dd></div>
            <div><dt className="text-bv-muted">Fila</dt><dd>{conv.queue?.name ?? 'Sem fila'}</dd></div>
            <div><dt className="text-bv-muted">Atendente</dt><dd>{conv.assignee?.name ?? 'Sem atendente'}</dd></div>
            <div><dt className="text-bv-muted">Cidadão</dt><dd>{data.contact?.name ?? 'Não identificado'}{data.contact?.category ? ` (${data.contact.category})` : ''}</dd></div>
            <div><dt className="text-bv-muted">Início</dt><dd>{fmtDateTime(conv.startedAt)}</dd></div>
            <div><dt className="text-bv-muted">Prazo da 1ª resposta</dt><dd>{conv.slaFirstResponseDueAt ? fmtDateTime(conv.slaFirstResponseDueAt) : '—'}{conv.slaBreached && <> <Badge tone="danger">SLA violado</Badge></>}</dd></div>
          </dl>
          <h3 className="text-sm font-semibold">Mensagens</h3>
          <div role="log" aria-label="Mensagens da conversa" className="max-h-80 overflow-y-auto rounded-md border border-bv-border bg-bv-bg p-2" tabIndex={0}>
            {data.messages.length === 0 && <p className="p-2 text-sm text-bv-muted">Nenhuma mensagem ainda.</p>}
            <ol className="flex flex-col gap-2">
              {data.messages.map((m: any) => {
                const note = m.kind === 'NOTE' || m.direction === 'INTERNAL';
                const who = note ? 'Nota interna' : m.direction === 'IN' ? 'Cidadão' : SENDER[m.senderType] ?? m.senderType;
                return (
                  <li key={m.id} className={`rounded-md border p-2 text-sm ${m.direction === 'IN' ? 'border-bv-border bg-bv-surface' : note ? 'border-bv-warning bg-bv-warning-soft' : 'border-bv-primary bg-bv-primary-soft'}`}>
                    <p className="text-xs font-semibold">{who} <span className="font-normal text-bv-muted">· {fmtTime(m.createdAt)}</span></p>
                    <p className="whitespace-pre-wrap break-words">{m.body ?? (m.attachments?.length ? `[${m.attachments.length} anexo(s)]` : m.kind === 'EVENT' ? '' : `[${m.kind}]`)}</p>
                    {m.attachments?.length > 0 && m.body && <p className="text-xs text-bv-muted">{m.attachments.length} anexo(s)</p>}
                  </li>
                );
              })}
            </ol>
          </div>
          {data.events?.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">Histórico de eventos ({data.events.length})</summary>
              <ul className="mt-1 list-disc pl-5">{data.events.map((e: any) => <li key={e.id}>{fmtDateTime(e.createdAt)} — {EVENT_LABEL[e.type] ?? e.type}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ── Atribuir a atendente ─────────────────────────────────────────────────────
export function AssignDialog({ conv, agents, onClose, onDone }: { conv: { id: string; protocol: string; assignedUserId?: string | null } | null; agents: Array<{ userId: string; name: string; presence: string; load: number; maxConcurrent: number; role: string }>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (conv) { setUserId(''); setErr(null); } }, [conv]);
  const options = [...agents].sort((a, b) => (a.presence === 'ONLINE' ? 0 : 1) - (b.presence === 'ONLINE' ? 0 : 1) || a.name.localeCompare(b.name, 'pt-BR'));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!conv) return;
    if (!userId) { setErr('Selecione o atendente.'); return; }
    setBusy(true); setErr(null);
    try { await bv.post(`/conversations/${conv.id}/assign`, { userId }); toast.success(`Conversa ${conv.protocol} atribuída.`); onDone(); onClose(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!conv} onClose={onClose} size="sm" title={`Atribuir ${conv?.protocol ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-assign-form" loading={busy}>Atribuir</Button></>}>
      <form id="bv-assign-form" onSubmit={submit} className="flex flex-col gap-3">
        <Select label="Atendente" required value={userId} onChange={(e) => setUserId(e.target.value)} error={err}>
          <option value="">Selecione…</option>
          {options.map((a) => <option key={a.userId} value={a.userId} disabled={a.userId === conv?.assignedUserId}>{a.name} — {PRESENCE_LABEL[a.presence] ?? a.presence} ({a.load}/{a.maxConcurrent} conversas){a.userId === conv?.assignedUserId ? ' — já é o responsável' : ''}</option>)}
        </Select>
        <p className="text-xs text-bv-muted">A atribuição manual ignora o limite de conversas simultâneas e é registrada em auditoria. O atendente atual, se houver, será avisado.</p>
      </form>
    </Dialog>
  );
}

export function useStable<T extends (...a: any[]) => any>(fn: T): T { const r = useRef(fn); r.current = fn; return useCallback(((...a: any[]) => r.current(...a)) as T, []); }
export const fmtClock = (ms: number | null) => (ms ? fmtTime(new Date(ms)) : '—');
