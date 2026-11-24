'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { acquireSocket, releaseSocket, useBvSocket } from '@/lib/balcao/socket';
import { CHANNEL_LABEL, STATUS_LABEL, fmtDuration, fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, EmptyState, PageHeader, Select, StatCard, TextField, useToast } from '../../_ui/ui';
import { StateGate, useApi } from '../relatorios/lib';
import { AssignDialog, Elapsed, MonitorDialog, PresenceBadge, Since, beep, ensureAudio, fmtClock } from './parts';

interface Queue { queueId: string | null; name: string; waiting: number; longestWaitSec: number; active: number; agentsOnline: number; agentsBusy: number; agentsAvailable: number; maxWaitSec: number | null; slaAtRisk: number }
interface Agent { userId: string; name: string; role: string; presence: string; presenceAt: string | null; load: number; maxConcurrent: number; conversations: Array<{ id: string; protocol: string; channel: string; startedAt: string; slaBreached: boolean; unreadForAgent: number }> }
interface Overview { generatedAt: string; slaRiskMin: number; totals: { waiting: number; active: number; bot: number; agentsOnline: number; slaBreached: number; slaAtRisk: number }; queues: Queue[]; agents: Agent[]; slaBreaches: any[] }

const DEFAULT_RISK_MIN = 10; // padrão do servidor (BV_ROUTING_SLA_RISK_MIN); o valor efetivo vem em `slaRiskMin`
const LONG_WAIT_SEC = 300;  // espera longa quando a fila não define limite
const POLL_MS = 15_000;

type Kind = 'breached' | 'risk' | 'long';
interface Crit { c: any; kind: Kind | null; detail: string; waitBase: number | null }

function classify(c: any, now: number, maxWait: Map<string | null, number | null>, riskMin: number): Crit {
  const waiting = c.status === 'WAITING';
  const due = c.slaFirstResponseDueAt ? Date.parse(c.slaFirstResponseDueAt) : null;
  const noReply = !c.firstResponseAt;
  if (c.slaBreached || (noReply && due != null && due < now && (waiting || c.status === 'ACTIVE'))) return { c, kind: 'breached', detail: due ? `Prazo de 1ª resposta venceu há ${fmtDuration(Math.max(0, (now - due) / 1000))}` : 'SLA violado', waitBase: c.waitSec };
  if (noReply && due != null && due - now <= riskMin * 60_000) return { c, kind: 'risk', detail: `1ª resposta vence em ${fmtDuration(Math.max(0, (due - now) / 1000))}`, waitBase: c.waitSec };
  const limit = maxWait.get(c.queueId ?? null) ?? LONG_WAIT_SEC;
  if (waiting && c.waitSec != null && c.waitSec >= (limit || LONG_WAIT_SEC)) return { c, kind: 'long', detail: `Espera acima de ${fmtDuration(limit || LONG_WAIT_SEC)}`, waitBase: c.waitSec };
  return { c, kind: null, detail: '', waitBase: c.waitSec };
}
const KIND_RANK: Record<Kind, number> = { breached: 0, risk: 1, long: 2 };
const KIND_BADGE: Record<Kind, { tone: 'danger' | 'warning'; text: string; icon: string }> = {
  breached: { tone: 'danger', text: 'SLA violado', icon: '✖' }, risk: { tone: 'warning', text: 'SLA em risco', icon: '▲' }, long: { tone: 'warning', text: 'Espera longa', icon: '⏱' },
};
const PRES_RANK: Record<string, number> = { ONLINE: 0, BUSY: 1, AWAY: 2, OFFLINE: 3 };

export default function SupervisorPage() {
  const { can, token } = useBvSession();
  const toast = useToast();
  const allowed = can('conversation:monitor');
  // limite do "SLA em risco" (minutos): o servidor calcula `slaAtRisk` (por fila e total) com este valor; vazio = padrão do servidor
  const [riskMin, setRiskMin] = useState<number | null>(null);
  const [riskInput, setRiskInput] = useState('');
  const [riskErr, setRiskErr] = useState<string | null>(null);
  const [riskMsg, setRiskMsg] = useState('');
  const ov = useApi<Overview>(allowed ? '/supervisor/overview' : null, riskMin != null ? { slaRiskMin: riskMin } : undefined, { pollMs: POLL_MS });
  const cv = useApi<{ items: any[] }>(allowed ? '/supervisor/conversations' : null, { status: 'WAITING,ACTIVE', sort: 'priority', limit: 100 }, { pollMs: POLL_MS });

  // ── tempo real ──
  const [connected, setConnected] = useState(false);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false); soundRef.current = sound;
  const refreshT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef({ ov: ov.reload, cv: cv.reload }); reloadRef.current = { ov: ov.reload, cv: cv.reload };
  const refreshSoon = useCallback(() => {
    if (refreshT.current) return; // junta rajadas de eventos em uma única atualização
    refreshT.current = setTimeout(() => { refreshT.current = null; void reloadRef.current.ov(); void reloadRef.current.cv(); }, 1500);
  }, []);
  useEffect(() => () => { if (refreshT.current) clearTimeout(refreshT.current); }, []);
  useBvSocket(allowed ? token : null, {
    'conversation:new': refreshSoon, 'conversation:updated': refreshSoon, 'conversation:assigned': refreshSoon, 'conversation:closed': refreshSoon, 'presence:changed': refreshSoon,
    'sla:breach': () => { refreshSoon(); if (soundRef.current) beep(); },
  });
  useEffect(() => {
    if (!allowed || !token) return;
    const s = acquireSocket(token);
    const on = () => setConnected(true), off = () => setConnected(false);
    setConnected(s.connected); s.on('connect', on); s.on('disconnect', off);
    return () => { s.off('connect', on); s.off('disconnect', off); releaseSocket(); };
  }, [allowed, token]);

  // relógio de classificação (a cada 10 s; os contadores visuais têm relógio próprio)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  useEffect(() => { setNow(Date.now()); }, [ov.updatedAt, cv.updatedAt]);

  const o = ov.data;
  const effRisk = o?.slaRiskMin ?? riskMin ?? DEFAULT_RISK_MIN;
  useEffect(() => { if (o?.slaRiskMin != null) setRiskInput((cur) => (cur === '' ? String(o.slaRiskMin) : cur)); }, [o?.slaRiskMin]);
  const applyRisk = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(riskInput.trim());
    if (riskInput.trim() === '' || !Number.isInteger(n) || n < 1 || n > 1440) { setRiskErr('Informe um número inteiro de minutos entre 1 e 1440.'); return; }
    setRiskErr(null); setRiskMin(n); setRiskMsg(`Limite de SLA em risco ajustado para ${n} min. Atualizando os dados.`);
  };
  const maxWait = useMemo(() => new Map<string | null, number | null>((o?.queues ?? []).map((q) => [q.queueId, q.maxWaitSec])), [o]);
  const crit = useMemo(() => {
    const items = new Map<string, any>((cv.data?.items ?? []).map((c) => [c.id, c]));
    for (const b of o?.slaBreaches ?? []) if (!items.has(b.id)) items.set(b.id, { ...b, firstResponseAt: null, slaBreached: true, contact: null, queue: o?.queues.find((q) => q.queueId === b.queueId) ? { id: b.queueId, name: o!.queues.find((q) => q.queueId === b.queueId)!.name } : null, assignee: b.assignedUserId ? { id: b.assignedUserId, name: o?.agents.find((a) => a.userId === b.assignedUserId)?.name ?? '—' } : null, waitSec: b.status === 'WAITING' && b.queuedAt ? Math.max(0, (now - Date.parse(b.queuedAt)) / 1000) : null });
    return [...items.values()].map((c) => classify(c, now, maxWait, effRisk));
  }, [cv.data, o, now, maxWait, effRisk]);
  const critical = useMemo(() => crit.filter((x) => x.kind).sort((a, b) => KIND_RANK[a.kind!] - KIND_RANK[b.kind!] || (b.c.waitSec ?? 0) - (a.c.waitSec ?? 0)), [crit]);
  // violações por fila: contadas no cliente a partir da lista de conversas (até 100); o RISCO vem do servidor (`queues[].slaAtRisk`)
  const breachedByQueue = useMemo(() => { const m = new Map<string | null, number>(); for (const x of crit) { if (x.kind !== 'breached') continue; const k = x.c.queueId ?? null; m.set(k, (m.get(k) ?? 0) + 1); } return m; }, [crit]);

  // ── resumo anunciado a leitores de tela (educado, no máximo a cada 20 s, só quando muda) ──
  const [announce, setAnnounce] = useState('');
  const lastAnn = useRef({ at: 0, text: '' });
  const annT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summary = o ? `Em espera: ${o.totals.waiting}. Em atendimento: ${o.totals.active}. SLA violado: ${o.totals.slaBreached}. SLA em risco: ${o.totals.slaAtRisk}. Atendentes disponíveis: ${o.totals.agentsOnline}.` : '';
  useEffect(() => {
    if (!summary || summary === lastAnn.current.text) return;
    const wait = Math.max(0, 20_000 - (Date.now() - lastAnn.current.at));
    if (annT.current) clearTimeout(annT.current);
    annT.current = setTimeout(() => { lastAnn.current = { at: Date.now(), text: summary }; setAnnounce(summary); }, lastAnn.current.at ? wait : 0);
    return () => { if (annT.current) clearTimeout(annT.current); };
  }, [summary]);

  // ── ações ──
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [assignConv, setAssignConv] = useState<any | null>(null);
  const [takeConv, setTakeConv] = useState<any | null>(null);
  const closeMonitor = useCallback(() => setMonitorId(null), []);
  const closeAssign = useCallback(() => setAssignConv(null), []);
  const closeTake = useCallback(() => setTakeConv(null), []);
  const afterAction = useCallback(() => { void ov.reload(); void cv.reload(); }, [ov, cv]);
  const doTakeover = async () => {
    try { await bv.post(`/supervisor/conversations/${takeConv.id}/takeover`); toast.success(`Você assumiu a conversa ${takeConv.protocol}.`); setMonitorId(null); afterAction(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const toggleSound = (on: boolean) => {
    if (on && !ensureAudio()) { toast.error('Seu navegador não permite alertas sonoros.'); return; }
    setSound(on);
    if (on) { toast.info('Alertas sonoros ativados (um bipe quando um SLA for violado).'); beep(); }
  };

  // filtros
  const [show, setShow] = useState<'critical' | 'all'>('critical');
  const [queueFilter, setQueueFilter] = useState('');
  const [presFilter, setPresFilter] = useState('');
  const [search, setSearch] = useState('');
  const [agentsLimit, setAgentsLimit] = useState(40);

  if (!allowed) return <Banner tone="danger" title="Acesso negado">Você não tem permissão para a supervisão em tempo real.</Banner>;

  const rows = (show === 'critical' ? critical : [...crit].sort((a, b) => (a.kind ? KIND_RANK[a.kind] : 9) - (b.kind ? KIND_RANK[b.kind] : 9) || (b.c.waitSec ?? 0) - (a.c.waitSec ?? 0)))
    .filter((x) => !queueFilter || (queueFilter === '__none' ? !x.c.queueId : x.c.queueId === queueFilter));
  const agents = (o?.agents ?? []).filter((a) => (!presFilter || a.presence === presFilter) && (!search || a.name.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (PRES_RANK[a.presence] ?? 9) - (PRES_RANK[b.presence] ?? 9) || a.name.localeCompare(b.name, 'pt-BR'));
  const longest = Math.max(0, ...(o?.queues ?? []).map((q) => q.longestWaitSec));
  const at = ov.updatedAt;
  const queueStatus = (q: Queue) => {
    const breached = breachedByQueue.get(q.queueId) ?? 0;
    if (breached > 0 || (q.maxWaitSec && q.longestWaitSec > q.maxWaitSec)) return <Badge tone="danger">✖ Crítica</Badge>;
    if (q.slaAtRisk > 0 || q.waiting > 0 && q.agentsAvailable === 0) return <Badge tone="warning">▲ Atenção</Badge>;
    return <Badge tone="success">✔ Normal</Badge>;
  };

  return (
    <div>
      <PageHeader title="Supervisão em tempo real" subtitle={`Atualizado às ${fmtClock(at)} · atualização automática a cada 15 s e a cada evento`}
        actions={<>
          <Badge tone={connected ? 'success' : 'warning'}>{connected ? '● Tempo real conectado' : '○ Reconectando — usando atualização periódica'}</Badge>
          <Button variant="secondary" size="sm" onClick={afterAction}>Atualizar agora</Button>
        </>} />
      <div aria-live="polite" aria-atomic="true" className="bv-sr-only">{announce}</div>
      <div className="mb-3"><Checkbox label="Alertas sonoros" hint="Um bipe curto quando um SLA é violado (no máximo 1 a cada 10 s). Desligado por padrão; vale só nesta aba." checked={sound} onChange={(e) => toggleSound(e.target.checked)} /></div>

      <StateGate loading={ov.loading} error={ov.error} data={o} onRetry={ov.reload}>
        {o && (
          <div className="flex flex-col gap-4">
            {o.totals.slaBreached > 0 && <div className="rounded-md border border-bv-danger bg-bv-danger-soft px-3 py-2 text-sm text-bv-danger"><strong className="block">✖ {o.totals.slaBreached} conversa(s) com SLA violado</strong>Veja a lista de conversas críticas abaixo e assuma ou atribua a um atendente.</div>}
            <form onSubmit={applyRisk} noValidate aria-label="Limite de SLA em risco" className="flex flex-wrap items-end gap-3">
              <div className="w-56"><TextField label="Limite de SLA em risco (minutos)" type="number" inputMode="numeric" min={1} max={1440} value={riskInput} onChange={(e) => setRiskInput(e.target.value)} error={riskErr} hint="De 1 a 1440. Padrão do servidor: 10." /></div>
              <Button type="submit" variant="secondary">Aplicar limite</Button>
              <span role="status" aria-live="polite" className="bv-sr-only">{riskMsg}</span>
            </form>
            <section aria-label="Totais" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
              <StatCard label="Em espera" value={fmtNumber(o.totals.waiting)} tone={o.totals.waiting > 0 ? 'warning' : 'neutral'} />
              <StatCard label="Maior espera" value={<Elapsed baseSec={o.totals.waiting ? longest : 0} at={at} />} tone={longest >= LONG_WAIT_SEC ? 'danger' : 'neutral'} />
              <StatCard label="Em atendimento" value={fmtNumber(o.totals.active)} />
              <StatCard label="Com o assistente (IA)" value={fmtNumber(o.totals.bot)} />
              <StatCard label="Atendentes disponíveis" value={fmtNumber(o.totals.agentsOnline)} />
              <StatCard label="SLA em risco" value={fmtNumber(o.totals.slaAtRisk)} tone={o.totals.slaAtRisk > 0 ? 'warning' : 'success'} hint={`Prazo vence em até ${o.slaRiskMin} min`} />
              <StatCard label="SLA violado" value={fmtNumber(o.totals.slaBreached)} tone={o.totals.slaBreached > 0 ? 'danger' : 'success'} hint={o.totals.slaBreached > 0 ? 'Requer ação' : 'Nenhuma violação aberta'} />
            </section>

            <Card title="Filas">
              {o.queues.length === 0 ? <EmptyState title="Nenhuma fila ativa." /> : (
                <div className="overflow-x-auto rounded-lg border border-bv-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <caption className="bv-sr-only">Situação por fila</caption>
                    <thead className="bg-bv-subtle"><tr>{['Fila', 'Situação', 'Em espera', 'Maior espera', 'Em atendimento', 'Atendentes (disp./ocup./online)', 'SLA em risco', 'SLA violado'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                    <tbody>
                      {o.queues.map((q) => {
                        const breached = breachedByQueue.get(q.queueId) ?? 0;
                        return (
                          <tr key={q.queueId ?? 'none'} className="border-t border-bv-border">
                            <th scope="row" className="px-3 py-2 text-left font-medium">{q.name}</th>
                            <td className="px-3 py-2">{queueStatus(q)}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtNumber(q.waiting)}</td>
                            <td className="px-3 py-2 tabular-nums">{q.waiting ? <Elapsed baseSec={q.longestWaitSec} at={at} /> : '—'}{q.maxWaitSec && q.longestWaitSec > q.maxWaitSec ? <> <Badge tone="danger">acima do limite de {fmtDuration(q.maxWaitSec)}</Badge></> : null}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtNumber(q.active)}</td>
                            <td className="px-3 py-2 tabular-nums">{q.agentsAvailable} / {q.agentsBusy} / {q.agentsOnline}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtNumber(q.slaAtRisk)}</td>
                            <td className="px-3 py-2 tabular-nums">{breached}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-bv-muted">“SLA em risco”: conversas em espera ou em atendimento cuja 1ª resposta ou resolução vence em até {o.slaRiskMin} min e ainda não foi violada (calculado pelo servidor; não considera horário útil). “SLA violado” por fila considera as 100 conversas mais prioritárias. Disponível = disponível e abaixo da capacidade; ocupado = ocupado ou na capacidade máxima.</p>
            </Card>

            <Card title="Conversas críticas" actions={<span className="text-sm text-bv-muted">{critical.length} crítica(s)</span>}>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select label="Exibir" value={show} onChange={(e) => setShow(e.target.value as any)}><option value="critical">Somente críticas (SLA violado, em risco, espera longa)</option><option value="all">Todas em espera e em atendimento</option></Select>
                <Select label="Fila" value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}><option value="">Todas as filas</option>{o.queues.map((q) => <option key={q.queueId ?? 'none'} value={q.queueId ?? '__none'}>{q.name}</option>)}</Select>
              </div>
              <StateGate loading={cv.loading} error={cv.error} data={cv.data} onRetry={cv.reload}>
                {rows.length === 0 ? <EmptyState title={show === 'critical' ? 'Nenhuma conversa crítica no momento.' : 'Nenhuma conversa em espera ou em atendimento.'} /> : (
                  <div className="overflow-x-auto rounded-lg border border-bv-border">
                    <table className="w-full border-collapse text-left text-sm">
                      <caption className="bv-sr-only">Conversas críticas ordenadas por gravidade</caption>
                      <thead className="bg-bv-subtle"><tr>{['Alerta', 'Protocolo', 'Canal', 'Fila', 'Situação', 'Atendente', 'Tempo', 'Ações'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                      <tbody>
                        {rows.map(({ c, kind, detail }) => (
                          <tr key={c.id} className="border-t border-bv-border align-top">
                            <td className="px-3 py-2">{kind ? <><Badge tone={KIND_BADGE[kind].tone}><span aria-hidden="true">{KIND_BADGE[kind].icon}&nbsp;</span>{KIND_BADGE[kind].text}</Badge><span className="mt-1 block text-xs text-bv-muted">{detail}</span></> : <Badge>Normal</Badge>}</td>
                            <td className="px-3 py-2 font-medium">{c.protocol}</td>
                            <td className="px-3 py-2">{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                            <td className="px-3 py-2">{c.queue?.name ?? 'Sem fila'}</td>
                            <td className="px-3 py-2">{STATUS_LABEL[c.status] ?? c.status}</td>
                            <td className="px-3 py-2">{c.assignee?.name ?? <span className="text-bv-muted">Sem atendente</span>}</td>
                            <td className="px-3 py-2 tabular-nums">{c.status === 'WAITING' ? <>Espera <Elapsed baseSec={c.waitSec} at={cv.updatedAt ?? at} /></> : <>Desde o início: <Since iso={c.startedAt} /></>}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                <Button size="sm" variant="secondary" onClick={() => setMonitorId(c.id)}>Monitorar<span className="bv-sr-only"> conversa {c.protocol}</span></Button>
                                <Button size="sm" variant="secondary" onClick={() => setTakeConv(c)}>Assumir<span className="bv-sr-only"> conversa {c.protocol}</span></Button>
                                <Button size="sm" variant="secondary" onClick={() => setAssignConv(c)}>Atribuir<span className="bv-sr-only"> conversa {c.protocol} a um atendente</span></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </StateGate>
            </Card>

            <Card title="Atendentes" actions={<span className="text-sm text-bv-muted">{agents.length} de {o.agents.length}</span>}>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TextField label="Buscar por nome" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setAgentsLimit(40); }} />
                <Select label="Presença" value={presFilter} onChange={(e) => { setPresFilter(e.target.value); setAgentsLimit(40); }}><option value="">Todas</option><option value="ONLINE">Disponível</option><option value="BUSY">Ocupado</option><option value="AWAY">Ausente</option><option value="OFFLINE">Desconectado</option></Select>
              </div>
              {agents.length === 0 ? <EmptyState title="Nenhum atendente encontrado." /> : (
                <div className="overflow-x-auto rounded-lg border border-bv-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <caption className="bv-sr-only">Atendentes, presença e carga de trabalho</caption>
                    <thead className="bg-bv-subtle"><tr>{['Atendente', 'Presença', 'No estado há', 'Carga', 'Conversas ativas'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                    <tbody>
                      {agents.slice(0, agentsLimit).map((a) => {
                        const full = a.maxConcurrent > 0 && a.load >= a.maxConcurrent;
                        return (
                          <tr key={a.userId} className="border-t border-bv-border align-top">
                            <th scope="row" className="px-3 py-2 text-left font-medium">{a.name}</th>
                            <td className="px-3 py-2"><PresenceBadge presence={a.presence} /></td>
                            <td className="px-3 py-2 tabular-nums">{a.presenceAt ? <Since iso={a.presenceAt} /> : '—'}</td>
                            <td className="px-3 py-2">
                              <span className="tabular-nums">{a.load} de {a.maxConcurrent}</span>{full && <> <Badge tone="warning">na capacidade</Badge></>}
                              <span aria-hidden="true" className="mt-1 block h-1.5 w-24 overflow-hidden rounded bg-bv-subtle"><span className="block h-full bg-bv-primary" style={{ width: `${Math.min(100, a.maxConcurrent ? (100 * a.load) / a.maxConcurrent : 0)}%` }} /></span>
                            </td>
                            <td className="px-3 py-2">
                              {a.conversations.length === 0 ? <span className="text-bv-muted">Nenhuma</span> : (
                                <details><summary className="cursor-pointer">{a.conversations.length}{a.load > a.conversations.length ? '+' : ''} conversa(s)</summary>
                                  <ul className="mt-1 flex flex-col gap-1">{a.conversations.map((c) => (
                                    <li key={c.id} className="flex flex-wrap items-center gap-2"><span>{c.protocol} · {CHANNEL_LABEL[c.channel] ?? c.channel}</span>{c.slaBreached && <Badge tone="danger">✖ SLA violado</Badge>}{c.unreadForAgent > 0 && <Badge tone="warning">{c.unreadForAgent} não lida(s)</Badge>}
                                      <Button size="sm" variant="ghost" onClick={() => setMonitorId(c.id)}>Monitorar<span className="bv-sr-only"> conversa {c.protocol} de {a.name}</span></Button></li>))}</ul>
                                </details>)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {agents.length > agentsLimit && <div className="mt-3 text-center"><Button variant="secondary" onClick={() => setAgentsLimit((n) => n + 40)}>Mostrar mais ({agents.length - agentsLimit} restantes)</Button></div>}
            </Card>
          </div>
        )}
      </StateGate>

      <MonitorDialog id={monitorId} token={token} onClose={closeMonitor} onTakeover={(c) => setTakeConv(c)} onAssign={(c) => setAssignConv(c)} />
      <AssignDialog conv={assignConv} agents={o?.agents ?? []} onClose={closeAssign} onDone={afterAction} />
      <ConfirmDialog open={!!takeConv} title="Assumir conversa" confirmLabel="Assumir" onClose={closeTake} onConfirm={doTakeover}
        message={<>Assumir a conversa {takeConv?.protocol}? Ela será atribuída a você{takeConv?.assignee?.name ? ` e ${takeConv.assignee.name} será avisado(a)` : ''}. A ação é registrada em auditoria.</>} />
    </div>
  );
}
