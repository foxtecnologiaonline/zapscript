'use client';
/**
 * Utilitários compartilhados pelas páginas de administração A (usuários, filas, órgão, auditoria, segurança).
 * Ficam aqui porque cada frente só pode editar o seu próprio diretório.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { Banner, Button, Spinner } from '../../../_ui/ui';

type QueryValue = string | number | boolean | null | undefined;

/** Carrega dados uma vez e sempre que `deps` mudarem; `reload()` força nova busca. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setError(null); setUnavailable(false);
    fnRef.current()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof BvApiError && (e.status === 404 || e.status === 501) && /^(http\.|request\.|not_found)/.test(e.code)) setUnavailable(true);
        else setError(errMsg(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, setData, error, unavailable, loading, reload };
}

/** Lista paginada por cursor (`{items,nextCursor,total?}`). Reinicia quando `query` muda. */
export function useCursorList<T>(path: string, query: Record<string, QueryValue>, enabled = true) {
  const key = JSON.stringify(query);
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const qRef = useRef(query);
  qRef.current = query;
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setError(null);
    bv.get<{ items: T[]; nextCursor?: string | null; total?: number }>(path, qRef.current)
      .then((r) => { if (!alive) return; setItems(r.items); setNext(r.nextCursor ?? null); setTotal(r.total ?? null); })
      .catch((e) => { if (alive) setError(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, key, tick, enabled]);
  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await bv.get<{ items: T[]; nextCursor?: string | null }>(path, { ...qRef.current, cursor: next });
      setItems((l) => [...l, ...r.items]); setNext(r.nextCursor ?? null);
    } catch (e) { setError(errMsg(e)); } finally { setLoadingMore(false); }
  }, [path, next]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { items, setItems, total, hasMore: !!next, loading, loadingMore, error, reload, loadMore };
}

/** Mapeia `details: [{path,message}]` (400 validation.failed) para erros por campo. */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof BvApiError && Array.isArray(e.details)) {
    for (const d of e.details as Array<{ path?: string; message?: string }>) {
      if (d?.message) { const k = String(d.path ?? ''); out[k] = out[k] ? `${out[k]}; ${d.message}` : d.message; }
    }
  }
  return out;
}

/** Mensagem completa: texto + detalhes de validação ("campo: mensagem"). */
export function errFull(e: unknown, fallback?: string): string {
  const base = errMsg(e, fallback);
  const f = fieldErrors(e);
  const parts = Object.entries(f).map(([k, v]) => (k ? `${k}: ${v}` : v));
  return parts.length ? `${base} ${parts.join(' · ')}` : base;
}

export const hasCode = (e: unknown, code: string) => e instanceof BvApiError && e.code === code;

/** Copia texto; devolve false se o navegador bloquear. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* tenta o método antigo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

/** Baixa texto como arquivo (Blob local, sem rede). */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Escapa célula de CSV e neutraliza injeção de fórmula em planilhas. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" sem passar por fuso horário. */
export function fmtDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

export const WEEKDAY_PT: Record<string, string> = { sun: 'Domingo', mon: 'Segunda-feira', tue: 'Terça-feira', wed: 'Quarta-feira', thu: 'Quinta-feira', fri: 'Sexta-feira', sat: 'Sábado' };

// ── Blocos de estado ─────────────────────────────────────────────────────────
export function Loading({ label = 'Carregando' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-6 text-sm text-bv-muted"><Spinner label={label} /><span aria-hidden="true">{label}…</span></div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Banner tone="danger" title="Não foi possível carregar">{message}</Banner>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}
export function Unavailable({ what }: { what: string }) {
  return <Banner tone="warning" title="Recurso indisponível">{what} ainda não está disponível neste ambiente (rota não encontrada na API).</Banner>;
}
export function NoPerm({ perm }: { perm: string }) {
  return <Banner tone="warning" title="Acesso restrito">Você não tem a permissão necessária ({perm}) para ver esta área.</Banner>;
}

/** Ordena um objeto de forma estável para comparar/mostrar JSON. */
export const pretty = (v: unknown) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
