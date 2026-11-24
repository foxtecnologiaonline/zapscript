'use client';
import React, { useCallback, useState } from 'react';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { CHANNEL_LABEL, fmtDuration } from '@/lib/balcao/format';
import { Badge, Button, ConfirmDialog, DataTable, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, useLoad } from '../usuarios/_shared';
import QueueForm from './QueueForm';
import VersionHistory from './VersionHistory';
import { STRATEGY_LABEL, type Agent, type Queue } from './types';

export default function QueuesTab() {
  const toast = useToast();
  const queues = useLoad(() => bv.get<{ items: Queue[] }>('/queues').then((r) => r.items), []);
  const sectors = useLoad(() => bv.get<{ items: Array<{ id: string; name: string; active: boolean }> }>('/admin/sectors').then((r) => r.items), []);
  const agents = useLoad(() => bv.get<{ items: Agent[] }>('/agents').then((r) => r.items), []);
  const [form, setForm] = useState<{ queue: Queue | null; members: string[] } | null>(null);
  const [del, setDel] = useState<Queue | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [hist, setHist] = useState<Queue | null>(null);
  const closeHist = useCallback(() => setHist(null), []);
  const closeForm = useCallback(() => setForm(null), []);
  const closeDel = useCallback(() => setDel(null), []);

  const sectorName = (id: string | null) => (id ? sectors.data?.find((s) => s.id === id)?.name ?? '—' : '—');
  const queueName = (id: string | null) => (id ? queues.data?.find((q) => q.id === id)?.name ?? '—' : '—');

  const openForm = async (q: Queue | null) => {
    if (!q) { setForm({ queue: null, members: [] }); return; }
    setOpening(q.id);
    try { const r = await bv.get<{ items: Array<{ id: string }> }>(`/queues/${q.id}/members`); setForm({ queue: q, members: r.items.map((m) => m.id) }); }
    catch (e) { toast.error(errMsg(e)); } finally { setOpening(null); }
  };
  const toggle = async (q: Queue) => {
    try { await bv.patch(`/queues/${q.id}`, { active: !q.active }); toast.success(q.active ? 'Fila desativada.' : 'Fila ativada.'); queues.reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!del) return;
    try { await bv.del(`/queues/${del.id}`); toast.success('Fila excluída.'); queues.reload(); }
    catch (e) {
      if (e instanceof BvApiError && e.code === 'queue.in_use') {
        const d = (e.details ?? {}) as { openConversations?: number; overflowRefs?: number; ruleRefs?: number };
        toast.error(`Fila em uso (conversas abertas: ${d.openConversations ?? 0}, transbordos: ${d.overflowRefs ?? 0}, regras: ${d.ruleRefs ?? 0}). Desative-a em vez de excluir.`);
      } else toast.error(errMsg(e));
    }
  };

  const columns: Column<Queue>[] = [
    { key: 'n', header: 'Fila', render: (q) => <div><div className="font-medium">{q.name}</div><div className="text-xs text-bv-muted">{q.slug}{q.businessHours ? ' · horário próprio' : ''}</div></div> },
    { key: 'p', header: 'Prioridade e estratégia', render: (q) => <div className="text-xs"><div>Prioridade {q.priority}</div><div className="text-bv-muted">{STRATEGY_LABEL[q.strategy]}</div></div> },
    { key: 'c', header: 'Canais e categorias', render: (q) => <div className="text-xs"><div>{q.channels.length ? q.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(', ') : 'Todos os canais'}</div><div className="text-bv-muted">{q.categories.length ? q.categories.join(', ') : 'Sem categorias'}</div>{q.requiredSkills.length > 0 && <div className="text-bv-muted">Exige: {q.requiredSkills.join(', ')}</div>}</div> },
    { key: 's', header: 'SLA e espera', render: (q) => <div className="text-xs"><div>1ª resposta: {fmtDuration(q.slaFirstResponseSec)}</div><div>Resolução: {fmtDuration(q.slaResolutionSec)}</div><div className="text-bv-muted">Espera máx.: {fmtDuration(q.maxWaitSec)}{q.overflowQueueId ? ` → ${queueName(q.overflowQueueId)}` : ''}</div></div> },
    { key: 'm', header: 'Atendentes', render: (q) => q.memberCount ?? 0 },
    { key: 'sec', header: 'Setor', render: (q) => sectorName(q.sectorId) },
    { key: 'st', header: 'Situação', render: (q) => <Badge tone={q.active ? 'success' : 'neutral'}>{q.active ? 'Ativa' : 'Inativa'}</Badge> },
    {
      key: 'a', header: 'Ações', render: (q) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" loading={opening === q.id} aria-label={`Editar fila ${q.name}`} onClick={() => void openForm(q)}>Editar</Button>
          <Button size="sm" variant="secondary" aria-label={`${q.active ? 'Desativar' : 'Ativar'} fila ${q.name}`} onClick={() => void toggle(q)}>{q.active ? 'Desativar' : 'Ativar'}</Button>
          <Button size="sm" variant="secondary" aria-label={`Histórico de versões da fila ${q.name}`} onClick={() => setHist(q)}>Histórico</Button>
          <Button size="sm" variant="secondary" aria-label={`Excluir fila ${q.name}`} onClick={() => setDel(q)}>Excluir</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button onClick={() => void openForm(null)}>Nova fila</Button></div>
      {queues.error ? <ErrorBox message={queues.error} onRetry={queues.reload} /> : queues.loading && !queues.data ? <Loading label="Carregando filas" />
        : <DataTable caption="Filas de atendimento" columns={columns} rows={queues.data ?? []} rowKey={(q) => q.id} empty="Nenhuma fila cadastrada." />}
      {form && <QueueForm key={form.queue?.id ?? 'nova'} queue={form.queue} queues={queues.data ?? []} sectors={sectors.data ?? []} agents={agents.data ?? []} initialMembers={form.members} onClose={closeForm} onSaved={queues.reload} />}
      {hist && <VersionHistory kind="queue" id={hist.id} name={hist.name} names={{ ...Object.fromEntries((sectors.data ?? []).map((s) => [s.id, s.name])), ...Object.fromEntries((queues.data ?? []).map((x) => [x.id, x.name])) }} onClose={closeHist} onRestored={queues.reload} />}
      {del && <ConfirmDialog open danger title="Excluir fila" confirmLabel="Excluir" message={`Excluir a fila "${del.name}"? Se houver conversas abertas, transbordos ou regras apontando para ela, a exclusão será recusada; nesse caso desative-a.`} onConfirm={remove} onClose={closeDel} />}
    </div>
  );
}
