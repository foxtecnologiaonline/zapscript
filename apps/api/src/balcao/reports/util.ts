import { Prisma } from '@prisma/client';

/**
 * Utilitários da frente reports: fuso horário, períodos, CSV seguro e estatística pura.
 * Tudo aqui é puro (sem I/O) para ser testado com valores conhecidos.
 */

export const DEFAULT_TZ = 'America/Araguaina';

/** Valida o fuso (IANA). Fuso inválido cai no padrão do Tocantins em vez de quebrar a consulta SQL. */
export function validTz(tz?: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_TZ; }
}

/** Fragmento SQL para comparar coluna `timestamp` (UTC) com um instante — evita depender do fuso da sessão. */
export const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface LocalDate { y: number; m: number; d: number; h: number; mi: number; dow: number }

/** Componentes da data/hora local do instante no fuso. dow: 0=domingo. */
export function localParts(at: Date, tz: string): LocalDate {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[p.weekday] ?? 0;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), dow };
}

function offsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instante UTC em que o relógio do fuso marca y-m-d h:mi. Aceita overflow de mês/dia (como Date.UTC). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** Início (00:00 local) do dia local de `at`, deslocado em `plusDays` dias. */
export function startOfLocalDay(at: Date, tz: string, plusDays = 0): Date {
  const l = localParts(at, tz);
  return zonedToUtc(l.y, l.m, l.d + plusDays, 0, 0, tz);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymd = (l: { y: number; m: number; d: number }) => `${l.y}-${pad2(l.m)}-${pad2(l.d)}`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Soma meses a uma data local preservando o dia (limitado ao último dia do mês de destino). */
export function addMonthsLocal(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

export class PeriodError extends Error {}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** 'YYYY-MM-DD' = dia local; 'YYYY-MM-DDTHH:mm' sem fuso = hora local; ISO com Z/offset = absoluto. */
function parseBoundary(s: string, tz: string, endInclusiveDay: boolean): Date {
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return zonedToUtc(y, m, d + (endInclusiveDay ? 1 : 0), 0, 0, tz);
  }
  if (LOCAL_DT.test(s)) {
    const [dp, tp] = s.split('T'); const [y, m, d] = dp.split('-').map(Number); const [hh, mm] = tp.split(':').map(Number);
    return zonedToUtc(y, m, d, hh, mm, tz);
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) throw new PeriodError(`Data inválida: ${s}`);
  return t;
}

export interface Period { from: Date; to: Date; timezone: string }

export const MAX_RANGE_DAYS = 800;

/** Resolve from/to (to EXCLUSIVO). Padrão: últimos 30 dias até agora. Data simples em `to` inclui o dia inteiro. */
export function resolvePeriod(q: { from?: string; to?: string }, tz: string, now = new Date()): Period {
  const to = q.to ? parseBoundary(q.to, tz, true) : now;
  const from = q.from ? parseBoundary(q.from, tz, false) : new Date(to.getTime() - 30 * 86400_000);
  if (from >= to) throw new PeriodError('Período inválido: "from" deve ser anterior a "to"');
  if ((to.getTime() - from.getTime()) / 86400_000 > MAX_RANGE_DAYS) throw new PeriodError(`Período máximo de ${MAX_RANGE_DAYS} dias`);
  return { from, to, timezone: tz };
}

export const PRESETS = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'MONTH_TO_DATE', 'PREVIOUS_WEEK', 'PREVIOUS_MONTH'] as const;
export type Preset = (typeof PRESETS)[number];

/** Períodos relativos (agendamentos). Dias completos no fuso do órgão. */
export function presetPeriod(preset: Preset, tz: string, now = new Date()): Period {
  const today = startOfLocalDay(now, tz);
  const l = localParts(now, tz);
  switch (preset) {
    case 'TODAY': return { from: today, to: startOfLocalDay(now, tz, 1), timezone: tz };
    case 'YESTERDAY': return { from: startOfLocalDay(now, tz, -1), to: today, timezone: tz };
    case 'LAST_7_DAYS': return { from: startOfLocalDay(now, tz, -7), to: today, timezone: tz };
    case 'LAST_30_DAYS': return { from: startOfLocalDay(now, tz, -30), to: today, timezone: tz };
    case 'MONTH_TO_DATE': return { from: zonedToUtc(l.y, l.m, 1, 0, 0, tz), to: now, timezone: tz };
    case 'PREVIOUS_WEEK': {
      const mondayOffset = (l.dow + 6) % 7; // dias desde a segunda desta semana
      return { from: startOfLocalDay(now, tz, -mondayOffset - 7), to: startOfLocalDay(now, tz, -mondayOffset), timezone: tz };
    }
    case 'PREVIOUS_MONTH': return { from: zonedToUtc(l.y, l.m - 1, 1, 0, 0, tz), to: zonedToUtc(l.y, l.m, 1, 0, 0, tz), timezone: tz };
  }
}

/** Mesmo comprimento, imediatamente antes. */
export const previousPeriod = (p: Period): Period => ({ from: new Date(p.from.getTime() - (p.to.getTime() - p.from.getTime())), to: p.from, timezone: p.timezone });

export function describePeriod(p: Period) {
  const fl = localParts(p.from, p.timezone);
  const tl = localParts(new Date(p.to.getTime() - 1), p.timezone);
  return { from: p.from.toISOString(), to: p.to.toISOString(), fromLocal: ymd(fl), toLocal: ymd(tl), timezone: p.timezone };
}

// ── Agendamento ──────────────────────────────────────────────────────────────
export interface ScheduleSpec { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; hour?: number; weekday?: number; dayOfMonth?: number }

/** Próxima execução estritamente depois de `after`, no horário local do órgão. */
export function nextRunAfter(spec: ScheduleSpec, after: Date, tz: string): Date {
  const hour = spec.hour ?? 6;
  const l = localParts(after, tz);
  if (spec.frequency === 'DAILY') {
    for (let i = 0; i < 3; i++) { const c = zonedToUtc(l.y, l.m, l.d + i, hour, 0, tz); if (c > after) return c; }
  } else if (spec.frequency === 'WEEKLY') {
    const wd = spec.weekday ?? 1;
    for (let i = 0; i < 9; i++) {
      const c = zonedToUtc(l.y, l.m, l.d + i, hour, 0, tz);
      if (c > after && localParts(c, tz).dow === wd) return c;
    }
  } else {
    const dom = Math.min(spec.dayOfMonth ?? 1, 28);
    for (let i = 0; i < 3; i++) { const c = zonedToUtc(l.y, l.m + i, dom, hour, 0, tz); if (c > after) return c; }
  }
  return new Date(after.getTime() + 86400_000);
}

// ── Estatística pura ─────────────────────────────────────────────────────────
/** Percentil com interpolação linear (equivale a percentile_cont do Postgres). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
export const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
export const round = (n: number | null | undefined, d = 1): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** NPS = %promotores (9–10) − %detratores (0–6). Retorna null sem respostas. */
export function npsFromScores(scores: number[]): { responses: number; promoters: number; passives: number; detractors: number; nps: number | null } {
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const n = scores.length;
  return { responses: n, promoters, passives: n - promoters - detractors, detractors, nps: n ? round(((promoters - detractors) / n) * 100, 1) : null };
}

// ── Projeção linear (painel do fiscal) ───────────────────────────────────────
/** Mínimos quadrados simples y = a + b·x. Retorna null com < 2 pontos. */
export function linearFit(points: Array<[number, number]>): { a: number; b: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const sx = points.reduce((s, p) => s + p[0], 0), sy = points.reduce((s, p) => s + p[1], 0);
  const sxx = points.reduce((s, p) => s + p[0] * p[0], 0), sxy = points.reduce((s, p) => s + p[0] * p[1], 0);
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const b = (n * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / n, b };
}

/**
 * Projeta o valor do fim do mês. `daily[i]` = consumo do dia i+1 (zeros preenchidos até o dia corrente).
 * Contador: regressão linear sobre o ACUMULADO (dia → acumulado); gauge: regressão sobre o valor diário.
 * Nunca projeta abaixo do que já foi consumido.
 */
export function projectMonthEnd(daily: number[], daysInMonthN: number, gauge = false): { projected: number; method: 'linear' | 'proportional' | 'none'; slopePerDay: number } {
  const elapsed = daily.length;
  if (!elapsed) return { projected: 0, method: 'none', slopePerDay: 0 };
  if (gauge) {
    const current = daily[elapsed - 1];
    const fit = linearFit(daily.map((v, i) => [i + 1, v] as [number, number]));
    if (!fit) return { projected: current, method: 'none', slopePerDay: 0 };
    return { projected: Math.max(current, Math.round(fit.a + fit.b * daysInMonthN)), method: 'linear', slopePerDay: fit.b };
  }
  let acc = 0;
  const cum = daily.map((v) => (acc += v));
  const current = cum[elapsed - 1];
  const fit = linearFit(cum.map((v, i) => [i + 1, v] as [number, number]));
  if (!fit) return { projected: Math.round((current / elapsed) * daysInMonthN), method: 'proportional', slopePerDay: current / elapsed };
  return { projected: Math.max(current, Math.round(fit.a + fit.b * daysInMonthN)), method: 'linear', slopePerDay: fit.b };
}

// ── CSV seguro (UTF-8 com BOM, separador ';') ────────────────────────────────
export interface CsvColumn { key: string; label: string }

/** Neutraliza injeção de fórmula: texto iniciado por = + - @ TAB CR vira texto literal (prefixo apóstrofo). */
export function csvCell(v: unknown, decimalComma = true): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? (decimalComma ? String(v).replace('.', ',') : String(v)) : '';
  else if (typeof v === 'bigint') s = v.toString();
  else if (typeof v === 'boolean') s = v ? 'sim' : 'não';
  else if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (typeof v === 'string' || typeof v === 'object') { if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; }
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>, opts: { decimalComma?: boolean; bom?: boolean; header?: 'label' | 'key' } = {}): string {
  const dc = opts.decimalComma ?? true;
  const head = columns.map((c) => csvCell(opts.header === 'key' ? c.key : c.label, dc)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key], dc)).join(';'));
  return (opts.bom === false ? '' : '﻿') + [head, ...body].join('\r\n') + '\r\n';
}

/** Achata objeto aninhado em colunas "a.b" para CSV de respostas hierárquicas. */
export function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
}
