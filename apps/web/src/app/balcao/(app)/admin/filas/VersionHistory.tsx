'use client';
/**
 * Histórico de versões de uma fila ou regra de roteamento (GET /queues/:id/versions, GET /routing-rules/:id/versions) com
 * comparação campo a campo (só o que mudou) e, para filas, restauração (POST /queues/:id/versions/:version/restore).
 * A restauração traz de volta só a CONFIGURAÇÃO da fila; os atendentes (membros) não são alterados.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { bv, BvApiError } from '@/lib/balcao/api';
import { CHANNEL_LABEL, fmtDateTime, fmtDuration } from '@/lib/balcao/format';
import { Badge, Banner, Button, ConfirmDialog, DataTable, Dialog, Select, useToast, type Column } from '../../../_ui/ui';
import { DAY_ORDER, type Hours } from '../orgao/BusinessHoursEditor';
import { ErrorBox, Loading, WEEKDAY_PT, errFull, hasCode, useLoad } from '../usuarios/_shared';
import { STRATEGY_LABEL } from './types';

interface Version { version: number; snapshot: Record<string, unknown> | null; createdAt: string; deleted: boolean; changedBy: { id: string; name: string | null } | null }
type Kind = 'queue' | 'rule';

const IGNORED = new Set(['id', 'orgId', 'createdAt', 'updatedAt', 'deleted', 'memberIds']);
const LEAF = new Set(['businessHours']);
const LABEL: Record<string, string> = {
  name: 'Nome', slug: 'Identificador', categories: 'Categorias', channels: 'Canais', requiredSkills: 'Habilidades exigidas', priority: 'Prioridade', strategy: 'Estratégia de distribuição',
  slaFirstResponseSec: 'SLA de 1ª resposta', slaResolutionSec: 'SLA de resolução', maxWaitSec: 'Espera máxima', overflowQueueId: 'Fila de transbordo', businessHours: 'Horário de atendimento',
  sectorId: 'Setor', active: 'Situação', position: 'Posição na ordem de avaliação',
  'conditions.channels': 'Condição: canais', 'conditions.contactCategories': 'Condição: categorias do contato', 'conditions.categories': 'Condição: categorias da demanda', 'conditions.intents': 'Condição: intenções',
  'conditions.outsideHours': 'Condição: fora do horário', 'conditions.weekdays': 'Condição: dias da semana', 'conditions.minWaitSec': 'Condição: espera mínima',
  'action.queueId': 'Ação: fila de destino', 'action.priorityBoost': 'Ação: ajuste de prioridade', 'action.setCategory': 'Ação: definir categoria',
};
const labelOf = (k: string) => LABEL[k] ?? k;
const DAY_NUM: Record<number, string> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

/** Achata objetos (exceto as chaves em LEAF) em caminhos "a.b". */
function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (!prefix && IGNORED.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !LEAF.has(path)) flatten(v, path, out); else out[path] = v;
  }
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Change { key: string; before: unknown; after: unknown }
export function diffSnapshots(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Change[] {
  const a = flatten(before), b = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const order = Object.keys(LABEL);
  keys.sort((x, y) => (order.indexOf(x) < 0 ? 999 : order.indexOf(x)) - (order.indexOf(y) < 0 ? 999 : order.indexOf(y)) || x.localeCompare(y));
  return keys.filter((k) => !same(a[k], b[k])).map((k) => ({ key: k, before: a[k], after: b[k] }));
}

function hoursText(h: unknown): string {
  if (!h || typeof h !== 'object') return 'Horário padrão do órgão';
  const parts = DAY_ORDER.map((d) => { const w = (h as Hours)[d] ?? []; return `${(WEEKDAY_PT[d] ?? d).replace('-feira', '')}: ${w.length ? w.map(([s, e]) => `${s}–${e}`).join(', ') : 'fechado'}`; });
  return parts.join(' · ');
}

function formatValue(key: string, v: unknown, names: Record<string, string>): string {
  if (v === undefined || v === null || v === '') return key === 'businessHours' ? hoursText(null) : '—';
  switch (key) {
    case 'active': return v ? 'Ativa' : 'Inativa';
    case 'strategy': return STRATEGY_LABEL[v as keyof typeof STRATEGY_LABEL] ?? String(v);
    case 'businessHours': return hoursText(v);
    case 'overflowQueueId': case 'action.queueId': return names[String(v)] ?? 'Fila removida ou desconhecida';
    case 'sectorId': return names[String(v)] ?? 'Outro setor';
    case 'conditions.outsideHours': return v ? 'Sim, só fora do horário' : 'Não, só dentro do horário';
  }
  if (/Sec$/.test(key) && typeof v === 'number') return `${fmtDuration(v)} (${v} s)`;
  if (key === 'channels' || key === 'conditions.channels') return Array.isArray(v) ? (v.length ? v.map((c) => CHANNEL_LABEL[String(c)] ?? String(c)).join(', ') : 'Todos os canais') : String(v);
  if (key === 'conditions.weekdays' && Array.isArray(v)) return v.map((d) => (WEEKDAY_PT[typeof d === 'number' ? DAY_NUM[d] : String(d)] ?? String(d)).replace('-feira', '')).join(', ') || '—';
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '(nenhum)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
}

function DiffTable({ changes, names, caption }: { changes: Change[]; names: Record<string, string>; caption: string }) {
  if (!changes.length) return <p className="text-sm">Nenhum campo de configuração mudou entre as duas versões comparadas.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-bv-border">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="bv-sr-only">{caption}</caption>
        <thead className="bg-bv-subtle"><tr><th scope="col" className="px-3 py-2 font-semibold">Campo</th><th scope="col" className="px-3 py-2 font-semibold">Antes</th><th scope="col" className="px-3 py-2 font-semibold">Depois</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} className="border-t border-bv-border align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">{labelOf(c.key)}</th>
              <td className="px-3 py-2 break-words"><span className="bv-sr-only">Antes: </span>{formatValue(c.key, c.before, names)}</td>
              <td className="px-3 py-2 break-words"><span className="bv-sr-only">Depois: </span><strong>{formatValue(c.key, c.after, names)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VersionHistory({ kind, id, name, names, onClose, onRestored }: {
  kind: Kind; id: string; name: string; /** id → nome (filas e setores) para exibir referências legíveis */ names: Record<string, string>; onClose: () => void; onRestored?: () => void;
}) {
  const toast = useToast();
  const base = kind === 'queue' ? `/queues/${id}/versions` : `/routing-rules/${id}/versions`;
  const { data, error, loading, reload } = useLoad(() => bv.get<{ items: Version[] }>(base, { limit: 50 }).then((r) => r.items), [base]);
  const [sel, setSel] = useState<number | null>(null);
  const [cmp, setCmp] = useState<string>('prev');
  const [restoreV, setRestoreV] = useState<Version | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const items = data ?? [];
  const noun = kind === 'queue' ? 'fila' : 'regra';

  useEffect(() => { if (items.length && (sel == null || !items.some((v) => v.version === sel))) setSel(items[0].version); }, [items, sel]);
  useEffect(() => { setCmp('prev'); }, [sel]);

  const idx = items.findIndex((v) => v.version === sel);
  const selected = idx >= 0 ? items[idx] : null;
  const other = useMemo(() => {
    if (!selected) return null;
    if (cmp === 'prev') return items[idx + 1] ?? null;
    return items.find((v) => v.version === Number(cmp)) ?? null;
  }, [selected, cmp, items, idx]);
  const changes = useMemo(() => (selected ? diffSnapshots(other?.snapshot ?? null, selected.snapshot) : []), [selected, other]);

  const doRestore = async () => {
    if (!restoreV) return;
    setActionErr(null);
    try {
      const r = await bv.post<{ version: number; restoredFrom: number }>(`/queues/${id}/versions/${restoreV.version}/restore`);
      toast.success(`Configuração da fila restaurada a partir da versão ${r.restoredFrom} (nova versão ${r.version}). Os atendentes não foram alterados.`);
      setAnnounce(`Fila restaurada para a versão ${r.restoredFrom}; criada a versão ${r.version}.`);
      setSel(null); reload(); onRestored?.();
    } catch (e) {
      setActionErr(hasCode(e, 'version.not_found') ? 'Versão não encontrada (ela pode ter sido removida). Atualize o histórico.'
        : hasCode(e, 'version.not_restorable') ? 'Esta versão registra a exclusão da fila e não pode ser restaurada.'
        : hasCode(e, 'version.invalid_snapshot') ? `Esta versão não pode ser restaurada porque a configuração gravada não é mais válida. ${e instanceof BvApiError ? errFull(e) : ''}`
        : errFull(e));
    }
  };

  const cols: Column<Version>[] = [
    { key: 'v', header: 'Versão', render: (v) => <div className="flex flex-wrap items-center gap-1"><strong>{v.version}</strong>{v.version === items[0]?.version && !v.deleted && <Badge tone="primary">Atual</Badge>}{v.deleted && <Badge tone="danger">Exclusão</Badge>}</div> },
    { key: 'd', header: 'Data', render: (v) => fmtDateTime(v.createdAt) },
    { key: 'w', header: 'Alterado por', render: (v) => (v.changedBy ? v.changedBy.name ?? 'Usuário removido' : 'Sistema') },
    {
      key: 'a', header: 'Ações', render: (v) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={sel === v.version ? 'primary' : 'secondary'} aria-pressed={sel === v.version} aria-label={`Ver alterações da versão ${v.version}`} onClick={() => setSel(v.version)}>Ver alterações</Button>
          {kind === 'queue' && (
            <Button size="sm" variant="secondary" disabled={v.deleted || v.version === items[0]?.version} title={v.deleted ? 'Versão de exclusão não pode ser restaurada' : v.version === items[0]?.version ? 'É a versão atual' : undefined}
              aria-label={`Restaurar esta versão (${v.version}) da fila ${name}`} onClick={() => { setActionErr(null); setRestoreV(v); }}>Restaurar esta versão</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Dialog open onClose={onClose} title={`Histórico — ${noun} ${name}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-bv-muted">Cada alteração de configuração gera uma versão (da mais recente para a mais antiga; até 50). Selecione uma versão para ver o que mudou nela.{kind === 'queue' ? ' A restauração traz de volta apenas a configuração da fila — os atendentes (membros) não são restaurados.' : ' Regras de roteamento ainda não podem ser restauradas por aqui; use o histórico como referência para editar a regra.'}</p>
          <div role="status" aria-live="polite" className="bv-sr-only">{announce}</div>
          {actionErr && <Banner tone="danger" title="Não foi possível restaurar">{actionErr}</Banner>}
          {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading label="Carregando histórico" /> : (
            <>
              <DataTable caption={`Versões da ${noun} ${name}`} columns={cols} rows={items} rowKey={(v) => String(v.version)} empty="Nenhuma versão registrada. As versões passam a ser gravadas a partir da próxima alteração." />
              {selected && (
                <section aria-labelledby="vh-diff" className="flex flex-col gap-3 rounded-lg border border-bv-border p-3">
                  <h3 id="vh-diff" className="font-semibold" tabIndex={-1}>Alterações da versão {selected.version}</h3>
                  <div className="max-w-md">
                    <Select label="Comparar com" value={cmp} onChange={(e) => setCmp(e.target.value)}>
                      <option value="prev">{items[idx + 1] ? `Versão anterior (${items[idx + 1].version})` : 'Nenhuma (primeira versão registrada)'}</option>
                      {items.filter((v) => v.version !== selected.version && v.version !== items[idx + 1]?.version).map((v) => <option key={v.version} value={v.version}>Versão {v.version} — {fmtDateTime(v.createdAt)}{v.version === items[0].version ? ' (atual)' : ''}</option>)}
                    </Select>
                  </div>
                  {selected.deleted && <Banner tone="warning">Esta versão registra a exclusão da {noun}.</Banner>}
                  {!other && <p className="text-sm text-bv-muted">Não há versão anterior registrada; todos os valores desta versão aparecem como novos.</p>}
                  <p className="text-xs text-bv-muted">Mostrando só os campos que mudaram. Versões antigas podem não trazer todos os campos.{kind === 'queue' ? ' A lista de atendentes não é comparada.' : ''}</p>
                  <DiffTable changes={changes} names={names} caption={`Campos alterados entre a versão ${other ? other.version : 'inicial'} e a versão ${selected.version}`} />
                </section>
              )}
            </>
          )}
        </div>
      </Dialog>
      {restoreV && (
        <ConfirmDialog open title="Restaurar esta versão?" confirmLabel="Restaurar configuração" danger onClose={() => setRestoreV(null)} onConfirm={doRestore}
          message={<>Restaurar a configuração da fila “{name}” para a <strong>versão {restoreV.version}</strong> ({fmtDateTime(restoreV.createdAt)})? Nome, canais, categorias, SLA, horário, transbordo, setor e situação voltam aos valores dessa versão e será criada uma nova versão. <strong>Os atendentes (membros) da fila NÃO são restaurados</strong> e continuam como estão. A ação é registrada em auditoria.</>} />
      )}
    </>
  );
}
