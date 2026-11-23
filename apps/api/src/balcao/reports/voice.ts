import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { round, ts, validTz, type Period } from './util';

/** Relatório de voz (BvCall): chamadas, duração, abandono, gravações, pico de simultaneidade. Coorte por `startedAt`. */
export interface VoiceFilters { orgId: string; period: Period; agentId?: string[]; direction?: 'IN' | 'OUT' }

function where(f: VoiceFilters): Prisma.Sql {
  const p: Prisma.Sql[] = [Prisma.sql`k."orgId" = ${f.orgId}`, Prisma.sql`k."startedAt" >= ${ts(f.period.from)}`, Prisma.sql`k."startedAt" < ${ts(f.period.to)}`];
  if (f.agentId?.length) p.push(Prisma.sql`k."agentUserId" IN (${Prisma.join(f.agentId)})`);
  if (f.direction) p.push(Prisma.sql`k."direction" = ${f.direction}`);
  return Prisma.join(p, ' AND ');
}

const DUR = `k."durationSec"::float8`;
const ANSWERED = `k."answeredAt" IS NOT NULL`;
const WAIT = `EXTRACT(EPOCH FROM (k."answeredAt" - k."startedAt"))::float8`;
const num = (e: string) => `ROUND((${e})::numeric, 1)::float8`;

export const VOICE_COLUMNS = [
  { key: 'total', label: 'Chamadas' }, { key: 'inbound', label: 'Recebidas' }, { key: 'outbound', label: 'Realizadas' },
  { key: 'answered', label: 'Atendidas' }, { key: 'abandoned', label: 'Abandonadas' }, { key: 'failed', label: 'Falhas' },
  { key: 'abandonRate', label: 'Taxa de abandono (%)' }, { key: 'minutes', label: 'Minutos falados' },
  { key: 'durationAvg', label: 'Duração média (s)' }, { key: 'durationP50', label: 'Duração P50 (s)' }, { key: 'durationP90', label: 'Duração P90 (s)' },
  { key: 'waitAvg', label: 'Espera média até atender (s)' }, { key: 'waitP90', label: 'Espera P90 (s)' },
  { key: 'recordings', label: 'Gravações' }, { key: 'recordingBytes', label: 'Tamanho das gravações (bytes)' },
];

const AGG = `
  COUNT(*)::int AS "total",
  (COUNT(*) FILTER (WHERE k."direction" = 'IN'))::int AS "inbound",
  (COUNT(*) FILTER (WHERE k."direction" = 'OUT'))::int AS "outbound",
  (COUNT(*) FILTER (WHERE ${ANSWERED}))::int AS "answered",
  (COUNT(*) FILTER (WHERE k."status" = 'ABANDONED'))::int AS "abandoned",
  (COUNT(*) FILTER (WHERE k."status" = 'FAILED'))::int AS "failed",
  ROUND((100.0 * COUNT(*) FILTER (WHERE k."status" = 'ABANDONED' AND k."direction" = 'IN') / NULLIF(COUNT(*) FILTER (WHERE k."direction" = 'IN'), 0))::numeric, 2)::float8 AS "abandonRate",
  ${num(`COALESCE(SUM(k."durationSec") FILTER (WHERE ${ANSWERED}), 0) / 60.0`)} AS "minutes",
  ${num(`AVG(${DUR}) FILTER (WHERE ${ANSWERED} AND k."durationSec" IS NOT NULL)`)} AS "durationAvg",
  ${num(`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DUR}) FILTER (WHERE ${ANSWERED} AND k."durationSec" IS NOT NULL)`)} AS "durationP50",
  ${num(`percentile_cont(0.9) WITHIN GROUP (ORDER BY ${DUR}) FILTER (WHERE ${ANSWERED} AND k."durationSec" IS NOT NULL)`)} AS "durationP90",
  ${num(`AVG(${WAIT}) FILTER (WHERE ${ANSWERED} AND k."answeredAt" >= k."startedAt")`)} AS "waitAvg",
  ${num(`percentile_cont(0.9) WITHIN GROUP (ORDER BY ${WAIT}) FILTER (WHERE ${ANSWERED} AND k."answeredAt" >= k."startedAt")`)} AS "waitP90",
  (COUNT(*) FILTER (WHERE k."recordingKey" IS NOT NULL))::int AS "recordings",
  COALESCE(SUM(k."recordingSizeBytes"), 0)::float8 AS "recordingBytes"`;

type Row = Record<string, any>;

export async function voiceTotals(f: VoiceFilters): Promise<Row> {
  const r = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${Prisma.raw(AGG)} FROM "BvCall" k WHERE ${where(f)}`);
  return r[0];
}

export async function voiceByDay(f: VoiceFilters): Promise<Row[]> {
  const tz = validTz(f.period.timezone);
  return prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT to_char(date_trunc('day', (k."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS "day", ${Prisma.raw(AGG)}
    FROM "BvCall" k WHERE ${where(f)} GROUP BY 1 ORDER BY 1`);
}

export async function voiceByAgent(f: VoiceFilters): Promise<Row[]> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT k."agentUserId" AS "agent", ${Prisma.raw(AGG)} FROM "BvCall" k WHERE ${where(f)} AND k."agentUserId" IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`);
  const ids = rows.map((r) => r.agent as string);
  const us = ids.length ? await prisma.bvUser.findMany({ where: { orgId: f.orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const m = new Map(us.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, agentName: m.get(r.agent) ?? null }));
}

/** Pico de chamadas simultâneas no período (varredura +1/−1 sobre [startedAt, endedAt|answeredAt+duração|início]). */
export async function voicePeakConcurrent(f: VoiceFilters): Promise<number> {
  const r = await prisma.$queryRaw<Array<{ peak: number | null }>>(Prisma.sql`
    WITH iv AS (
      SELECT k."startedAt" AS s,
        GREATEST(k."startedAt", COALESCE(k."endedAt", k."answeredAt" + make_interval(secs => COALESCE(k."durationSec", 0)), k."startedAt")) AS e
      FROM "BvCall" k WHERE ${where(f)}
    ), ev AS (SELECT s AS t, 1 AS d FROM iv UNION ALL SELECT e AS t, -1 AS d FROM iv)
    SELECT MAX(n)::int AS peak FROM (SELECT SUM(d) OVER (ORDER BY t, d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS n FROM ev) x`);
  return r[0]?.peak ?? 0;
}

export async function voiceReport(f: VoiceFilters) {
  const [totals, byDay, byAgent, peak] = await Promise.all([voiceTotals(f), voiceByDay(f), voiceByAgent(f), voicePeakConcurrent(f)]);
  return { totals: { ...totals, peakConcurrent: peak, avgPerDay: byDay.length ? round(totals.total / byDay.length, 1) : 0 }, byDay, byAgent };
}
