'use client';
/** Quadro (kanban) — GET /tasks/board. Sem arrastar: cada cartão tem botões "Mover para…" (teclado e leitor de tela). */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { Badge, Banner, Button, Checkbox, Select, Spinner } from '../../_ui/ui';
import { KIND_LABEL, DueInfo, MoveButtons, PriorityBadge, STATUS_LABEL, StatusDialog, useLookups, type Status, type Task } from './common';

interface BoardRes { columns: Array<{ status: Status; count: number; items: Task[] }>; total: number }
const ORDER: Status[] = ['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE'];

export default function Board({ refreshKey, onSeeAll }: { refreshKey: number; onSeeAll: (status: Status) => void }) {
  const { can } = useBvSession();
  const lk = useLookups();
  const [data, setData] = useState<BoardRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(false); const [overdue, setOverdue] = useState(false); const [sectorId, setSectorId] = useState(''); const [showCancelled, setShowCancelled] = useState(false);
  const [move, setMove] = useState<{ t: Task; to: Status } | null>(null);
  const [announce, setAnnounce] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try { setData(await bv.get<BoardRes>('/tasks/board', { perColumn: 20, mine: mine ? '1' : undefined, overdue: overdue ? '1' : undefined, sectorId: sectorId || undefined })); }
    catch (e) { setError(errMsg(e)); }
  }, [mine, overdue, sectorId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const cols = ORDER.concat(showCancelled ? ['CANCELLED'] : []);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-bv-border bg-bv-surface p-3">
        <Checkbox label="Somente minhas" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        <Checkbox label="Somente vencidas" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
        <Checkbox label="Mostrar canceladas" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
        {lk.canSectors && <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)}><option value="">Todos</option>{lk.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        <Button variant="secondary" onClick={() => void load()}>Atualizar quadro</Button>
      </div>
      <div role="status" className="bv-sr-only">{announce}</div>
      {error && <Banner tone="danger" title="Não foi possível carregar o quadro">{error}</Banner>}
      {!data && !error && <div className="flex justify-center p-8"><Spinner size={28} /></div>}
      {data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cols.map((st) => {
            const col = data.columns.find((c) => c.status === st);
            const items = col?.items ?? [];
            return (
              <section key={st} aria-labelledby={`col-${st}`} className="flex flex-col gap-2 rounded-lg border border-bv-border bg-bv-subtle p-3">
                <h3 id={`col-${st}`} className="flex items-center justify-between font-semibold">{STATUS_LABEL[st]} <Badge tone="neutral">{col?.count ?? 0}</Badge></h3>
                {!items.length ? <p className="text-sm text-bv-muted">Nenhuma tarefa nesta coluna.</p> : (
                  <ul className="flex flex-col gap-2">
                    {items.map((t) => (
                      <li key={t.id}>
                        <article className="flex flex-col gap-2 rounded-md border border-bv-border bg-bv-surface p-3 text-sm" aria-label={`${t.code}: ${t.title}`}>
                          <div className="flex flex-wrap items-center gap-1"><Link className="font-semibold text-bv-primary underline" href={`/balcao/tarefas/${t.id}`}>{t.code}</Link><PriorityBadge p={t.priority} /><Badge tone="neutral">{KIND_LABEL[t.kind]}</Badge>{t.supportLevel && <Badge tone="neutral">{t.supportLevel}</Badge>}</div>
                          <p className="font-medium">{t.title}</p>
                          <p className="text-bv-muted">{t.assignee?.name ? `Responsável: ${t.assignee.name}` : t.sector?.name ? `Caixa do setor: ${t.sector.name}` : 'Sem responsável'}</p>
                          <DueInfo t={t} compact />
                          <MoveButtons t={t} canManage={can('task:manage')} exclude={['CANCELLED']} onPick={(to) => setMove({ t, to })} />
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
                {col && col.count > items.length && <Button size="sm" variant="ghost" onClick={() => onSeeAll(st)}>Ver todas ({col.count}) na lista</Button>}
              </section>
            );
          })}
        </div>
      )}
      <StatusDialog task={move?.t ?? null} to={move?.to ?? null} onClose={() => setMove(null)} onDone={(t) => { setAnnounce(`${t.code} movida para ${STATUS_LABEL[t.status]}.`); void load(); }} />
    </div>
  );
}
