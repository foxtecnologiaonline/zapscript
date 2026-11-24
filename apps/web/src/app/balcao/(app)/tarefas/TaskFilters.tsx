'use client';
import React, { useState } from 'react';
import { PRIORITY_LABEL } from '@/lib/balcao/format';
import { Button, Checkbox, Select, TextField } from '../../_ui/ui';
import { KIND_LABEL, STATUS_LABEL, useLookups, type Kind } from './common';

export interface Filters { status: string; priority: string; kind: string; sectorId: string; assigneeId: string; q: string; overdue: boolean; unassigned: boolean; mine: boolean }
export const NO_FILTERS: Filters = { status: '', priority: '', kind: '', sectorId: '', assigneeId: '', q: '', overdue: false, unassigned: false, mine: false };
export const OPEN_CSV = 'OPEN,IN_PROGRESS,WAITING';

export function filtersToQuery(f: Filters) {
  return { status: f.status || undefined, priority: f.priority || undefined, kind: f.kind || undefined, sectorId: f.sectorId || undefined, assigneeId: f.assigneeId || undefined,
    q: f.q.trim() || undefined, overdue: f.overdue ? '1' : undefined, unassigned: f.unassigned ? '1' : undefined, mine: f.mine ? '1' : undefined };
}

export default function TaskFilterForm({ value, onApply, fields = ['status', 'priority', 'kind', 'sector', 'assignee', 'q', 'flags'], fiscal }: { value: Filters; onApply: (f: Filters) => void; fields?: string[]; fiscal?: boolean }) {
  const lk = useLookups();
  const [d, setD] = useState<Filters>(value);
  const has = (k: string) => fields.includes(k);
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  return (
    <form aria-label="Filtros de tarefas" className="mb-4 grid gap-3 rounded-lg border border-bv-border bg-bv-surface p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); onApply(d); }}>
      {has('q') && <TextField label="Buscar por código ou título" value={d.q} onChange={set('q')} />}
      {has('status') && (
        <Select label="Situação" value={d.status} onChange={set('status')}>
          <option value="">Todas</option><option value={OPEN_CSV}>Em aberto (abertas, em andamento e aguardando)</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      )}
      {has('priority') && (
        <Select label="Prioridade" value={d.priority} onChange={set('priority')}>
          <option value="">Todas</option>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      )}
      {has('kind') && !fiscal && (
        <Select label="Tipo" value={d.kind} onChange={set('kind')}>
          <option value="">Todos</option>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
      )}
      {has('sector') && lk.canSectors && (
        <Select label="Setor" value={d.sectorId} onChange={set('sectorId')}><option value="">Todos</option>{lk.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      )}
      {has('assignee') && lk.canUsers && (
        <Select label="Responsável" value={d.assigneeId} onChange={set('assigneeId')}><option value="">Todos</option>{lk.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      )}
      {has('flags') && (
        <fieldset className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4 sm:flex-row sm:gap-6">
          <legend className="mb-1 text-sm font-medium">Filtros rápidos</legend>
          <Checkbox label="Somente vencidas" checked={d.overdue} onChange={set('overdue')} />
          <Checkbox label="Sem responsável" checked={d.unassigned} onChange={set('unassigned')} />
          <Checkbox label="Somente minhas" checked={d.mine} onChange={set('mine')} />
        </fieldset>
      )}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Aplicar filtros</Button>
        <Button variant="secondary" onClick={() => { setD(NO_FILTERS); onApply(NO_FILTERS); }}>Limpar filtros</Button>
      </div>
    </form>
  );
}
