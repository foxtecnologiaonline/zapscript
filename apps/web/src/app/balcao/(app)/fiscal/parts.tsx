'use client';
/** Peças do painel do Fiscal: barra de progresso acessível, formatação por item e cartão de consumo. */
import React, { useId } from 'react';
import { fmtBRL, fmtNumber, fmtPercent } from '@/lib/balcao/format';
import { Badge, Card } from '../../_ui/ui';

export const ITEM_ORDER = ['WA_SERVICE', 'WA_UTILITY', 'WA_MARKETING', 'STORAGE_BYTES', 'VOICE_MINUTES', 'VOICE_PEAK_CHANNELS', 'EMAIL_IN', 'EMAIL_OUT', 'WEBCHAT_MSG', 'AI_CALLS', 'AI_TOKENS'];
export const ITEM_FALLBACK: Record<string, string> = {
  WA_SERVICE: 'WhatsApp — conversas de serviço', WA_UTILITY: 'WhatsApp — conversas de utilidade', WA_MARKETING: 'WhatsApp — conversas de marketing', STORAGE_BYTES: 'Armazenamento',
  VOICE_MINUTES: 'Voz — minutos', VOICE_PEAK_CHANNELS: 'Voz — pico de canais simultâneos', EMAIL_IN: 'E-mails recebidos', EMAIL_OUT: 'E-mails enviados', WEBCHAT_MSG: 'Mensagens de webchat', AI_CALLS: 'Chamadas de IA', AI_TOKENS: 'Tokens de IA',
};
export const ACTION_LABEL: Record<string, string> = { ALERT: 'Alertar', BLOCK: 'Bloquear' };
export const QPERIOD_LABEL: Record<string, string> = { DAY: 'Diária', MONTH: 'Mensal' };
export const GB = 1e9;

/** Bytes em unidades decimais (como o contrato: 1 TB = 10¹² bytes). */
export function fmtStorage(n: number | null | undefined): string {
  if (n == null) return '—';
  const u = ['B', 'kB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${fmtNumber(v, i ? 2 : 0)} ${u[i]}`;
}
export function fmtQty(item: string, n: number | null | undefined): string {
  if (n == null) return '—';
  if (item === 'STORAGE_BYTES') return fmtStorage(n);
  if (item === 'VOICE_MINUTES') return `${fmtNumber(n, 0)} min`;
  if (item === 'VOICE_PEAK_CHANNELS') return `${fmtNumber(n, 0)} canal(is)`;
  return fmtNumber(n, Number.isInteger(n) ? 0 : 1);
}
export const itemTitle = (it: { trItem?: string | null; label: string }) => (it.trItem ? `Item ${it.trItem} — ${it.label}` : it.label);

export type Level = 'ok' | 'alert' | 'limit';
export const levelOf = (pct: number, alertAtPct: number): Level => (pct >= 100 ? 'limit' : pct >= alertAtPct ? 'alert' : 'ok');
export const LEVEL_TEXT: Record<Level, string> = { ok: 'Dentro da cota', alert: 'Em alerta', limit: 'Cota esgotada' };

/**
 * Barra de progresso acessível (role="progressbar" com valor e texto). O estado nunca depende só da cor:
 * texto + ícone no selo e padrão de preenchimento (sólido = ok, listrado = alerta, quadriculado = esgotada).
 */
export function QuotaMeter({ label, used, limit, alertAtPct, fmt, extra }: { label: string; used: number; limit: number; alertAtPct: number; fmt: (n: number) => string; extra?: React.ReactNode }) {
  const id = useId();
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const level = levelOf(pct, alertAtPct);
  const color = level === 'limit' ? 'bg-bv-danger' : level === 'alert' ? 'bg-bv-warning' : 'bg-bv-success';
  const pattern = level === 'limit'
    ? 'repeating-linear-gradient(45deg, rgb(var(--bv-surface) / .6) 0 3px, transparent 3px 6px), repeating-linear-gradient(-45deg, rgb(var(--bv-surface) / .6) 0 3px, transparent 3px 6px)'
    : level === 'alert' ? 'repeating-linear-gradient(45deg, rgb(var(--bv-surface) / .6) 0 4px, transparent 4px 8px)' : undefined;
  const text = `${fmt(used)} de ${fmt(limit)} (${fmtPercent(pct, 1)}) — ${LEVEL_TEXT[level]}`;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span id={`${id}-l`} className="font-medium">{label}</span>
        <Badge tone={level === 'limit' ? 'danger' : level === 'alert' ? 'warning' : 'success'}><span aria-hidden="true">{level === 'limit' ? '✖' : level === 'alert' ? '▲' : '✔'}&nbsp;</span>{LEVEL_TEXT[level]}</Badge>
      </div>
      <div role="progressbar" aria-labelledby={`${id}-l`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pct))} aria-valuetext={text}
        className="relative h-4 w-full overflow-hidden rounded border border-bv-border bg-bv-subtle">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%`, backgroundImage: pattern }} />
        <div aria-hidden="true" className="absolute inset-y-0 border-l-2 border-dashed border-bv-text" style={{ left: `${Math.min(100, alertAtPct)}%` }} />
      </div>
      <p className="mt-1 text-xs text-bv-muted">{text}. Alerta a partir de {alertAtPct}% (linha tracejada).{extra}</p>
    </div>
  );
}

const METHOD: Record<string, string> = { linear: 'tendência linear do acumulado', proportional: 'proporcional aos dias decorridos', none: 'sem dados suficientes' };

export function ItemCard({ it, daysElapsed, daysInMonth }: { it: any; daysElapsed: number; daysInMonth: number }) {
  const gauge = it.item === 'STORAGE_BYTES' || it.item === 'VOICE_PEAK_CHANNELS';
  const fmt = (n: number) => fmtQty(it.item, n);
  return (
    <Card title={itemTitle(it)} as="article">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-bv-muted">Hoje</dt><dd className="font-semibold tabular-nums">{fmt(it.today)}</dd></div>
        <div><dt className="text-bv-muted">{gauge ? 'Máximo no mês' : 'Acumulado no mês'}</dt><dd className="font-semibold tabular-nums">{fmt(it.monthToDate)}</dd></div>
        <div><dt className="text-bv-muted">Projeção fim do mês</dt><dd className="font-semibold tabular-nums">{fmt(it.projection?.monthEnd ?? 0)}</dd><dd className="text-xs text-bv-muted">{METHOD[it.projection?.method] ?? ''} ({daysElapsed} de {daysInMonth} dias)</dd></div>
        <div><dt className="text-bv-muted">Custo estimado até hoje</dt><dd className="font-semibold tabular-nums">{fmtBRL(it.estimatedCostToDate)}</dd></div>
        <div><dt className="text-bv-muted">Custo projetado no mês</dt><dd className="font-semibold tabular-nums">{fmtBRL(it.projectedCost)}</dd></div>
      </dl>
      <div className="mt-4 flex flex-col gap-4">
        {(it.quotas ?? []).length === 0 && <p className="text-sm text-bv-muted">Sem cota definida para este item.</p>}
        {(it.quotas ?? []).map((q: any) => (
          <div key={q.id}>
            <QuotaMeter label={`Cota ${q.period === 'DAY' ? 'diária' : 'mensal'} — ação: ${ACTION_LABEL[q.action] ?? q.action}`} used={q.used} limit={q.limit} alertAtPct={q.alertAtPct} fmt={fmt}
              extra={q.period === 'MONTH' ? <> Projeção ao fim do mês: {fmt(q.projectedAtMonthEnd)} ({fmtPercent(q.limit ? (q.projectedAtMonthEnd / q.limit) * 100 : 0, 1)} da cota){q.willExceed ? ' — a projeção excede a cota.' : '.'}</> : undefined} />
            {q.willExceed && <p className="mt-1"><Badge tone="warning"><span aria-hidden="true">▲&nbsp;</span>Projeção excede a cota mensal</Badge></p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
