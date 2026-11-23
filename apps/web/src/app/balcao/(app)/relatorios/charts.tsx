'use client';
/**
 * Gráficos SVG próprios (sem bibliotecas), acessíveis:
 *  - <svg role="img"> com <title>/<desc> e aria-label resumindo os dados;
 *  - séries distinguíveis SEM depender de cor (traço, marcador e padrão de preenchimento + legenda com rótulos);
 *  - toda a informação disponível em tabela de dados alternável (<ChartFrame>).
 * Cores vêm dos tokens bv-* (respeitam o modo de alto contraste).
 */
import React, { useId, useState } from 'react';
import { Button, Card, EmptyState } from '../../_ui/ui';

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
export const TONE_VAR: Record<Tone, string> = {
  primary: 'rgb(var(--bv-primary))', success: 'rgb(var(--bv-success))', warning: 'rgb(var(--bv-warning))', danger: 'rgb(var(--bv-danger))', neutral: 'rgb(var(--bv-muted))',
};
const SERIES_TONES: Tone[] = ['primary', 'danger', 'success', 'warning'];
const DASHES = ['', '7 4', '2 3', '9 3 2 3'];
const MARKERS = ['circle', 'square', 'triangle', 'diamond'] as const;
const TEXT = 'rgb(var(--bv-text))', MUTED = 'rgb(var(--bv-muted))', GRID = 'rgb(var(--bv-border))', SURFACE = 'rgb(var(--bv-surface))';

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');

/** Maior valor "redondo" ≥ max para o eixo Y. */
export function niceMax(max: number): number {
  if (!isFinite(max) || max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function Marker({ kind, x, y, tone, size = 4.5 }: { kind: (typeof MARKERS)[number]; x: number; y: number; tone: string; size?: number }) {
  const s = size;
  if (kind === 'circle') return <circle cx={x} cy={y} r={s} fill={SURFACE} stroke={tone} strokeWidth={2} />;
  if (kind === 'square') return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill={SURFACE} stroke={tone} strokeWidth={2} />;
  if (kind === 'triangle') return <path d={`M${x} ${y - s - 1} L${x + s + 1} ${y + s} L${x - s - 1} ${y + s} Z`} fill={SURFACE} stroke={tone} strokeWidth={2} />;
  return <path d={`M${x} ${y - s - 1} L${x + s + 1} ${y} L${x} ${y + s + 1} L${x - s - 1} ${y} Z`} fill={SURFACE} stroke={tone} strokeWidth={2} />;
}

/** Definições de padrões de preenchimento (0 sólido, 1 listras, 2 pontos, 3 xadrez). */
function Patterns({ uid, tones }: { uid: string; tones: Tone[] }) {
  return (
    <defs>
      {tones.map((t) => (
        <React.Fragment key={t}>
          <pattern id={`${uid}-${t}-1`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill={TONE_VAR[t]} /><rect width="2.5" height="7" fill={SURFACE} opacity="0.75" /></pattern>
          <pattern id={`${uid}-${t}-2`} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill={TONE_VAR[t]} /><circle cx="3" cy="3" r="1.3" fill={SURFACE} opacity="0.85" /></pattern>
          <pattern id={`${uid}-${t}-3`} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill={TONE_VAR[t]} /><path d="M0 0H3V3H0ZM3 3H6V6H3Z" fill={SURFACE} opacity="0.7" /></pattern>
        </React.Fragment>
      ))}
    </defs>
  );
}
const fillOf = (uid: string, tone: Tone, pattern: number) => (pattern ? `url(#${uid}-${tone}-${pattern})` : TONE_VAR[tone]);

// ── Moldura com alternância gráfico/tabela ───────────────────────────────────
/** Moldura de gráfico: título (h2), resumo textual sempre visível e botão que alterna para a tabela de dados equivalente. */
export function ChartFrame({ title, summary, table, children, actions }: { title: string; summary: string; table: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const id = useId();
  return (
    <Card title={title} actions={<div className="flex items-center gap-2">{actions}<Button variant="secondary" size="sm" aria-pressed={view === 'table'} aria-controls={`${id}-body`} onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}>{view === 'chart' ? 'Ver como tabela' : 'Ver gráfico'}</Button></div>}>
      <p className="mb-3 text-sm text-bv-muted">{summary}</p>
      <div id={`${id}-body`}>{view === 'chart' ? children : table}</div>
    </Card>
  );
}

export function Legend({ items }: { items: Array<{ label: string; tone: Tone; dash?: string; marker?: (typeof MARKERS)[number]; pattern?: number; uid?: string }> }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legenda">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <svg width="34" height="14" aria-hidden="true">
            {it.marker !== undefined ? (<><line x1="1" x2="33" y1="7" y2="7" stroke={TONE_VAR[it.tone]} strokeWidth="2.5" strokeDasharray={it.dash} /><Marker kind={it.marker} x={17} y={7} tone={TONE_VAR[it.tone]} size={3.5} /></>)
              : <>{it.uid && <Patterns uid={it.uid} tones={[it.tone]} />}<rect x="1" y="1" width="32" height="12" rx="2" fill={it.uid ? fillOf(it.uid, it.tone, it.pattern ?? 0) : TONE_VAR[it.tone]} stroke={TONE_VAR[it.tone]} strokeWidth="1.5" /></>}
          </svg>
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Gráfico de linhas ────────────────────────────────────────────────────────
export interface LineSeries { name: string; values: Array<number | null> }
export function LineChart({ title, desc, labels, series, yFmt, yMax, height = 260 }: { title: string; desc: string; labels: string[]; series: LineSeries[]; yFmt: (n: number) => string; yMax?: number; height?: number }) {
  const W = 680, H = height, L = 58, R = 14, T = 12, B = 40;
  const n = labels.length;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!n || !all.length) return <EmptyState title="Sem dados no período." />;
  const max = yMax ?? niceMax(Math.max(...all, 0));
  const min = Math.min(...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
  const span = max - min || 1;
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / span);
  const step = Math.max(1, Math.ceil(n / 8));
  const showMarkers = n <= 40;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${desc}`} className="h-auto w-full min-w-[460px]" style={{ maxHeight: H + 60 }}>
          <title>{title}</title><desc>{desc}</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(min + span * t)} y2={y(min + span * t)} stroke={GRID} strokeWidth="1" />
              <text x={L - 6} y={y(min + span * t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{yFmt(min + span * t)}</text>
            </g>
          ))}
          <line x1={L} x2={L} y1={T} y2={H - B} stroke={MUTED} />
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={MUTED} />
          {labels.map((lb, i) => (i % step === 0 ? (
            <text key={i} x={x(i)} y={H - B + 16} textAnchor={i === 0 ? 'start' : 'middle'} fontSize="11" fill={MUTED}>{lb}</text>
          ) : null))}
          {series.map((s, si) => {
            const tone = TONE_VAR[SERIES_TONES[si % 4]];
            const segs: string[] = []; let cur = '';
            s.values.forEach((v, i) => { if (v == null) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
            if (cur) segs.push(cur);
            return (
              <g key={s.name}>
                {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={tone} strokeWidth="2.5" strokeDasharray={DASHES[si % 4]} strokeLinejoin="round" />)}
                {(showMarkers || n === 1) && s.values.map((v, i) => v != null && <Marker key={i} kind={MARKERS[si % 4]} x={x(i)} y={y(v)} tone={tone} size={n > 20 ? 3 : 4.5} />)}
              </g>
            );
          })}
        </svg>
      </div>
      <Legend items={series.map((s, si) => ({ label: s.name, tone: SERIES_TONES[si % 4], dash: DASHES[si % 4], marker: MARKERS[si % 4] }))} />
    </div>
  );
}

// ── Gráfico de barras verticais ──────────────────────────────────────────────
export interface BarItem { label: string; value: number | null; tone?: Tone; pattern?: number }
export function BarChart({ title, desc, items, yFmt, legend, height = 260, yMax }: { title: string; desc: string; items: BarItem[]; yFmt: (n: number) => string; legend?: Array<{ label: string; tone: Tone; pattern?: number }>; height?: number; yMax?: number }) {
  const uid = safeId(useId());
  const W = 680, H = height, L = 58, R = 14, T = 20, B = 42;
  const n = items.length;
  const vals = items.map((i) => i.value ?? 0);
  if (!n || !vals.some((v) => v > 0)) return <EmptyState title="Sem dados no período." />;
  const max = yMax ?? niceMax(Math.max(...vals));
  const slot = (W - L - R) / n, bw = Math.min(46, slot * 0.7);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = Math.max(1, Math.ceil(n / 12));
  const tones = Array.from(new Set(items.map((i) => i.tone ?? 'primary')));
  const showVal = n <= 16;
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${desc}`} className="h-auto w-full min-w-[460px]" style={{ maxHeight: H + 60 }}>
          <title>{title}</title><desc>{desc}</desc>
          <Patterns uid={uid} tones={tones} />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}><line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke={GRID} /><text x={L - 6} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{yFmt(max * t)}</text></g>
          ))}
          <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={MUTED} />
          {items.map((it, i) => {
            const v = it.value ?? 0; const cx = L + slot * i + slot / 2; const tone = it.tone ?? 'primary';
            return (
              <g key={`${it.label}-${i}`}>
                {v > 0 && <rect x={cx - bw / 2} y={y(v)} width={bw} height={H - B - y(v)} fill={fillOf(uid, tone, it.pattern ?? 0)} stroke={TONE_VAR[tone]} strokeWidth="1.5" rx="2"><title>{`${it.label}: ${yFmt(v)}`}</title></rect>}
                {showVal && it.value != null && <text x={cx} y={y(v) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill={TEXT}>{yFmt(v)}</text>}
                {i % step === 0 && <text x={cx} y={H - B + 16} textAnchor="middle" fontSize="11" fill={MUTED}>{it.label.length > 12 ? `${it.label.slice(0, 11)}…` : it.label}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {legend && <Legend items={legend.map((l) => ({ ...l, uid }))} />}
    </div>
  );
}

// ── Barras horizontais (rankings) ────────────────────────────────────────────
export function HBarChart({ title, desc, items, valueFmt }: { title: string; desc: string; items: BarItem[]; valueFmt: (n: number) => string }) {
  const uid = safeId(useId());
  const rowH = 30, L = 150, R = 80, W = 680;
  const H = items.length * rowH + 8;
  const max = Math.max(0, ...items.map((i) => i.value ?? 0));
  if (!items.length || max <= 0) return <EmptyState title="Sem dados no período." />;
  const tones = Array.from(new Set(items.map((i) => i.tone ?? 'primary')));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${desc}`} className="h-auto w-full min-w-[460px]">
        <title>{title}</title><desc>{desc}</desc>
        <Patterns uid={uid} tones={tones} />
        {items.map((it, i) => {
          const v = it.value ?? 0; const w = ((W - L - R) * v) / max; const tone = it.tone ?? 'primary';
          return (
            <g key={`${it.label}-${i}`} transform={`translate(0 ${i * rowH + 4})`}>
              <text x={L - 8} y={rowH / 2 + 3} textAnchor="end" fontSize="12" fill={TEXT}>{it.label.length > 22 ? `${it.label.slice(0, 21)}…` : it.label}<title>{it.label}</title></text>
              <rect x={L} y={4} width={Math.max(w, v > 0 ? 2 : 0)} height={rowH - 10} fill={fillOf(uid, tone, it.pattern ?? 0)} stroke={TONE_VAR[tone]} strokeWidth="1.5" rx="2" />
              <text x={L + w + 6} y={rowH / 2 + 3} fontSize="12" fontWeight="600" fill={TEXT}>{it.value == null ? '—' : valueFmt(v)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
