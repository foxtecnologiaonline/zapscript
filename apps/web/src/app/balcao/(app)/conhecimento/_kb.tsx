'use client';
/**
 * Tipos e componentes compartilhados da base de conhecimento (console do atendente e curadoria).
 * Contratos: apps/api/src/balcao/ai/{routes,kb,curation}.ts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge } from '../../_ui/ui';

export type ArticleStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
export type ArticleSource = 'MANUAL' | 'CURATORSHIP' | 'IMPORT';

export interface KbArticle {
  id: string; orgId: string; title: string; question: string; answer: string; category: string | null; tags: string[]; language: string;
  status: ArticleStatus; version: number; source: ArticleSource | string; sourceConversationIds: string[];
  authorId: string | null; approvedById: string | null; approvedAt: string | null; rejectedReason: string | null; nextReviewAt: string | null;
  useCount: number; helpfulCount: number; createdAt: string; updatedAt: string;
}
export interface KbSnapshot { title: string; question: string; answer: string; category: string | null; tags: string[]; language?: string; status?: string }
export interface KbVersion { id: string; articleId: string; version: number; snapshot: KbSnapshot; changedById: string | null; createdAt: string }
export interface KbListResponse { items: KbArticle[]; nextCursor: string | null }

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  DRAFT: 'Rascunho', PENDING_REVIEW: 'Em revisão', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', ARCHIVED: 'Arquivado',
};
const STATUS_TONE: Record<ArticleStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral', PENDING_REVIEW: 'warning', APPROVED: 'success', REJECTED: 'danger', ARCHIVED: 'neutral',
};
export const SOURCE_LABEL: Record<string, string> = { MANUAL: 'Manual', CURATORSHIP: 'Curadoria (IA)', IMPORT: 'Importação' };

export const StatusBadge = ({ status }: { status: string }) =>
  <Badge tone={STATUS_TONE[status as ArticleStatus] ?? 'neutral'}>{STATUS_LABEL[status as ArticleStatus] ?? status}</Badge>;

/** Divide "a, b; c" em etiquetas únicas. */
export const parseTags = (s: string): string[] => Array.from(new Set(s.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean)));

/** Copia texto para a área de transferência (com alternativa para contextos sem a API moderna). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* tenta alternativa */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  } catch { return false; }
}

/** Resolve ids de usuário em nomes (melhor esforço: exige user:manage; sem permissão mostra o final do id). */
export function useUserNames(): (id?: string | null) => string {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await bv.get<{ items: Array<{ id: string; name: string }> }>('/admin/users', { limit: 200 });
        if (!off) setMap(Object.fromEntries(r.items.map((u) => [u.id, u.name])));
      } catch { /* sem permissão ou rota indisponível: usa o id abreviado */ }
    })();
    return () => { off = true; };
  }, []);
  return (id) => (!id ? '—' : map[id] ?? `usuário …${id.slice(-4)}`);
}

/** Linha "Versão 3 · aprovado em … · próxima revisão …". */
export function ArticleMeta({ a, nameOf }: { a: KbArticle; nameOf?: (id?: string | null) => string }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      <div className="flex gap-1"><dt className="text-bv-muted">Versão:</dt><dd>{a.version}</dd></div>
      <div className="flex gap-1"><dt className="text-bv-muted">Origem:</dt><dd>{SOURCE_LABEL[a.source] ?? a.source}</dd></div>
      <div className="flex gap-1"><dt className="text-bv-muted">Atualizado em:</dt><dd>{fmtDateTime(a.updatedAt)}</dd></div>
      {a.approvedAt && <div className="flex gap-1"><dt className="text-bv-muted">Aprovado em:</dt><dd>{fmtDateTime(a.approvedAt)}{nameOf && a.approvedById ? ` por ${nameOf(a.approvedById)}` : ''}</dd></div>}
      {nameOf && a.authorId && <div className="flex gap-1"><dt className="text-bv-muted">Autor:</dt><dd>{nameOf(a.authorId)}</dd></div>}
      {a.nextReviewAt && <div className="flex gap-1"><dt className="text-bv-muted">Próxima revisão:</dt><dd>{fmtDateTime(a.nextReviewAt)}</dd></div>}
      <div className="flex gap-1"><dt className="text-bv-muted">Usos pelo assistente:</dt><dd>{a.useCount}</dd></div>
      <div className="flex gap-1"><dt className="text-bv-muted">Marcado como útil:</dt><dd>{a.helpfulCount}</dd></div>
    </dl>
  );
}

// ── Comparação de textos (diferença por palavras, LCS) ───────────────────────
type Op = { t: 'eq' | 'add' | 'del'; v: string };
export function diffWords(a: string, b: string): Op[] {
  const x = a.split(/(\s+)/).filter((s) => s !== ''), y = b.split(/(\s+)/).filter((s) => s !== '');
  // limita o custo O(n*m) para textos muito longos
  if (x.length * y.length > 4_000_000) return [{ t: 'del', v: a }, { t: 'add', v: b }];
  const n = x.length, m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Op[] = [];
  const push = (t: Op['t'], v: string) => { const l = out[out.length - 1]; if (l && l.t === t) l.v += v; else out.push({ t, v }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('eq', x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); i++; } else { push('add', y[j]); j++; }
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}

/** Texto com alterações marcadas por sublinhado/tachado E por rótulo para leitores de tela (não só por cor). */
export function DiffText({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => diffWords(before ?? '', after ?? ''), [before, after]);
  if (before === after) return <p className="whitespace-pre-wrap text-sm">{after || <span className="text-bv-muted">(vazio)</span>}</p>;
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {ops.map((o, i) => o.t === 'eq' ? <span key={i}>{o.v}</span>
        : o.t === 'add' ? <ins key={i} className="bg-bv-success-soft text-bv-success underline"><span className="bv-sr-only">[incluído: </span>{o.v}<span className="bv-sr-only">]</span></ins>
        : <del key={i} className="bg-bv-danger-soft text-bv-danger line-through"><span className="bv-sr-only">[removido: </span>{o.v}<span className="bv-sr-only">]</span></del>)}
    </p>
  );
}
