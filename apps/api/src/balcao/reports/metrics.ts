import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  addMonthsLocal, localParts, npsFromScores, round, ts, validTz, zonedToUtc, ymd,
  type Period,
} from './util';

/**
 * Motor de métricas do Balcão Virtual (conversas). Cada métrica é uma expressão SQL AGREGADA sobre
 * "BvConversation" (alias `c`) de uma allowlist fixa — nenhum texto do cliente vira SQL.
 *
 * COORTE: todas as métricas consideram as conversas INICIADAS (`startedAt`) em [from, to). Assim os
 * indicadores de um período são consistentes entre si (NPS/TMA/FCR de uma conversa contam no período em
 * que ela começou) e usam o índice (orgId, startedAt).
 *
 * Atendente = `assignedUserId` ATUAL da conversa (quem a encerrou/está com ela; transferências anteriores
 * não são atribuídas a quem transferiu).
 */

export interface Filters {
  orgId: string;
  period: Period;
  channel?: string[];
  queueId?: string[];
  agentId?: string[];
  category?: string[];
  closeReason?: string[];
  status?: string[];
}

export type MetricUnit = 'count' | 'seconds' | 'percent' | 'score';
export interface MetricDef {
  key: string; label: string; unit: MetricUnit; description: string; sql: string;
  /** Métrica calculada em JS a partir de outras (não existe como expressão SQL). Hoje só `iqaRate` (fórmula única do IQA). */
  derived?: boolean;
}

// ── Expressões base (segundos) ───────────────────────────────────────────────
const TME = `EXTRACT(EPOCH FROM (c."firstResponseAt" - c."startedAt"))::float8`;
const TME_OK = `c."firstResponseAt" IS NOT NULL AND c."firstResponseAt" >= c."startedAt"`;
const WAIT = `EXTRACT(EPOCH FROM (c."assignedAt" - c."queuedAt"))::float8`;
const WAIT_OK = `c."queuedAt" IS NOT NULL AND c."assignedAt" IS NOT NULL AND c."assignedAt" >= c."queuedAt"`;
const TMA = `EXTRACT(EPOCH FROM (c."closedAt" - c."assignedAt"))::float8`;
const TMA_OK = `c."status" = 'CLOSED' AND c."closedAt" IS NOT NULL AND c."assignedAt" IS NOT NULL AND c."closedAt" >= c."assignedAt"`;
const TMR = `EXTRACT(EPOCH FROM (c."closedAt" - c."startedAt"))::float8`;
const TMR_OK = `c."status" = 'CLOSED' AND c."closedAt" IS NOT NULL AND c."closedAt" >= c."startedAt"`;

const BOT_VIA = `(c."botHandled" OR c."resolvedByBot")`;
const IQA_NUM = `(${BOT_VIA} AND c."resolvedByBot" AND c."firstContactResolved" IS TRUE AND c."automatable")`;

// SLA: base = conversas com prazo definido que já têm desfecho (respondida/encerrada) ou cujo prazo já passou.
const NOW_TS = `(now() AT TIME ZONE 'UTC')`;
const FR_BASE = `c."slaFirstResponseDueAt" IS NOT NULL AND (c."firstResponseAt" IS NOT NULL OR c."slaFirstResponseDueAt" < ${NOW_TS})`;
const FR_MET = `c."firstResponseAt" IS NOT NULL AND c."firstResponseAt" <= c."slaFirstResponseDueAt"`;
const RES_BASE = `c."slaResolutionDueAt" IS NOT NULL AND (c."closedAt" IS NOT NULL OR c."slaResolutionDueAt" < ${NOW_TS})`;
const RES_MET = `c."closedAt" IS NOT NULL AND c."closedAt" <= c."slaResolutionDueAt"`;
const SLA_BASE = `((${FR_BASE}) OR (${RES_BASE}))`;
const SLA_VIOL = `(((${FR_BASE}) AND NOT (${FR_MET})) OR ((${RES_BASE}) AND NOT (${RES_MET})) OR c."slaBreached")`;

const pct = (num: string, den: string, d = 2) => `ROUND((100.0 * COUNT(*) FILTER (WHERE ${num}) / NULLIF(COUNT(*) FILTER (WHERE ${den}), 0))::numeric, ${d})::float8`;
const stat = (expr: string, ok: string, kind: 'avg' | 'p50' | 'p90' | 'max' | 'n') => {
  switch (kind) {
    case 'avg': return `ROUND((AVG(${expr}) FILTER (WHERE ${ok}))::numeric, 1)::float8`;
    case 'p50': return `ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${ok}))::numeric, 1)::float8`;
    case 'p90': return `ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${ok}))::numeric, 1)::float8`;
    case 'max': return `ROUND((MAX(${expr}) FILTER (WHERE ${ok}))::numeric, 1)::float8`;
    case 'n': return `(COUNT(*) FILTER (WHERE ${ok}))::int`;
  }
};
const cnt = (cond: string) => `(COUNT(*) FILTER (WHERE ${cond}))::int`;

function timing(prefix: string, name: string, expr: string, ok: string, startDesc: string): MetricDef[] {
  const base = `${name} (${startDesc})`;
  return [
    { key: `${prefix}Avg`, label: `${name} médio (s)`, unit: 'seconds', description: `Média de ${base}`, sql: stat(expr, ok, 'avg') },
    { key: `${prefix}P50`, label: `${name} mediana P50 (s)`, unit: 'seconds', description: `Percentil 50 de ${base}`, sql: stat(expr, ok, 'p50') },
    { key: `${prefix}P90`, label: `${name} P90 (s)`, unit: 'seconds', description: `Percentil 90 de ${base}`, sql: stat(expr, ok, 'p90') },
    { key: `${prefix}Max`, label: `${name} máximo (s)`, unit: 'seconds', description: `Máximo de ${base}`, sql: stat(expr, ok, 'max') },
    { key: `${prefix}Count`, label: `${name} — amostras`, unit: 'count', description: `Conversas com ${name} mensurável`, sql: stat(expr, ok, 'n') },
  ];
}

const CATALOG: MetricDef[] = [
  { key: 'total', label: 'Atendimentos iniciados', unit: 'count', description: 'Conversas iniciadas no período', sql: `COUNT(*)::int` },
  { key: 'closed', label: 'Encerrados', unit: 'count', description: 'Conversas com status CLOSED', sql: cnt(`c."status" = 'CLOSED'`) },
  { key: 'open', label: 'Em andamento', unit: 'count', description: 'Conversas ainda não encerradas', sql: cnt(`c."status" <> 'CLOSED'`) },
  { key: 'abandoned', label: 'Abandonados', unit: 'count', description: 'Encerradas com motivo ABANDONED', sql: cnt(`c."closeReason" = 'ABANDONED'`) },
  { key: 'abandonRate', label: 'Taxa de abandono (%)', unit: 'percent', description: 'ABANDONED ÷ encerradas (exceto SPAM)', sql: pct(`c."closeReason" = 'ABANDONED'`, `c."status" = 'CLOSED' AND COALESCE(c."closeReason",'') <> 'SPAM'`) },
  ...timing('tme', 'TME', TME, TME_OK, '1ª resposta humana − início'),
  ...timing('queueWait', 'Espera em fila', WAIT, WAIT_OK, 'atribuição − entrada na fila'),
  ...timing('tma', 'TMA', TMA, TMA_OK, 'encerramento − atribuição'),
  ...timing('tmr', 'TMR', TMR, TMR_OK, 'encerramento − início'),
  { key: 'botInvolved', label: 'Atendimentos via chatbot', unit: 'count', description: 'botHandled OU resolvedByBot', sql: cnt(BOT_VIA) },
  { key: 'botResolved', label: 'Resolvidos pelo bot', unit: 'count', description: 'resolvedByBot = true', sql: cnt(`c."resolvedByBot"`) },
  { key: 'botContainmentRate', label: 'Contenção do bot (%)', unit: 'percent', description: 'resolvedByBot ÷ atendimentos via chatbot', sql: pct(`c."resolvedByBot"`, BOT_VIA) },
  { key: 'fcrCount', label: 'Resolvidos no 1º contato', unit: 'count', description: 'firstContactResolved = true', sql: cnt(`c."firstContactResolved" IS TRUE`) },
  { key: 'fcrRate', label: 'FCR (%)', unit: 'percent', description: 'firstContactResolved ÷ encerradas com motivo RESOLVED', sql: pct(`c."firstContactResolved" IS TRUE`, `c."status" = 'CLOSED' AND c."closeReason" = 'RESOLVED'`) },
  { key: 'transferred', label: 'Com transferência', unit: 'count', description: 'transferCount > 0', sql: cnt(`c."transferCount" > 0`) },
  { key: 'slaBase', label: 'SLA — base', unit: 'count', description: 'Conversas com prazo de SLA já apurável', sql: cnt(SLA_BASE) },
  { key: 'slaViolations', label: 'SLA — violações', unit: 'count', description: 'Conversas que estouraram algum prazo (ou slaBreached)', sql: cnt(`(${SLA_BASE}) AND (${SLA_VIOL})`) },
  { key: 'slaRate', label: 'SLA cumprido (%)', unit: 'percent', description: '100 − violações ÷ base', sql: `ROUND((100.0 - 100.0 * COUNT(*) FILTER (WHERE (${SLA_BASE}) AND (${SLA_VIOL})) / NULLIF(COUNT(*) FILTER (WHERE ${SLA_BASE}), 0))::numeric, 2)::float8` },
  { key: 'slaFirstResponseRate', label: 'SLA 1ª resposta (%)', unit: 'percent', description: '1ª resposta dentro do prazo ÷ conversas com prazo apurável', sql: pct(FR_MET, FR_BASE) },
  { key: 'slaResolutionRate', label: 'SLA resolução (%)', unit: 'percent', description: 'Encerradas dentro do prazo ÷ conversas com prazo apurável', sql: pct(RES_MET, RES_BASE) },
  { key: 'npsResponses', label: 'Respostas de NPS', unit: 'count', description: 'Conversas com nota 0–10', sql: cnt(`c."csatScore" IS NOT NULL`) },
  { key: 'npsPromoters', label: 'Promotores (9–10)', unit: 'count', description: 'Notas 9 e 10', sql: cnt(`c."csatScore" >= 9`) },
  { key: 'npsPassives', label: 'Neutros (7–8)', unit: 'count', description: 'Notas 7 e 8', sql: cnt(`c."csatScore" BETWEEN 7 AND 8`) },
  { key: 'npsDetractors', label: 'Detratores (0–6)', unit: 'count', description: 'Notas 0 a 6', sql: cnt(`c."csatScore" <= 6`) },
  { key: 'nps', label: 'NPS', unit: 'score', description: '%promotores − %detratores (−100 a 100)', sql: `ROUND((100.0 * (COUNT(*) FILTER (WHERE c."csatScore" >= 9) - COUNT(*) FILTER (WHERE c."csatScore" <= 6)) / NULLIF(COUNT(*) FILTER (WHERE c."csatScore" IS NOT NULL), 0))::numeric, 1)::float8` },
  { key: 'csatAvg', label: 'Nota média (0–10)', unit: 'score', description: 'Média das notas de satisfação', sql: `ROUND((AVG(c."csatScore") FILTER (WHERE c."csatScore" IS NOT NULL))::numeric, 2)::float8` },
  { key: 'iqaCount', label: 'IQA — numerador', unit: 'count', description: 'Via chatbot ∧ resolvido pelo bot ∧ 1º contato ∧ automatizável', sql: cnt(IQA_NUM) },
  { key: 'automatable', label: 'Classificadas automatizáveis', unit: 'count', description: 'automatable = true', sql: cnt(`c."automatable"`) },
  { key: 'iqaAutomatableBase', label: 'IQA — base automatizável', unit: 'count', description: 'Via chatbot ∧ automatizável (denominador quando settings.iqa.denominator = AUTOMATABLE)', sql: cnt(`${BOT_VIA} AND c."automatable"`) },
  // Fórmula ÚNICA do IQA: computeIqa() (abaixo). Não existe expressão SQL de razão — aggregate() busca as contagens e calcula em JS.
  { key: 'iqaRate', label: 'IQA (%)', unit: 'percent', description: 'IQA conforme settings.iqa.denominator (padrão: numerador ÷ atendimentos via chatbot)', sql: 'NULL', derived: true },
];

/** Contagens de que a fórmula do IQA precisa (todas SQL). */
const IQA_DEPS = ['iqaCount', 'botInvolved', 'iqaAutomatableBase'] as const;

export const METRICS: Readonly<Record<string, MetricDef>> = Object.freeze(Object.fromEntries(CATALOG.map((m) => [m.key, m])));
export const METRIC_KEYS = CATALOG.map((m) => m.key) as [string, ...string[]];

// ── Dimensões (agrupamento) ──────────────────────────────────────────────────
const LOCAL = (tz: Prisma.Sql) => Prisma.sql`((c."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;
export interface DimDef { key: string; label: string; time?: boolean; sql: (tz: Prisma.Sql) => Prisma.Sql }
const DIMS: DimDef[] = [
  { key: 'channel', label: 'Canal', sql: () => Prisma.sql`c."channel"` },
  { key: 'queue', label: 'Fila', sql: () => Prisma.sql`c."queueId"` },
  { key: 'agent', label: 'Atendente', sql: () => Prisma.sql`c."assignedUserId"` },
  { key: 'category', label: 'Categoria', sql: () => Prisma.sql`c."category"` },
  { key: 'closeReason', label: 'Motivo de encerramento', sql: () => Prisma.sql`c."closeReason"` },
  { key: 'status', label: 'Status', sql: () => Prisma.sql`c."status"` },
  { key: 'datetime', label: 'Hora', time: true, sql: (tz) => Prisma.sql`to_char(date_trunc('hour', ${LOCAL(tz)}), 'YYYY-MM-DD HH24:00')` },
  { key: 'day', label: 'Dia', time: true, sql: (tz) => Prisma.sql`to_char(date_trunc('day', ${LOCAL(tz)}), 'YYYY-MM-DD')` },
  { key: 'week', label: 'Semana (início na segunda)', time: true, sql: (tz) => Prisma.sql`to_char(date_trunc('week', ${LOCAL(tz)}), 'YYYY-MM-DD')` },
  { key: 'month', label: 'Mês', time: true, sql: (tz) => Prisma.sql`to_char(date_trunc('month', ${LOCAL(tz)}), 'YYYY-MM')` },
  { key: 'hourOfDay', label: 'Hora do dia (0–23)', time: true, sql: (tz) => Prisma.sql`EXTRACT(HOUR FROM ${LOCAL(tz)})::int` },
  { key: 'weekday', label: 'Dia da semana (0=domingo)', time: true, sql: (tz) => Prisma.sql`EXTRACT(DOW FROM ${LOCAL(tz)})::int` },
];
export const DIMENSIONS: Readonly<Record<string, DimDef>> = Object.freeze(Object.fromEntries(DIMS.map((d) => [d.key, d])));
export const DIM_KEYS = DIMS.map((d) => d.key) as [string, ...string[]];

/** Cláusula WHERE comum (sempre orgId + período). */
export function whereConv(f: Filters): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`c."orgId" = ${f.orgId}`,
    Prisma.sql`c."startedAt" >= ${ts(f.period.from)}`,
    Prisma.sql`c."startedAt" < ${ts(f.period.to)}`,
  ];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) parts.push(Prisma.sql`${Prisma.raw(col)} IN (${Prisma.join(vals)})`); };
  inList('c."channel"', f.channel); inList('c."queueId"', f.queueId); inList('c."assignedUserId"', f.agentId);
  inList('c."category"', f.category); inList('c."closeReason"', f.closeReason); inList('c."status"', f.status);
  return Prisma.join(parts, ' AND ');
}

export interface AggregateOptions { orderBy?: { key: string; dir: 'asc' | 'desc' }; limit?: number }
export type Row = Record<string, any>;

/**
 * Consulta agregada genérica: `dims` (allowlist) × `metrics` (allowlist). Uma única passada SQL.
 * Lança Error('métrica/dimensão desconhecida') se a chave não estiver no catálogo.
 */
export async function aggregate(f: Filters, dims: string[], metrics: string[], opts: AggregateOptions = {}): Promise<Row[]> {
  const tz = Prisma.sql`${validTz(f.period.timezone)}`;
  const dimDefs = dims.map((k) => { const d = DIMENSIONS[k]; if (!d) throw new Error(`dimensão desconhecida: ${k}`); return d; });
  for (const k of metrics) if (!METRICS[k]) throw new Error(`métrica desconhecida: ${k}`);
  const wantsIqa = metrics.includes('iqaRate');
  // `iqaRate` não é SQL: pede-se as contagens e computeIqa() resolve (mesma fórmula do /ai/stats e do /reports/iqa).
  const sqlKeys = [...new Set([...metrics.filter((k) => !METRICS[k].derived), ...(wantsIqa ? IQA_DEPS : [])])];
  const selects: Prisma.Sql[] = [
    ...dimDefs.map((d) => Prisma.sql`${d.sql(tz)} AS ${Prisma.raw(`"${d.key}"`)}`),
    ...sqlKeys.map((k) => Prisma.sql`${Prisma.raw(METRICS[k].sql)} AS ${Prisma.raw(`"${k}"`)}`),
  ];
  const group = dimDefs.length ? Prisma.sql`GROUP BY ${Prisma.join(dimDefs.map((_, i) => Prisma.raw(String(i + 1))))}` : Prisma.empty;
  let order = Prisma.empty;
  const ob = opts.orderBy && [...dims, ...metrics].includes(opts.orderBy.key) ? opts.orderBy : null;
  const sortInJs = !!ob && !!METRICS[ob.key]?.derived;
  if (dimDefs.length) {
    if (ob && !sortInJs) order = Prisma.sql`ORDER BY ${Prisma.raw(`"${ob.key}"`)} ${Prisma.raw(ob.dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`;
    else if (!ob && dimDefs.every((d) => d.time)) order = Prisma.sql`ORDER BY ${Prisma.join(dimDefs.map((_, i) => Prisma.raw(String(i + 1))))}`;
    else order = Prisma.sql`ORDER BY ${Prisma.raw('COUNT(*) DESC')}`;
  }
  const limit = dimDefs.length ? Prisma.sql`LIMIT ${Math.min(Math.max(opts.limit ?? 5000, 1), 10000)}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${Prisma.join(selects)} FROM "BvConversation" c WHERE ${whereConv(f)} ${group} ${order} ${limit}`);
  if (wantsIqa) {
    const { denominator } = await getIqaConfig(f.orgId);
    for (const r of rows) {
      r.iqaRate = computeIqa({ numerator: r.iqaCount, botInvolved: r.botInvolved, automatableBase: r.iqaAutomatableBase }, denominator).value;
      for (const k of IQA_DEPS) if (!metrics.includes(k)) delete r[k];
    }
    if (sortInJs && ob) rows.sort((a, b) => ((a[ob.key] ?? -Infinity) - (b[ob.key] ?? -Infinity)) * (ob.dir === 'asc' ? 1 : -1));
  }
  return decorate(f.orgId, dims, rows);
}

/** Acrescenta nomes legíveis de fila/atendente (consulta separada, sempre filtrada por orgId). */
async function decorate(orgId: string, dims: string[], rows: Row[]): Promise<Row[]> {
  if (dims.includes('queue')) {
    const ids = [...new Set(rows.map((r) => r.queue).filter(Boolean))] as string[];
    const qs = ids.length ? await prisma.bvQueue.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    const m = new Map(qs.map((q) => [q.id, q.name]));
    for (const r of rows) r.queueName = r.queue ? m.get(r.queue) ?? null : null;
  }
  if (dims.includes('agent')) {
    const ids = [...new Set(rows.map((r) => r.agent).filter(Boolean))] as string[];
    const us = ids.length ? await prisma.bvUser.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    const m = new Map(us.map((u) => [u.id, u.name]));
    for (const r of rows) r.agentName = r.agent ? m.get(r.agent) ?? null : null;
  }
  return rows;
}

export const OVERVIEW_METRICS = [
  'total', 'closed', 'open', 'abandoned', 'abandonRate', 'tmeAvg', 'tmeP50', 'tmeP90', 'tmeCount', 'queueWaitAvg', 'queueWaitP90',
  'tmaAvg', 'tmaP50', 'tmaP90', 'tmrAvg', 'tmrP50', 'tmrP90', 'botInvolved', 'botResolved', 'botContainmentRate', 'fcrCount', 'fcrRate',
  'transferred', 'slaBase', 'slaViolations', 'slaRate', 'slaFirstResponseRate', 'slaResolutionRate',
  'npsResponses', 'npsPromoters', 'npsPassives', 'npsDetractors', 'nps', 'csatAvg', 'iqaCount', 'automatable', 'iqaRate',
];

export async function overviewKpis(f: Filters): Promise<Row> {
  return (await aggregate(f, [], OVERVIEW_METRICS))[0] ?? {};
}

/** Variação absoluta e percentual entre dois conjuntos de KPIs numéricos. */
export function compareKpis(cur: Row, prev: Row): Record<string, { current: number | null; previous: number | null; delta: number | null; deltaPct: number | null }> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(cur)) {
    const c = typeof cur[k] === 'number' ? cur[k] : null, p = typeof prev[k] === 'number' ? prev[k] : null;
    out[k] = { current: c, previous: p, delta: c != null && p != null ? round(c - p, 2) : null, deltaPct: c != null && p ? round(((c - p) / Math.abs(p)) * 100, 1) : null };
  }
  return out;
}

export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const GRAN_DIM: Record<Granularity, string> = { hour: 'datetime', day: 'day', week: 'week', month: 'month' };

export const TIMESERIES_METRICS = ['total', 'closed', 'abandoned', 'botResolved', 'tmeAvg', 'tmaAvg', 'tmrAvg', 'slaRate', 'nps', 'npsResponses', 'fcrRate'];

/** Volume por dia × hora do dia (mapa de calor), no fuso do órgão. */
export async function heatmap(f: Filters): Promise<Row[]> {
  return aggregate(f, ['weekday', 'hourOfDay'], ['total'], { limit: 200 });
}

// ── NPS detalhado ────────────────────────────────────────────────────────────
export async function npsDistribution(f: Filters): Promise<Array<{ score: number; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ score: number; n: number }>>(Prisma.sql`
    SELECT c."csatScore" AS score, COUNT(*)::int AS n FROM "BvConversation" c
    WHERE ${whereConv(f)} AND c."csatScore" IS NOT NULL GROUP BY 1`);
  const m = new Map(rows.map((r) => [r.score, r.n]));
  return Array.from({ length: 11 }, (_, s) => ({ score: s, count: m.get(s) ?? 0 }));
}

export function npsSummary(dist: Array<{ score: number; count: number }>) {
  const scores: number[] = [];
  for (const d of dist) for (let i = 0; i < d.count; i++) scores.push(d.score);
  return npsFromScores(scores);
}

// ── SLA: violações recentes ──────────────────────────────────────────────────
export async function slaViolationList(f: Filters, limit = 50): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT c."id", c."protocol", c."channel", c."queueId" AS "queue", c."assignedUserId" AS "agent", c."startedAt",
      c."slaFirstResponseDueAt", c."firstResponseAt", c."slaResolutionDueAt", c."closedAt",
      CASE WHEN (${Prisma.raw(FR_BASE)}) AND NOT (${Prisma.raw(FR_MET)}) THEN 'FIRST_RESPONSE'
           WHEN (${Prisma.raw(RES_BASE)}) AND NOT (${Prisma.raw(RES_MET)}) THEN 'RESOLUTION' ELSE 'FLAGGED' END AS "kind"
    FROM "BvConversation" c
    WHERE ${whereConv(f)} AND (${Prisma.raw(SLA_BASE)}) AND (${Prisma.raw(SLA_VIOL)})
    ORDER BY c."startedAt" DESC LIMIT ${Math.min(limit, 500)}`);
}

// ── Produtividade: simultaneidade ────────────────────────────────────────────
export interface Concurrency { agent: string; peak: number; avg: number | null; busySeconds: number }

/**
 * Conversas simultâneas por atendente (varredura de eventos +1/−1 sobre [assignedAt, closedAt|agora]).
 * `avg` = média ponderada pelo tempo ENQUANTO o atendente tem ao menos uma conversa; `busySeconds` = tempo
 * com ≥ 1 conversa (aproximação do "tempo em atendimento"; não há histórico de presença no banco).
 */
export async function agentConcurrency(f: Filters): Promise<Concurrency[]> {
  const rows = await prisma.$queryRaw<Array<{ uid: string; peak: number; avg: number | null; busy: number | null }>>(Prisma.sql`
    WITH iv AS (
      SELECT c."assignedUserId" AS uid, c."assignedAt" AS s,
             GREATEST(c."assignedAt", COALESCE(c."closedAt", LEAST(${NOW_TS_SQL}, ${ts(f.period.to)}))) AS e
      FROM "BvConversation" c
      WHERE ${whereConv(f)} AND c."assignedUserId" IS NOT NULL AND c."assignedAt" IS NOT NULL
    ), ev AS (
      SELECT uid, s AS t, 1 AS d FROM iv UNION ALL SELECT uid, e AS t, -1 AS d FROM iv
    ), run AS (
      SELECT uid, t, d, SUM(d) OVER (PARTITION BY uid ORDER BY t, d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS n FROM ev
    ), seg AS (
      SELECT uid, n, EXTRACT(EPOCH FROM (LEAD(t) OVER (PARTITION BY uid ORDER BY t, d) - t)) AS dur FROM run
    )
    SELECT uid, MAX(n)::int AS peak,
      (SUM(n * dur) FILTER (WHERE dur IS NOT NULL AND n > 0) / NULLIF(SUM(dur) FILTER (WHERE dur IS NOT NULL AND n > 0), 0))::float8 AS avg,
      (SUM(dur) FILTER (WHERE dur IS NOT NULL AND n > 0))::float8 AS busy
    FROM seg GROUP BY uid`);
  return rows.map((r) => ({ agent: r.uid, peak: r.peak, avg: round(r.avg, 2), busySeconds: Math.round(r.busy ?? 0) }));
}
const NOW_TS_SQL = Prisma.raw(NOW_TS);

export const AGENT_METRICS = ['total', 'closed', 'abandoned', 'tmeAvg', 'tmeP50', 'tmeP90', 'tmaAvg', 'tmaP50', 'tmaP90', 'tmrAvg', 'slaRate', 'slaViolations', 'fcrRate', 'transferred', 'npsResponses', 'nps', 'csatAvg'];

export async function agentsReport(f: Filters) {
  const [rows, conc, users] = await Promise.all([
    aggregate(f, ['agent'], AGENT_METRICS),
    agentConcurrency(f),
    prisma.bvUser.findMany({ where: { orgId: f.orgId, role: { in: ['ATENDENTE', 'SUPERVISOR'] } }, select: { id: true, presence: true, presenceAt: true, maxConcurrent: true } }),
  ]);
  const cm = new Map(conc.map((c) => [c.agent, c]));
  const um = new Map(users.map((u) => [u.id, u]));
  return rows.filter((r) => r.agent).map((r) => {
    const c = cm.get(r.agent), u = um.get(r.agent);
    return {
      ...r,
      simultaneousAvg: c?.avg ?? null, simultaneousPeak: c?.peak ?? 0, busySeconds: c?.busySeconds ?? 0,
      maxConcurrent: u?.maxConcurrent ?? null, presence: u?.presence ?? null, presenceAt: u?.presenceAt ?? null,
    };
  });
}

// ── IQA (indicador 07) ───────────────────────────────────────────────────────
/**
 * DEFINIÇÃO ÚNICA (TR 18.1, indicador 07): "percentual de atendimentos via chatbot resolvidos no primeiro contato e
 * classificados como automatizáveis".
 *   numerador   = atendimentos via chatbot (botHandled ∨ resolvedByBot) com resolvedByBot ∧ firstContactResolved ∧ automatable
 *   denominador = `settings.iqa.denominator`:
 *       'ALL_BOT'      (padrão) todos os atendimentos via chatbot do período (leitura literal do edital);
 *       'AUTOMATABLE'  só os via chatbot classificados como automatizáveis.
 * `computeIqa` é a ÚNICA implementação da razão: `aggregate('iqaRate')`, `/reports/iqa`, o relatório mensal e `/ai/stats`
 * (via `iqaForPeriod`) passam por ela. Conversas ainda abertas entram no denominador (ainda não "resolvidas").
 */
export type IqaDenominator = 'ALL_BOT' | 'AUTOMATABLE';
export const IQA_DENOMINATORS: readonly IqaDenominator[] = ['ALL_BOT', 'AUTOMATABLE'];

export interface IqaCounts { numerator: number; botInvolved: number; automatableBase: number }
export interface IqaResult { numerator: number; denominator: number; denominatorKind: IqaDenominator; /** percentual 0–100 (2 casas) ou null sem base */ value: number | null }

/** Função pura: contagens → IQA em %. Denominador 0 → `value: null`. */
export function computeIqa(counts: IqaCounts, denominator: IqaDenominator = 'ALL_BOT'): IqaResult {
  const den = denominator === 'AUTOMATABLE' ? counts.automatableBase : counts.botInvolved;
  return { numerator: counts.numerator, denominator: den, denominatorKind: denominator, value: den > 0 ? round((100 * counts.numerator) / den, 2) : null };
}

export interface IqaGlosaBand { maxGapPp: number | null; glosaPct: number }
export const DEFAULT_GLOSA_BANDS: IqaGlosaBand[] = [{ maxGapPp: 10, glosaPct: 10 }, { maxGapPp: 20, glosaPct: 15 }, { maxGapPp: null, glosaPct: 20 }];
export interface IqaGoal { fromMonth: number; goalPct: number }
export const DEFAULT_IQA_GOALS: IqaGoal[] = [{ fromMonth: 1, goalPct: 40 }, { fromMonth: 4, goalPct: 60 }, { fromMonth: 7, goalPct: 80 }];
export interface IqaConfig { denominator: IqaDenominator; goals: IqaGoal[]; glosa: IqaGlosaBand[] }
export const DEFAULT_IQA_CONFIG: IqaConfig = { denominator: 'ALL_BOT', goals: DEFAULT_IQA_GOALS, glosa: DEFAULT_GLOSA_BANDS };

/** Normaliza (e valida) `settings.iqa` cru; qualquer parte inválida cai no padrão. `settings.contract.iqaGlosaBands` (legado) vale se `iqa.glosa` faltar. */
export function normalizeIqaConfig(raw: any, legacyBands?: any): IqaConfig {
  const iqa = raw && typeof raw === 'object' ? raw : {};
  const bands = (src: any): IqaGlosaBand[] | null => {
    if (!Array.isArray(src) || !src.length) return null;
    const out = src.map((b) => ({ maxGapPp: b?.maxGapPp == null ? null : Number(b.maxGapPp), glosaPct: Number(b?.glosaPct) }));
    if (out.some((b) => !Number.isFinite(b.glosaPct) || b.glosaPct < 0 || b.glosaPct > 100 || (b.maxGapPp != null && (!Number.isFinite(b.maxGapPp) || b.maxGapPp < 0)))) return null;
    return out.sort((a, b) => (a.maxGapPp ?? Infinity) - (b.maxGapPp ?? Infinity));
  };
  const goals = (src: any): IqaGoal[] | null => {
    if (!Array.isArray(src) || !src.length) return null;
    const out = src.map((g) => ({ fromMonth: Number(g?.fromMonth), goalPct: Number(g?.goalPct) }));
    if (out.some((g) => !Number.isInteger(g.fromMonth) || g.fromMonth < 1 || !Number.isFinite(g.goalPct) || g.goalPct < 0 || g.goalPct > 100)) return null;
    out.sort((a, b) => a.fromMonth - b.fromMonth);
    return out[0].fromMonth === 1 ? out : null; // precisa cobrir o mês 1
  };
  return {
    denominator: IQA_DENOMINATORS.includes(iqa.denominator) ? iqa.denominator : 'ALL_BOT',
    goals: goals(iqa.goals) ?? DEFAULT_IQA_GOALS,
    glosa: bands(iqa.glosa) ?? bands(legacyBands) ?? DEFAULT_GLOSA_BANDS,
  };
}

export const iqaDefinition = (d: IqaDenominator): string =>
  `atendimentos via chatbot resolvidos no 1º contato e classificados como automatizáveis ÷ ${d === 'AUTOMATABLE' ? 'atendimentos via chatbot classificados como automatizáveis' : 'atendimentos via chatbot'}`;

/** Lê `settings.iqa` do JSON BRUTO do órgão (sem cache; o tipo BvOrgSettings não o conhece). */
export async function getIqaConfig(orgId: string): Promise<IqaConfig> {
  const org = await prisma.bvOrg.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = (org?.settings ?? {}) as any;
  return normalizeIqaConfig(s.iqa, s.contract?.iqaGlosaBands);
}

/** Meta do IQA por mês de contrato (padrão: 1–3 → 40%, 4–6 → 60%, a partir do 7º → 80%; configurável em `settings.iqa.goals`). */
export const iqaGoal = (contractMonth: number, goals: IqaGoal[] = DEFAULT_IQA_GOALS): number => {
  let g = goals[0]?.goalPct ?? 40;
  for (const x of goals) if (contractMonth >= x.fromMonth) g = x.goalPct;
  return g;
};

/** Glosa conforme a distância (em pontos percentuais) abaixo da meta. 0 se a meta foi atingida. */
export function iqaGlosa(value: number | null, goal: number, bands: IqaGlosaBand[] = DEFAULT_GLOSA_BANDS): number | null {
  if (value == null) return null;
  const gap = goal - value;
  if (gap <= 0) return 0;
  for (const b of bands) if (b.maxGapPp == null || gap <= b.maxGapPp) return b.glosaPct;
  return bands[bands.length - 1]?.glosaPct ?? 0;
}

export interface IqaPeriodResult extends IqaResult, IqaCounts { botResolved: number; firstContactResolved: number; automatable: number }

/** IQA de um período/filtros: contagens (SQL) + `computeIqa` com a base configurada. Usado por /reports/iqa e /ai/stats. */
export async function iqaForPeriod(f: Filters, config?: IqaConfig): Promise<IqaPeriodResult> {
  const cfg = config ?? await getIqaConfig(f.orgId);
  const row = (await aggregate(f, [], ['botInvolved', 'botResolved', 'fcrCount', 'automatable', 'iqaCount', 'iqaAutomatableBase']))[0];
  const counts: IqaCounts = { numerator: row.iqaCount, botInvolved: row.botInvolved, automatableBase: row.iqaAutomatableBase };
  return { ...counts, ...computeIqa(counts, cfg.denominator), botResolved: row.botResolved, firstContactResolved: row.fcrCount, automatable: row.automatable };
}

export interface ContractInfo { startDate: string; source: 'settings' | 'first_conversation' | 'none'; bands: IqaGlosaBand[]; hours: Record<string, number> | null }

/** Lê `settings.contract` do JSON BRUTO do órgão (o tipo BvOrgSettings não o conhece). `bands` = faixas de glosa efetivas (`settings.iqa.glosa`). */
export async function getContractInfo(orgId: string, tz: string): Promise<ContractInfo> {
  const org = await prisma.bvOrg.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = (org?.settings ?? {}) as any;
  const raw = s.contract ?? {};
  const bands = normalizeIqaConfig(s.iqa, raw.iqaGlosaBands).glosa;
  const hours = raw.hours && typeof raw.hours === 'object' ? (raw.hours as Record<string, number>) : null;
  if (typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.startDate)) return { startDate: raw.startDate.slice(0, 10), source: 'settings', bands, hours };
  const first = await prisma.bvConversation.findFirst({ where: { orgId }, orderBy: { startedAt: 'asc' }, select: { startedAt: true } });
  if (first) return { startDate: ymd(localParts(first.startedAt, tz)), source: 'first_conversation', bands, hours };
  return { startDate: ymd(localParts(new Date(), tz)), source: 'none', bands, hours };
}

export interface IqaMonth {
  contractMonth: number; from: string; to: string; botInvolved: number; resolvedByBot: number; firstContactResolved: number; automatable: number;
  numerator: number; /** base efetiva do cálculo (depende de `denominatorKind`) */ denominator: number; denominatorKind: IqaDenominator;
  value: number | null; goal: number; reachedGoal: boolean | null; gapPp: number | null; glosaPct: number | null;
  resolvedOfAutomatable: number | null;
}

/** Janela [início, fim) do mês de contrato `k` (1 = mês que começa em startDate). */
export function contractMonthRange(startDate: string, k: number, tz: string): { from: Date; to: Date } {
  const [y, m, d] = startDate.split('-').map(Number);
  const a = addMonthsLocal(y, m, d, k - 1), b = addMonthsLocal(y, m, d, k);
  return { from: zonedToUtc(a.y, a.m, a.d, 0, 0, tz), to: zonedToUtc(b.y, b.m, b.d, 0, 0, tz) };
}

export async function iqaByContractMonth(base: Omit<Filters, 'period'>, tz: string, upTo = new Date(), startOverride?: string): Promise<{ contract: ContractInfo; config: IqaConfig; months: IqaMonth[] }> {
  const [contract, config] = await Promise.all([getContractInfo(base.orgId, tz), getIqaConfig(base.orgId)]);
  const start = startOverride ?? contract.startDate;
  const months: IqaMonth[] = [];
  for (let k = 1; k <= 60; k++) {
    const r = contractMonthRange(start, k, tz);
    if (r.from > upTo) break;
    const q = await iqaForPeriod({ ...base, period: { from: r.from, to: r.to, timezone: tz } }, config);
    const goal = iqaGoal(k, config.goals);
    const ended = r.to <= upTo;
    months.push({
      contractMonth: k, from: r.from.toISOString(), to: r.to.toISOString(), botInvolved: q.botInvolved, resolvedByBot: q.botResolved,
      firstContactResolved: q.firstContactResolved, automatable: q.automatable, numerator: q.numerator, denominator: q.denominator,
      denominatorKind: q.denominatorKind, value: q.value, goal,
      reachedGoal: q.value == null ? null : q.value >= goal, gapPp: q.value == null ? null : round(goal - q.value, 2),
      // glosa só é apurada em meses completos; mês corrente é parcial
      glosaPct: ended ? iqaGlosa(q.value, goal, config.glosa) : null,
      resolvedOfAutomatable: q.automatable ? round((100 * q.numerator) / q.automatable, 2) : null,
    });
  }
  return { contract: { ...contract, startDate: start }, config, months };
}
