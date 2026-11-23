import { prisma } from '../../lib/prisma';
import { getTasksConfig, levelFromPriority, LEVELS, type Level, type TasksOrgConfig } from './model';

/**
 * Indicadores do service desk (TR 8.2.8) calculados sobre as tarefas SERVICE_REQUEST criadas no período:
 *  ISA1–ISA4 — % de solicitações do nível L1..L4 atendidas (DONE) dentro do prazo ANS, vs. meta (100/95/80/60).
 *  IOSA      — % de dias de atraso das OS: Σ dias além do prazo ÷ Σ dias previstos (limite 5%).
 *  IR        — avaliação das OS: média das notas 0–10 em % (meta 90%); também cobertura e % satisfatórias.
 * Entram no cálculo só solicitações não canceladas que já foram concluídas ou cujo prazo já venceu.
 * A glosa é INDICATIVA (faixas configuráveis em settings.tasks.glosaBands) — o percentual contratual é decisão do órgão.
 */
const DAY_MS = 86_400_000;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface Indicator {
  code: string; name: string; level?: Level; target: number; unit: '%'; direction: 'min' | 'max';
  considered: number; onTime?: number; late?: number; value: number | null; met: boolean | null;
  shortfallPoints: number | null; glosaPercent: number; extra?: Record<string, unknown>;
}

function glosaFor(shortfall: number | null, bands: TasksOrgConfig['glosaBands']): number {
  if (shortfall === null || shortfall <= 0) return 0;
  const sorted = [...bands].sort((a, b) => a.upToPoints - b.upToPoints);
  return (sorted.find((b) => shortfall <= b.upToPoints) ?? sorted[sorted.length - 1]).percent;
}

export async function loadServiceRequests(orgId: string, from: Date, to: Date) {
  const tasks = await prisma.bvTask.findMany({
    where: { orgId, kind: 'SERVICE_REQUEST', createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: 'asc' }, take: 20000,
  });
  const ratings = tasks.length
    ? await prisma.bvTaskHistory.findMany({ where: { taskId: { in: tasks.map((t) => t.id) }, field: 'rating' }, orderBy: { createdAt: 'asc' }, select: { taskId: true, toValue: true } })
    : [];
  const rating = new Map<string, number>();
  for (const r of ratings) if (r.toValue !== null) rating.set(r.taskId, Number(r.toValue)); // a última vale
  return { tasks, rating };
}

export async function computeIndicators(orgId: string, from: Date, to: Date, now = new Date()) {
  const { cfg } = await getTasksConfig(orgId);
  const { tasks, rating } = await loadServiceRequests(orgId, from, to);
  const level = (t: (typeof tasks)[number]): Level => ((t.supportLevel as Level) || levelFromPriority(t.priority));
  const considered = tasks.filter((t) => t.status !== 'CANCELLED' && t.slaResolutionDueAt && (t.status === 'DONE' || t.slaResolutionDueAt < now));
  const onTime = (t: (typeof tasks)[number]) => t.status === 'DONE' && !!t.completedAt && !!t.slaResolutionDueAt && t.completedAt <= t.slaResolutionDueAt;

  const indicators: Indicator[] = [];
  LEVELS.forEach((l, i) => {
    const set = considered.filter((t) => level(t) === l);
    const ok = set.filter(onTime).length;
    const target = cfg.ans[l].target;
    const value = set.length ? round((ok / set.length) * 100) : null;
    const shortfall = value === null ? null : round(Math.max(0, target - value));
    indicators.push({
      code: `ISA${i + 1}`, name: `Solicitações ${l} atendidas no prazo`, level: l, target, unit: '%', direction: 'min',
      considered: set.length, onTime: ok, late: set.length - ok, value, met: value === null ? null : value >= target,
      shortfallPoints: shortfall, glosaPercent: glosaFor(shortfall, cfg.glosaBands),
    });
  });

  let planned = 0; let lateMs = 0; let lateTasks = 0;
  for (const t of considered) {
    planned += (t.slaResolutionDueAt!.getTime() - t.createdAt.getTime());
    const end = t.completedAt ?? now;
    const over = Math.max(0, end.getTime() - t.slaResolutionDueAt!.getTime());
    if (over > 0) lateTasks++;
    lateMs += over;
  }
  const iosa = planned > 0 ? round((lateMs / planned) * 100) : null;
  const iosaShort = iosa === null ? null : round(Math.max(0, iosa - 5));
  indicators.push({
    code: 'IOSA', name: 'Dias de atraso das ordens de serviço', target: 5, unit: '%', direction: 'max', considered: considered.length,
    late: lateTasks, value: iosa, met: iosa === null ? null : iosa <= 5, shortfallPoints: iosaShort, glosaPercent: glosaFor(iosaShort, cfg.glosaBands),
    extra: { plannedDays: round(planned / DAY_MS), lateDays: round(lateMs / DAY_MS) },
  });

  const done = tasks.filter((t) => t.status === 'DONE');
  const scores = done.map((t) => rating.get(t.id)).filter((x): x is number => x !== undefined);
  const avgPct = scores.length ? round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) : null;
  const irShort = avgPct === null ? null : round(Math.max(0, 90 - avgPct));
  indicators.push({
    code: 'IR', name: 'Avaliação das ordens de serviço', target: 90, unit: '%', direction: 'min', considered: done.length, value: avgPct,
    met: avgPct === null ? null : avgPct >= 90, shortfallPoints: irShort, glosaPercent: glosaFor(irShort, cfg.glosaBands),
    extra: {
      rated: scores.length, coveragePct: done.length ? round((scores.length / done.length) * 100) : null,
      satisfactoryPct: scores.length ? round((scores.filter((s) => s >= cfg.ratingPassScore).length / scores.length) * 100) : null,
      satisfactoryMinScore: cfg.ratingPassScore, averageScore: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    },
  });

  return {
    period: { from: from.toISOString(), to: to.toISOString() }, generatedAt: now.toISOString(),
    totals: { created: tasks.length, considered: considered.length, done: done.length, open: tasks.filter((t) => ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length, cancelled: tasks.filter((t) => t.status === 'CANCELLED').length },
    indicators,
    glosaIndicativeTotalPercent: round(indicators.reduce((a, i) => a + i.glosaPercent, 0)),
    disclaimer: 'Glosa indicativa por faixas configuráveis; não substitui o cálculo contratual do órgão.',
  };
}

/** CSV seguro: aspas duplicadas e prefixo `'` em células que começam com = + - @ (injeção de fórmula). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function indicatorsToCsv(r: Awaited<ReturnType<typeof computeIndicators>>): string {
  return toCsv(
    ['indicador', 'nome', 'nivel', 'meta_pct', 'sentido', 'considerados', 'no_prazo', 'em_atraso', 'valor_pct', 'atingiu_meta', 'pontos_abaixo_da_meta', 'glosa_indicativa_pct'],
    r.indicators.map((i) => [i.code, i.name, i.level ?? '', i.target, i.direction === 'min' ? 'minimo' : 'maximo', i.considered, i.onTime ?? '', i.late ?? '', i.value ?? '', i.met === null ? '' : i.met ? 'sim' : 'nao', i.shortfallPoints ?? '', i.glosaPercent]),
  );
}

export async function listServiceRequests(orgId: string, from: Date, to: Date, now = new Date()) {
  const { tasks, rating } = await loadServiceRequests(orgId, from, to);
  return tasks.map((t) => {
    const due = t.slaResolutionDueAt;
    const end = t.completedAt ?? now;
    return {
      code: t.code, title: t.title, level: (t.supportLevel as Level) || levelFromPriority(t.priority), priority: t.priority, status: t.status,
      createdAt: t.createdAt, respondedAt: t.respondedAt, dueAt: due, completedAt: t.completedAt,
      onTime: t.status === 'DONE' && !!t.completedAt && !!due ? t.completedAt <= due : null,
      lateDays: due && t.status !== 'CANCELLED' ? round(Math.max(0, end.getTime() - due.getTime()) / DAY_MS) : null,
      rating: rating.get(t.id) ?? null,
    };
  });
}
