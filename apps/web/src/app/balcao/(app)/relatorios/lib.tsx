'use client';
/**
 * Utilitários compartilhados de Relatórios / Supervisão / Fiscal: hook de dados com polling, datas no fuso do órgão,
 * formatação por unidade, tabela ordenável e botão de exportação CSV.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDuration, fmtNumber, fmtPercent } from '@/lib/balcao/format';
import { Banner, Button, EmptyState, Spinner, cx, useToast } from '../../_ui/ui';

export type Query = Record<string, string | number | boolean | null | undefined | string[]>;

// ── Dados ────────────────────────────────────────────────────────────────────
export interface ApiState<T> { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void>; updatedAt: number | null }

/**
 * GET autenticado com cancelamento de respostas antigas e atualização periódica opcional (`pollMs`).
 * Em atualização silenciosa (polling) os dados anteriores são mantidos se houver erro.
 */
export function useApi<T = any>(path: string | null, query?: Query, opts: { pollMs?: number } = {}): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; updatedAt: number | null }>({ data: null, error: null, loading: !!path, updatedAt: null });
  const seq = useRef(0);
  const qRef = useRef(query); qRef.current = query;
  const key = JSON.stringify([path, query]);

  const run = useCallback(async (silent: boolean) => {
    if (!path) return;
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await bv.get<T>(path, qRef.current);
      if (id === seq.current) setState({ data, error: null, loading: false, updatedAt: Date.now() });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ data: silent ? s.data : null, error: errMsg(e), loading: false, updatedAt: s.updatedAt }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void run(false); }, [run]);
  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void run(true); }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, path, run]);

  const reload = useCallback(() => run(true), [run]);
  return { ...state, reload };
}

/** Cartão-padrão de estado: carregando / erro / vazio. Retorna null quando há dados para exibir. */
export function StateGate({ loading, error, data, onRetry, children }: { loading: boolean; error: string | null; data: unknown; onRetry?: () => void; children: React.ReactNode }) {
  if (loading && !data) return <div className="flex justify-center p-8"><Spinner size={28} label="Carregando dados" /></div>;
  if (error && !data) return (
    <div className="flex flex-col items-start gap-2">
      <Banner tone="danger" title="Não foi possível carregar os dados">{error}</Banner>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
  if (!data) return <EmptyState title="Sem dados para exibir." />;
  return (
    <div aria-busy={loading || undefined}>
      {error && <div className="mb-3"><Banner tone="warning" title="Atualização falhou">{error} Exibindo os últimos dados carregados.</Banner></div>}
      {children}
    </div>
  );
}

// ── Datas (fuso do órgão) ────────────────────────────────────────────────────
const TZ = 'America/Araguaina';
export const todayStr = (now = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const addDays = (ymd: string, n: number): string => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const monthStart = (ymd: string): string => `${ymd.slice(0, 7)}-01`;
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
export const fmtYmd = (s: string | null | undefined): string => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s ?? '—');
export const fmtMonth = (s: string | null | undefined): string => (s && /^\d{4}-\d{2}/.test(s) ? `${s.slice(5, 7)}/${s.slice(0, 4)}` : s ?? '—');

export type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'custom';
export const PERIOD_LABEL: Record<Exclude<PeriodKey, 'custom'>, string> = { today: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', month: 'Mês atual' };
export function periodRange(k: Exclude<PeriodKey, 'custom'>, now = new Date()): { from: string; to: string } {
  const t = todayStr(now);
  switch (k) {
    case 'today': return { from: t, to: t };
    case '7d': return { from: addDays(t, -6), to: t };
    case '30d': return { from: addDays(t, -29), to: t };
    case 'month': return { from: monthStart(t), to: t };
  }
}

// ── Formatação por unidade ───────────────────────────────────────────────────
export type Unit = 'count' | 'seconds' | 'percent' | 'score';
export function fmtUnit(unit: Unit | string | undefined, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'seconds': return fmtDuration(v);
    case 'percent': return fmtPercent(v, 1);
    case 'score': return fmtNumber(v, 1);
    default: return fmtNumber(v, Number.isInteger(v) ? 0 : 1);
  }
}
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function saveBlob(filename: string, content: string | Blob, mime = 'text/csv;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob(['﻿', content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Botão que baixa um arquivo autenticado (CSV etc.) com estado de carregamento e erro anunciado. */
export function DownloadButton({ path, filename, query, children = 'Exportar CSV', variant = 'secondary', size = 'sm' }: { path: string; filename: string; query?: Query; children?: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant={variant} size={size} loading={busy} onClick={async () => {
      setBusy(true);
      try { await bv.download(path, filename, query); toast.success(`Arquivo ${filename} gerado.`); }
      catch (e) { toast.error(errMsg(e, 'Não foi possível gerar o arquivo.')); }
      finally { setBusy(false); }
    }}>{children}</Button>
  );
}

// ── Tabela ordenável ─────────────────────────────────────────────────────────
export interface SCol<T> { key: string; header: string; value: (r: T) => number | string | null | undefined; render?: (r: T) => React.ReactNode; numeric?: boolean }
/** Tabela com cabeçalhos ordenáveis (botões + aria-sort). */
export function SortableTable<T>({ caption, columns, rows, rowKey, defaultSort, empty = 'Nenhum registro no período.' }: { caption: string; columns: SCol<T>[]; rows: T[]; rowKey: (r: T) => string; defaultSort?: { key: string; dir: 'asc' | 'desc' }; empty?: string }) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = columns.find((x) => x.key === sort.key); if (!c) return rows;
    const f = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = c.value(a), vb = c.value(b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * f;
      return String(va).localeCompare(String(vb), 'pt-BR') * f;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-bv-border">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="bv-sr-only">{caption}. Os cabeçalhos são botões que ordenam a tabela.</caption>
        <thead className="bg-bv-subtle">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('px-3 py-2 font-semibold', c.numeric && 'text-right')}>
                  <button type="button" className={cx('inline-flex min-h-[28px] items-center gap-1 rounded font-semibold hover:underline', c.numeric && 'flex-row-reverse')}
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.numeric ? 'desc' : 'asc' }))}>
                    {c.header}
                    <span aria-hidden="true" className="text-xs text-bv-muted">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    <span className="bv-sr-only">{active ? (sort!.dir === 'asc' ? ', ordenado do menor para o maior' : ', ordenado do maior para o menor') : ', clique para ordenar'}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="border-t border-bv-border">
              {columns.map((c) => <td key={c.key} className={cx('px-3 py-2 align-top', c.numeric && 'text-right tabular-nums')}>{c.render ? c.render(r) : (c.value(r) ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Filtros globais dos relatórios ───────────────────────────────────────────
export interface ReportFilters { from: string; to: string; channel: string; queueId: string; agentId: string }
export interface NameMaps { queues: Record<string, string>; agents: Record<string, string> }
export const toQuery = (f: ReportFilters, extra?: Query): Query => ({ from: f.from, to: f.to, channel: f.channel || undefined, queueId: f.queueId || undefined, agentId: f.agentId || undefined, ...extra });
export const queueLabel = (names: NameMaps, id: string | null | undefined, fallback?: string | null) => (id ? names.queues[id] ?? fallback ?? 'Fila removida' : 'Sem fila');
export const agentLabel = (names: NameMaps, id: string | null | undefined, fallback?: string | null) => (id ? names.agents[id] ?? fallback ?? 'Atendente removido' : 'Sem atendente');
export interface TabProps { q: Query; filters: ReportFilters; names: NameMaps }
