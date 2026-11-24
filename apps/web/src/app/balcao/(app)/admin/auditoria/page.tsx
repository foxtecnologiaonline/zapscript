'use client';
import React, { useCallback, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Banner, Button, Card, DataTable, LoadMore, PageHeader, Select, TextField, useToast, type Column } from '../../../_ui/ui';
import { ErrorBox, Loading, NoPerm, errFull, useCursorList, useLoad } from '../usuarios/_shared';
import AuditDetail, { type AuditEntry } from './AuditDetail';

const PREFIXES = ['auth.*', 'user.*', 'org.*', 'sector.*', 'holiday.*', 'apitoken.*', 'queue.*', 'routing-rule.*', 'canned-response.*', 'conversation.*', 'contact.*', 'dsr.*', 'retention.*', 'security.*', 'audit.export'];
const ENTITIES = ['user', 'org', 'sector', 'holiday', 'apitoken', 'queue', 'routing-rule', 'conversation', 'contact', 'audit', 'incident', 'export'];

interface Filters { actorId: string; action: string; entityType: string; entityId: string; from: string; to: string }
const EMPTY: Filters = { actorId: '', action: '', entityType: '', entityId: '', from: '', to: '' };
const iso = (local: string) => { if (!local) return ''; const d = new Date(local); return isNaN(+d) ? '' : d.toISOString(); };

export default function AuditoriaPage() {
  const { can } = useBvSession();
  const toast = useToast();
  const allowed = can('audit:read');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [dateErr, setDateErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);

  const users = useLoad(() => bv.get<{ items: Array<{ id: string; name: string }> }>('/admin/users', { limit: 200 }).then((r) => r.items), [], allowed && can('user:manage'));
  const query = { actorId: applied.actorId, action: applied.action, entityType: applied.entityType, entityId: applied.entityId, from: iso(applied.from), to: iso(applied.to), limit: 50 };
  const list = useCursorList<AuditEntry>('/admin/audit', query, allowed);

  if (!allowed) return <><PageHeader title="Auditoria" /><NoPerm perm="audit:read" /></>;

  const set = (k: keyof Filters, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.from && draft.to && new Date(draft.from) > new Date(draft.to)) { setDateErr('A data inicial deve ser anterior à final.'); return; }
    setDateErr(null); setApplied({ ...draft, action: draft.action.trim(), entityId: draft.entityId.trim(), actorId: draft.actorId.trim() });
  };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setDateErr(null); };

  const exportCsv = async () => {
    setExporting(true); setExportErr(null);
    try {
      await bv.download('/admin/audit', 'auditoria.csv', { ...query, format: 'csv', limit: undefined });
      toast.success('Exportação iniciada. O arquivo respeita os filtros aplicados (máximo de 50.000 linhas).');
    } catch (err) { setExportErr(errFull(err, 'Não foi possível exportar.')); } finally { setExporting(false); }
  };

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'Data e hora', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    { key: 'actor', header: 'Ator', render: (r) => <div><div>{r.actorName ?? (r.actorType === 'SYSTEM' ? 'Sistema' : r.actorId ?? '—')}</div><div className="text-xs text-bv-muted">{r.actorType}</div></div> },
    { key: 'action', header: 'Ação', render: (r) => <code className="text-xs">{r.action}</code> },
    { key: 'entity', header: 'Entidade', render: (r) => <div className="text-xs">{r.entityType ?? '—'}{r.entityId && <div className="break-all text-bv-muted">{r.entityId}</div>}</div> },
    { key: 'ip', header: 'IP', render: (r) => r.ip ?? '—' },
    { key: 'd', header: 'Detalhes', render: (r) => <Button size="sm" variant="secondary" aria-label={`Ver detalhes: ${r.action} em ${fmtDateTime(r.createdAt)}`} onClick={() => setDetail(r)}>Ver detalhes</Button> },
  ];

  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Trilha imutável de ações sensíveis, da mais recente para a mais antiga."
        actions={<Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>Exportar CSV</Button>} />
      <Card title="Filtros" className="mb-4">
        <form onSubmit={apply} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.data
            ? <Select label="Ator" value={draft.actorId} onChange={(e) => set('actorId', e.target.value)}><option value="">Todos</option>{users.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            : <TextField label="ID do ator" value={draft.actorId} onChange={(e) => set('actorId', e.target.value)} hint="Identificador do usuário." />}
          <div>
            <TextField label="Ação" list="audit-actions" value={draft.action} onChange={(e) => set('action', e.target.value)} hint="Nome exato ou prefixo com asterisco, ex.: user.*" />
            <datalist id="audit-actions">{PREFIXES.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <TextField label="Tipo de entidade" list="audit-entities" value={draft.entityType} onChange={(e) => set('entityType', e.target.value)} />
            <datalist id="audit-entities">{ENTITIES.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <TextField label="ID da entidade" value={draft.entityId} onChange={(e) => set('entityId', e.target.value)} />
          <TextField label="De (data e hora)" type="datetime-local" value={draft.from} onChange={(e) => set('from', e.target.value)} error={dateErr} />
          <TextField label="Até (data e hora)" type="datetime-local" value={draft.to} onChange={(e) => set('to', e.target.value)} />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit">Aplicar filtros</Button>
            <Button variant="secondary" onClick={clear}>Limpar</Button>
          </div>
        </form>
      </Card>
      {exportErr && <div className="mb-3"><Banner tone="danger" title="Falha na exportação">{exportErr}</Banner></div>}
      <p role="status" aria-live="polite" className="mb-2 text-sm text-bv-muted">{list.loading ? 'Carregando registros…' : `${list.items.length} registro(s) exibido(s)${list.hasMore ? ' (há mais)' : ''}.`}</p>
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.items.length ? <Loading label="Carregando auditoria" />
        : <DataTable caption="Registros de auditoria" columns={columns} rows={list.items} rowKey={(r) => r.id} empty="Nenhum registro encontrado para os filtros." />}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={() => void list.loadMore()} />
      {detail && <AuditDetail entry={detail} onClose={closeDetail} />}
    </div>
  );
}
