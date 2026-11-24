'use client';
/**
 * Chamadas e gravações (recording:listen). API: GET /voice/calls (filtros + cursor), GET /voice/calls/:id,
 * GET /voice/calls/:id/recording[/meta]. Toda escuta/baixa é auditada pelo servidor — por isso a gravação só é
 * carregada quando a pessoa pede (nunca automaticamente).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtBytes, fmtDateTime, fmtDuration, maskPhone } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, DataTable, Dialog, EmptyState, LoadMore, PageHeader, Select, Spinner, TextField, useToast, type Column } from '../../_ui/ui';
import { OUTCOME_LABEL, describeTrail, type TrailEntry } from '../admin/ura/trail';

interface CallRow {
  id: string; conversationId: string | null; protocol: string | null; direction: 'IN' | 'OUT'; from: string; to: string; status: string; agentUserId: string | null;
  startedAt: string; answeredAt: string | null; endedAt: string | null; durationSec: number | null; ivrFlowId: string | null; ivrPath: TrailEntry[] | null;
  recordingNotified: boolean; endReason: string | null; hasRecording: boolean; recordingSha256: string | null; recordingSizeBytes: number | null;
}
interface Meta { callId: string; format: string; sha256: string | null; sizeBytes: number | null; durationSec: number | null; recordedAt: string; integrityOk?: boolean }
interface Filters { from: string; to: string; number: string; agentUserId: string; status: string; direction: string; protocol: string; minDuration: string }

const EMPTY: Filters = { from: '', to: '', number: '', agentUserId: '', status: '', direction: '', protocol: '', minDuration: '' };
const STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }> = {
  RINGING: { label: 'Tocando', tone: 'primary' }, IVR: { label: 'Na URA', tone: 'primary' }, QUEUED: { label: 'Na fila', tone: 'warning' }, ACTIVE: { label: 'Em andamento', tone: 'success' },
  ENDED: { label: 'Encerrada', tone: 'neutral' }, ABANDONED: { label: 'Abandonada', tone: 'warning' }, FAILED: { label: 'Falhou', tone: 'danger' },
};
const StatusBadge = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.tone ?? 'neutral'}>{STATUS[s]?.label ?? s}</Badge>;
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();
const csvCell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function query(f: Filters) {
  return {
    from: f.from ? dayStart(f.from) : undefined, to: f.to ? dayEnd(f.to) : undefined, number: f.number.trim() || undefined, agentUserId: f.agentUserId || undefined,
    status: f.status || undefined, direction: f.direction || undefined, protocol: f.protocol.trim() || undefined, minDuration: f.minDuration || undefined,
  };
}

export default function ChamadasPage() {
  const { can, status } = useBvSession();
  const toast = useToast();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const applied = useRef<Filters>(EMPTY);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [sel, setSel] = useState<CallRow | null>(null);
  const [announce, setAnnounce] = useState('');

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setMore(true); else { setLoading(true); setError(null); }
    try {
      const r = await bv.get<{ items: CallRow[]; nextCursor: string | null }>('/voice/calls', { ...query(applied.current), limit: 50, cursor });
      setRows((cur) => (cursor ? [...cur, ...r.items] : r.items)); setNext(r.nextCursor);
      if (!cursor) setAnnounce(`${r.items.length} chamadas${r.nextCursor ? ' (há mais resultados)' : ''}.`);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); setMore(false); }
  }, []);

  useEffect(() => { if (status === 'authed' && can('recording:listen')) void load(); }, [status, can, load]);
  useEffect(() => {
    if (status !== 'authed' || !can('conversation:monitor')) return;
    bv.get<{ items: Array<{ id: string; name: string }> }>('/agents').then((r) => setAgents(r.items)).catch(() => undefined);
  }, [status, can]);

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? 'Atendente' : '—');

  const exportCsv = () => {
    const head = ['data_hora', 'direcao', 'origem', 'destino', 'status', 'atendente', 'protocolo', 'duracao_s', 'gravacao', 'sha256'];
    const lines = [head, ...rows.map((r) => [r.startedAt, r.direction === 'IN' ? 'recebida' : 'realizada', r.from, r.to, STATUS[r.status]?.label ?? r.status, agentName(r.agentUserId), r.protocol ?? '', r.durationSec ?? '', r.hasRecording ? 'sim' : 'nao', r.recordingSha256 ?? ''])];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'chamadas.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(`Lista exportada (${rows.length} linhas carregadas).`);
  };

  if (status === 'authed' && !can('recording:listen')) return <><PageHeader title="Chamadas e gravações" /><Banner tone="warning" title="Acesso restrito">Seu perfil não tem permissão para ouvir gravações.</Banner></>;

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const cols: Column<CallRow>[] = [
    { key: 'when', header: 'Início', render: (r) => fmtDateTime(r.startedAt) },
    { key: 'dir', header: 'Tipo', render: (r) => (r.direction === 'IN' ? 'Recebida' : 'Realizada') },
    { key: 'num', header: 'Números', render: (r) => <span>{maskPhone(r.from)} <span aria-hidden="true">→</span><span className="bv-sr-only"> para </span> {maskPhone(r.to)}</span> },
    { key: 'st', header: 'Situação', render: (r) => <StatusBadge s={r.status} /> },
    { key: 'dur', header: 'Duração', render: (r) => fmtDuration(r.durationSec) },
    { key: 'ag', header: 'Atendente', render: (r) => agentName(r.agentUserId) },
    { key: 'prot', header: 'Protocolo', render: (r) => r.protocol ?? '—' },
    { key: 'rec', header: 'Gravação', render: (r) => (r.hasRecording ? 'Disponível' : 'Sem gravação') },
    { key: 'act', header: 'Ações', render: (r) => <Button size="sm" variant="secondary" onClick={() => setSel(r)} aria-label={`Ver detalhes da chamada de ${fmtDateTime(r.startedAt)}, ${maskPhone(r.from)}`}>Detalhes</Button> },
  ];

  return (
    <div>
      <PageHeader title="Chamadas e gravações" subtitle="Consulta de ligações, trilha da URA e escuta de gravações (cada escuta é auditada)."
        actions={<Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>Exportar lista carregada (CSV)</Button>} />
      <form className="mb-4 grid gap-3 rounded-lg border border-bv-border bg-bv-surface p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros de chamadas"
        onSubmit={(e) => { e.preventDefault(); applied.current = draft; void load(); }}>
        <TextField label="De (data)" type="date" value={draft.from} onChange={set('from')} />
        <TextField label="Até (data)" type="date" value={draft.to} onChange={set('to')} />
        <TextField label="Número (origem ou destino)" inputMode="tel" value={draft.number} onChange={set('number')} />
        <TextField label="Protocolo" value={draft.protocol} onChange={set('protocol')} />
        <Select label="Situação" value={draft.status} onChange={set('status')}>
          <option value="">Todas</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select label="Tipo" value={draft.direction} onChange={set('direction')}>
          <option value="">Todas</option><option value="IN">Recebidas</option><option value="OUT">Realizadas</option>
        </Select>
        <Select label="Atendente" value={draft.agentUserId} onChange={set('agentUserId')}>
          <option value="">Todos</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <TextField label="Duração mínima (segundos)" type="number" min={0} value={draft.minDuration} onChange={set('minDuration')} />
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">Filtrar</Button>
          <Button variant="secondary" onClick={() => { setDraft(EMPTY); applied.current = EMPTY; void load(); }}>Limpar filtros</Button>
        </div>
      </form>
      <div role="status" className="bv-sr-only">{announce}</div>
      {error && <div className="mb-3"><Banner tone="danger" title="Não foi possível carregar as chamadas">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Tentar de novo</Button></Banner></div>}
      {loading ? <div className="flex justify-center p-8"><Spinner size={28} /></div>
        : !error && !rows.length ? <EmptyState title="Nenhuma chamada encontrada" >Ajuste os filtros ou o período.</EmptyState>
        : <DataTable caption="Chamadas" columns={cols} rows={rows} rowKey={(r) => r.id} />}
      <LoadMore hasMore={!!next} loading={more} onClick={() => next && void load(next)} />
      {sel && <CallDetail call={sel} agentName={agentName(sel.agentUserId)} onClose={() => setSel(null)} />}
    </div>
  );
}

function CallDetail({ call, agentName, onClose }: { call: CallRow; agentName: string; onClose: () => void }) {
  const toast = useToast();
  const [full, setFull] = useState<CallRow>(call);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [part, setPart] = useState<'main' | 'ura'>('main');
  const [busy, setBusy] = useState<string | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    bv.get<CallRow>(`/voice/calls/${call.id}`).then(setFull).catch(() => undefined);
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [call.id]);

  const loadMeta = async (verify = false) => {
    setBusy(verify ? 'verify' : 'meta'); setMetaErr(null);
    try { setMeta(await bv.get<Meta>(`/voice/calls/${call.id}/recording/meta`, verify ? { verify: true } : undefined)); }
    catch (e) { setMetaErr(errMsg(e)); } finally { setBusy(null); }
  };
  const loadAudio = async (p: 'main' | 'ura') => {
    setBusy('audio'); setRecErr(null); setPart(p);
    try {
      const url = await bv.blobUrl(`/voice/calls/${call.id}/recording`, { part: p });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url; setSrc(url);
      if (!meta) void loadMeta();
    } catch (e) { setRecErr(errMsg(e)); } finally { setBusy(null); }
  };
  const download = async () => {
    setBusy('dl');
    try { await bv.download(`/voice/calls/${call.id}/recording`, `${full.protocol ?? call.id}.wav`, { part, download: true }); toast.success('Download iniciado (registrado na auditoria).'); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  const events: Array<{ at: string | null; text: string }> = [
    { at: full.startedAt, text: `${full.direction === 'IN' ? 'Chamada recebida de' : 'Ligação realizada para'} ${maskPhone(full.direction === 'IN' ? full.from : full.to)}.` },
    ...(full.answeredAt ? [{ at: full.answeredAt, text: `Atendida por ${agentName}.` }] : []),
    ...(full.endedAt ? [{ at: full.endedAt, text: `Encerrada${full.endReason ? ` (motivo: ${full.endReason})` : ''}. Duração ${fmtDuration(full.durationSec)}.` }] : []),
  ];
  const trail = Array.isArray(full.ivrPath) ? full.ivrPath : [];
  const outcome = [...trail].reverse().find((t) => ['queue', 'transfer', 'hangup', 'aborted'].includes(t.event));

  return (
    <Dialog open onClose={onClose} title={`Chamada de ${fmtDateTime(full.startedAt)}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-bv-muted">Situação</dt><dd><StatusBadge s={full.status} /></dd></div>
          <div><dt className="text-bv-muted">Duração</dt><dd>{fmtDuration(full.durationSec)}</dd></div>
          <div><dt className="text-bv-muted">Origem</dt><dd>{maskPhone(full.from)}</dd></div>
          <div><dt className="text-bv-muted">Destino</dt><dd>{maskPhone(full.to)}</dd></div>
          <div><dt className="text-bv-muted">Atendente</dt><dd>{agentName}</dd></div>
          <div><dt className="text-bv-muted">Protocolo</dt><dd>{full.protocol ?? '—'}</dd></div>
          <div><dt className="text-bv-muted">Aviso de gravação ao chamador</dt><dd>{full.recordingNotified ? 'Informado' : 'Não informado'}</dd></div>
          <div><dt className="text-bv-muted">Atendimento</dt><dd>{full.conversationId ? <a className="text-bv-primary underline" href={`/balcao/atendimento/${encodeURIComponent(full.conversationId)}`}>Abrir conversa vinculada</a> : '—'}</dd></div>
        </dl>

        <section aria-labelledby="cd-line"><h3 id="cd-line" className="mb-1 font-semibold">Linha do tempo</h3>
          <ol className="list-decimal pl-5 text-sm">{events.map((e, i) => <li key={i}><strong>{fmtDateTime(e.at)}</strong> — {e.text}</li>)}</ol>
        </section>

        <section aria-labelledby="cd-ura"><h3 id="cd-ura" className="mb-1 font-semibold">Trilha da URA</h3>
          {!trail.length ? <p className="text-sm text-bv-muted">Esta chamada não passou pela URA (ou a trilha não foi registrada).</p> : (
            <>
              {outcome && <p className="mb-1 text-sm">Resultado: <Badge tone="primary">{OUTCOME_LABEL[outcome.event] ?? outcome.event}</Badge></p>}
              <ol className="list-decimal pl-5 text-sm">{trail.map((t, i) => <li key={i}>{describeTrail(t)}</li>)}</ol>
            </>
          )}
        </section>

        <section aria-labelledby="cd-rec"><h3 id="cd-rec" className="mb-1 font-semibold">Gravação</h3>
          {!full.hasRecording ? <p className="text-sm text-bv-muted">Esta chamada não tem gravação disponível.</p> : (
            <div className="flex flex-col gap-3">
              <Banner tone="warning" title="Escuta auditada">Ouvir, verificar ou baixar esta gravação é registrado na trilha de auditoria com o seu usuário. Use apenas para finalidade legítima (LGPD).</Banner>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void loadAudio('main')} loading={busy === 'audio' && part === 'main'}>{src && part === 'main' ? 'Recarregar gravação' : 'Carregar gravação para ouvir'}</Button>
                <Button variant="secondary" onClick={() => void loadAudio('ura')} loading={busy === 'audio' && part === 'ura'}>Ouvir fase da URA</Button>
                <Button variant="secondary" onClick={() => void download()} loading={busy === 'dl'}>Baixar WAV</Button>
              </div>
              {recErr && <Banner tone="danger">{recErr}</Banner>}
              {src && (
                <div>
                  <p className="mb-1 text-sm">{part === 'ura' ? 'Fase da URA' : 'Gravação principal'}</p>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption -- gravação de voz de terceiros; sem transcrição disponível na API */}
                  <audio controls src={src} className="w-full" aria-label="Reprodutor da gravação da chamada" />
                </div>
              )}
              <div className="rounded-md border border-bv-border p-3 text-sm">
                <p className="mb-1 font-medium">Integridade</p>
                <dl className="grid gap-1 sm:grid-cols-2">
                  <div><dt className="text-bv-muted">Tamanho</dt><dd>{fmtBytes(meta?.sizeBytes ?? full.recordingSizeBytes)}</dd></div>
                  <div><dt className="text-bv-muted">Formato</dt><dd>{meta?.format ?? 'audio/wav'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-bv-muted">SHA-256</dt><dd className="break-all font-mono text-xs">{meta?.sha256 ?? full.recordingSha256 ?? '—'}</dd></div>
                </dl>
                {meta?.integrityOk !== undefined && <p className="mt-2"><Badge tone={meta.integrityOk ? 'success' : 'danger'}>{meta.integrityOk ? 'Integridade confirmada: o arquivo confere com o SHA-256 registrado' : 'ATENÇÃO: o arquivo NÃO confere com o SHA-256 registrado'}</Badge></p>}
                {metaErr && <p role="alert" className="mt-2 text-bv-danger">{metaErr}</p>}
                <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void loadMeta(true)} loading={busy === 'verify'}>Verificar integridade agora</Button></div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
