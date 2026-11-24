import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { guard, idParam, parse, sendError } from '../core/http';
import { getOrgSettings, updateOrgSettings } from '../core/settings';
import { getObjectBuffer } from '../core/storage';
import { CHANNELS, USAGE_ITEMS } from '../core/types';
import { columnsFor, customDefinitionSchema, definitionsCatalog, runCustom } from './custom';
import { DATASETS, CursorError, exportPage, type Dataset } from './export';
import { consumption, dashboard, listQuotas, registerFiscalJobs } from './fiscal';
import {
  AGENT_METRICS, GRANULARITIES, GRAN_DIM, METRICS, OVERVIEW_METRICS, TIMESERIES_METRICS, aggregate, agentsReport, compareKpis,
  IQA_DENOMINATORS, getIqaConfig, iqaByContractMonth, iqaDefinition, npsDistribution, npsSummary, overviewKpis, slaViolationList, type Filters,
} from './metrics';
import { MONTH_RE, generateMonthly } from './monthly';
import { realtimeSnapshot, registerRealtimeEmitter } from './realtime';
import { FREQ_PRESET, downloadUrl, executeSavedReport, recipientAllowed, registerScheduleJob } from './schedule';
import {
  PeriodError, describePeriod, nextRunAfter, previousPeriod, resolvePeriod, toCsv, validTz, type CsvColumn, type Period,
} from './util';
import { VOICE_COLUMNS, voiceReport } from './voice';

export { setReportMailer, runDueSchedules } from './schedule';
export { runQuotaAlerts, runStorageMeasure, measureOrgStorage } from './fiscal';

const csvList = <T extends string = string>(allowed?: readonly T[]) => z.string().max(600).optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
  .refine((a) => !a || !allowed || a.every((x) => (allowed as readonly string[]).includes(x)), { message: 'valor fora da lista permitida' });

const baseQuery = z.object({
  from: z.string().max(40).optional(), to: z.string().max(40).optional(),
  channel: csvList(CHANNELS), queueId: csvList(), agentId: csvList(), category: csvList(),
  format: z.enum(['json', 'csv']).default('json'),
  compare: z.enum(['true', 'false']).optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
  metrics: csvList(Object.keys(METRICS)),
  atRiskSec: z.coerce.number().int().min(0).max(3600).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type BaseQuery = z.infer<typeof baseQuery>;

async function tzOf(orgId: string) { return validTz((await getOrgSettings(orgId)).timezone); }

async function context(req: any, reply: FastifyReply) {
  const q = parse(baseQuery, req.query, reply);
  if (!q) return null;
  const orgId = req.bv.orgId as string;
  const tz = await tzOf(orgId);
  let period: Period;
  try { period = resolvePeriod(q, tz); } catch (e: any) { if (e instanceof PeriodError) { sendError(reply, 400, 'report.invalid_period', e.message); return null; } throw e; }
  const filters: Filters = { orgId, period, channel: q.channel, queueId: q.queueId, agentId: q.agentId, category: q.category };
  return { q, orgId, tz, period, filters };
}

function sendCsv(reply: FastifyReply, name: string, columns: CsvColumn[], rows: Array<Record<string, unknown>>) {
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`).send(toCsv(columns, rows));
}
/** Responde JSON ou CSV conforme `?format=`. */
function respond(reply: FastifyReply, q: BaseQuery, name: string, payload: unknown, columns: CsvColumn[], rows: Array<Record<string, unknown>>) {
  return q.format === 'csv' ? sendCsv(reply, name, columns, rows) : payload;
}

const FILTER_ECHO = (f: Filters) => ({ channel: f.channel ?? null, queueId: f.queueId ?? null, agentId: f.agentId ?? null, category: f.category ?? null });

export default async function plugin(app: FastifyInstance): Promise<void> {
  registerScheduleJob(); registerFiscalJobs(); registerRealtimeEmitter();
  const read = guard('report:read');
  const exportPerm = guard('report:export');

  // ── Catálogo e relatórios padrão ───────────────────────────────────────────
  app.get('/reports/definitions', { preHandler: read }, async () => definitionsCatalog());

  app.get('/reports/overview', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const [kpis, byChannel, byHour] = await Promise.all([
      overviewKpis(c.filters), aggregate(c.filters, ['channel'], ['total', 'closed', 'tmeAvg', 'tmaAvg', 'nps']),
      aggregate(c.filters, ['hourOfDay'], ['total']),
    ]);
    let previous: any = null, comparison: any = null;
    if (c.q.compare === 'true') {
      const pp = previousPeriod(c.period);
      const pk = await overviewKpis({ ...c.filters, period: pp });
      previous = { period: describePeriod(pp), kpis: pk }; comparison = compareKpis(kpis, pk);
    }
    const payload = { period: describePeriod(c.period), filters: FILTER_ECHO(c.filters), kpis, previous, comparison, volumeByChannel: byChannel, volumeByHourOfDay: byHour };
    const rows = OVERVIEW_METRICS.map((k) => ({ metric: METRICS[k].label, value: (kpis as any)[k], previous: previous?.kpis?.[k] ?? '', delta: comparison?.[k]?.delta ?? '', deltaPct: comparison?.[k]?.deltaPct ?? '' }));
    return respond(reply, c.q, 'visao-geral', payload, [{ key: 'metric', label: 'Métrica' }, { key: 'value', label: 'Valor' }, { key: 'previous', label: 'Período anterior' }, { key: 'delta', label: 'Variação' }, { key: 'deltaPct', label: 'Variação (%)' }], rows);
  });

  app.get('/reports/timeseries', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const dim = GRAN_DIM[c.q.granularity];
    const metrics = c.q.metrics?.length ? c.q.metrics : TIMESERIES_METRICS;
    const rows = await aggregate(c.filters, [dim], metrics, { limit: 10000 });
    const cols = columnsFor([dim], metrics);
    return respond(reply, c.q, 'serie-temporal', { period: describePeriod(c.period), granularity: c.q.granularity, bucketKey: dim, columns: cols, series: rows, note: 'Somente intervalos com atendimentos; datas no fuso do órgão.' }, cols, rows);
  });

  app.get('/reports/agents', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const rows = await agentsReport(c.filters);
    const cols = [...columnsFor(['agent'], AGENT_METRICS), { key: 'simultaneousAvg', label: 'Simultâneas — média' }, { key: 'simultaneousPeak', label: 'Simultâneas — pico' }, { key: 'busySeconds', label: 'Tempo em atendimento (s)' }, { key: 'presence', label: 'Presença atual' }];
    cols.splice(1, 0, { key: 'agentName', label: 'Nome do atendente' });
    return respond(reply, c.q, 'agentes', { period: describePeriod(c.period), agents: rows, note: 'Tempo online aproximado por tempo em atendimento (não há histórico de presença).' }, cols, rows);
  });

  app.get('/reports/queues', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const m = ['total', 'closed', 'abandoned', 'abandonRate', 'tmeAvg', 'tmeP90', 'queueWaitAvg', 'queueWaitP90', 'tmaAvg', 'tmrAvg', 'slaRate', 'slaViolations', 'fcrRate', 'transferred', 'nps'];
    const rows = await aggregate(c.filters, ['queue'], m);
    const cols = columnsFor(['queue'], m);
    return respond(reply, c.q, 'filas', { period: describePeriod(c.period), queues: rows }, cols, rows);
  });

  app.get('/reports/channels', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const m = ['total', 'closed', 'abandoned', 'abandonRate', 'tmeAvg', 'tmeP90', 'tmaAvg', 'tmrAvg', 'botInvolved', 'botContainmentRate', 'fcrRate', 'slaRate', 'nps', 'csatAvg'];
    const rows = await aggregate(c.filters, ['channel'], m);
    const cols = columnsFor(['channel'], m);
    return respond(reply, c.q, 'canais', { period: describePeriod(c.period), channels: rows }, cols, rows);
  });

  app.get('/reports/nps', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const m = ['npsResponses', 'npsPromoters', 'npsPassives', 'npsDetractors', 'nps', 'csatAvg'];
    const [overall, dist, byQueue, byAgent, byChannel, series] = await Promise.all([
      aggregate(c.filters, [], m), npsDistribution(c.filters), aggregate(c.filters, ['queue'], m), aggregate(c.filters, ['agent'], m),
      aggregate(c.filters, ['channel'], m), aggregate(c.filters, [GRAN_DIM[c.q.granularity]], m, { limit: 10000 }),
    ]);
    const payload = { period: describePeriod(c.period), summary: overall[0], distribution: dist, byQueue, byAgent, byChannel, series, check: npsSummary(dist) };
    const cols = columnsFor([GRAN_DIM[c.q.granularity]], m);
    return respond(reply, c.q, 'nps', payload, cols, series);
  });

  app.get('/reports/sla', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const m = ['slaBase', 'slaViolations', 'slaRate', 'slaFirstResponseRate', 'slaResolutionRate'];
    const [summary, byQueue, byDay, violations] = await Promise.all([aggregate(c.filters, [], m), aggregate(c.filters, ['queue'], m), aggregate(c.filters, ['day'], m, { limit: 10000 }), slaViolationList(c.filters, 100)]);
    const cols = columnsFor(['day'], m);
    return respond(reply, c.q, 'sla', { period: describePeriod(c.period), summary: summary[0], byQueue, byDay, violations }, cols, byDay);
  });

  app.get('/reports/iqa', { preHandler: read }, async (req, reply) => {
    const q = parse(baseQuery, req.query, reply); if (!q) return;
    const orgId = req.bv!.orgId;
    const tz = await tzOf(orgId);
    const r = await iqaByContractMonth({ orgId, channel: q.channel, queueId: q.queueId, agentId: q.agentId, category: q.category }, tz, new Date(), q.startDate);
    const goals = r.config.goals.map((g, i, a) => ({ fromMonth: g.fromMonth, months: i === a.length - 1 ? `${g.fromMonth}+` : g.fromMonth === a[i + 1].fromMonth - 1 ? `${g.fromMonth}` : `${g.fromMonth}–${a[i + 1].fromMonth - 1}`, goalPct: g.goalPct }));
    const payload = {
      indicator: 'IQA (indicador 07)', definition: iqaDefinition(r.config.denominator), denominator: r.config.denominator,
      goals, glosaBands: r.contract.bands, contract: { startDate: r.contract.startDate, source: r.contract.source }, months: r.months,
    };
    const cols: CsvColumn[] = [['contractMonth', 'Mês de contrato'], ['from', 'Início'], ['to', 'Fim (exclusivo)'], ['botInvolved', 'Atendimentos via chatbot'], ['resolvedByBot', 'Resolvidos pelo bot'], ['firstContactResolved', 'Resolvidos no 1º contato'], ['automatable', 'Automatizáveis'], ['numerator', 'Numerador IQA'], ['denominator', 'Denominador IQA'], ['denominatorKind', 'Base do denominador'], ['value', 'IQA (%)'], ['goal', 'Meta (%)'], ['reachedGoal', 'Meta atingida'], ['gapPp', 'Distância da meta (p.p.)'], ['glosaPct', 'Glosa (%)']].map(([key, label]) => ({ key, label }));
    return respond(reply, q, 'iqa', payload, cols, r.months as any);
  });

  // Base de cálculo, metas por mês de contrato e faixas de glosa do IQA (settings.iqa). Só ADMIN altera.
  app.get('/reports/iqa/config', { preHandler: read }, async (req) => getIqaConfig(req.bv!.orgId));
  app.put('/reports/iqa/config', { preHandler: guard('org:manage') }, async (req, reply) => {
    const b = parse(z.object({
      denominator: z.enum(IQA_DENOMINATORS as [string, ...string[]]).optional(),
      goals: z.array(z.object({ fromMonth: z.number().int().min(1).max(60), goalPct: z.number().min(0).max(100) }).strict()).min(1).max(12).nullable().optional(),
      glosa: z.array(z.object({ maxGapPp: z.number().min(0).max(100).nullable(), glosaPct: z.number().min(0).max(100) }).strict()).min(1).max(10).nullable().optional(),
    }).strict(), req.body, reply); if (!b) return;
    if (b.goals && !b.goals.some((g) => g.fromMonth === 1)) return sendError(reply, 400, 'report.invalid_iqa_config', 'goals deve ter uma meta com fromMonth = 1');
    if (b.glosa && b.glosa.filter((g) => g.maxGapPp == null).length !== 1) return sendError(reply, 400, 'report.invalid_iqa_config', 'glosa deve ter exatamente uma faixa final com maxGapPp = null');
    const orgId = req.bv!.orgId;
    const before = await getIqaConfig(orgId);
    await updateOrgSettings(orgId, { iqa: b } as any);
    const after = await getIqaConfig(orgId);
    await auditReq(req, 'config.update', { entityType: 'iqa.config', entityId: orgId, before, after });
    await recordConfigVersion(orgId, 'iqa.config', orgId, after, req.bv!.userId);
    return after;
  });

  app.get('/reports/voice', { preHandler: read }, async (req, reply) => {
    const c = await context(req, reply); if (!c) return;
    const r = await voiceReport({ orgId: c.orgId, period: c.period, agentId: c.q.agentId });
    return respond(reply, c.q, 'voz', { period: describePeriod(c.period), ...r }, [{ key: 'day', label: 'Dia' }, ...VOICE_COLUMNS], r.byDay);
  });

  app.get('/reports/realtime', { preHandler: read }, async (req, reply) => {
    const q = parse(baseQuery, req.query, reply); if (!q) return;
    const snap = await realtimeSnapshot(req.bv!.orgId, { atRiskSec: q.atRiskSec });
    if (q.format === 'csv') {
      const { agents, queues, ...flat } = snap;
      return sendCsv(reply, 'tempo-real', [{ key: 'k', label: 'Indicador' }, { key: 'v', label: 'Valor' }], Object.entries({ ...flat, 'agents.online': agents.online, 'agents.busy': agents.busy, 'agents.away': agents.away }).map(([k, v]) => ({ k, v })));
    }
    return snap;
  });

  // ── Relatórios personalizáveis ─────────────────────────────────────────────
  app.post('/reports/custom', { preHandler: read }, async (req, reply) => {
    const def = parse(customDefinitionSchema, req.body, reply); if (!def) return;
    const fmt = z.enum(['json', 'csv']).catch('json').parse((req.query as any)?.format);
    const tz = await tzOf(req.bv!.orgId);
    let r;
    try { r = await runCustom(req.bv!.orgId, def, tz); } catch (e: any) { if (e instanceof PeriodError) return sendError(reply, 400, 'report.invalid_period', e.message); throw e; }
    return fmt === 'csv' ? sendCsv(reply, 'relatorio-personalizado', r.columns, r.rows) : r;
  });

  // ── Relatórios salvos e agendamentos ───────────────────────────────────────
  const scheduleSchema = z.strictObject({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), format: z.enum(['CSV', 'JSON']).default('CSV'),
    recipients: z.array(z.string().email().max(200)).max(20).default([]),
    hour: z.number().int().min(0).max(23).optional(), weekday: z.number().int().min(0).max(6).optional(), dayOfMonth: z.number().int().min(1).max(28).optional(),
    active: z.boolean().default(true),
  });
  const savedBody = z.strictObject({
    name: z.string().min(1).max(120), description: z.string().max(500).optional(),
    definition: z.record(z.string(), z.unknown()), schedule: scheduleSchema.nullish(),
  });

  const view = (r: any) => ({
    id: r.id, name: r.name, description: r.params?.description ?? null, definition: r.params?.definition ?? null,
    schedule: r.frequency === 'NONE' ? null : { frequency: r.frequency, format: r.format, recipients: r.recipients, hour: r.params?.hour ?? 6, weekday: r.params?.weekday ?? null, dayOfMonth: r.params?.dayOfMonth ?? null, active: r.active, nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt },
    createdAt: r.createdAt,
  });

  function buildDef(raw: Record<string, unknown>, freq: string | undefined, reply: FastifyReply) {
    const d = { ...raw } as any;
    if (freq && freq !== 'NONE' && !d.period) d.period = { preset: FREQ_PRESET[freq as keyof typeof FREQ_PRESET] };
    return parse(customDefinitionSchema, d, reply);
  }
  function checkRecipients(list: string[], reply: FastifyReply): boolean {
    const bad = list.filter((e) => !recipientAllowed(e));
    if (bad.length) { sendError(reply, 400, 'report.recipient_not_allowed', 'Destinatário fora dos domínios permitidos', { recipients: bad }); return false; }
    return true;
  }

  app.get('/reports/saved', { preHandler: read }, async (req) => {
    const rows = await prisma.bvReportSchedule.findMany({ where: { orgId: req.bv!.orgId, reportType: 'CUSTOM' }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { reports: rows.map(view) };
  });

  app.post('/reports/saved', { preHandler: exportPerm }, async (req, reply) => {
    const b = parse(savedBody, req.body, reply); if (!b) return;
    const def = buildDef(b.definition, b.schedule?.frequency, reply); if (!def) return;
    if (b.schedule && !checkRecipients(b.schedule.recipients, reply)) return;
    const orgId = req.bv!.orgId, tz = await tzOf(orgId), s = b.schedule;
    const row = await prisma.bvReportSchedule.create({
      data: {
        orgId, name: b.name, reportType: 'CUSTOM', params: { definition: def, description: b.description ?? null, hour: s?.hour, weekday: s?.weekday, dayOfMonth: s?.dayOfMonth } as any,
        frequency: s?.frequency ?? 'NONE', format: s?.format ?? 'CSV', recipients: s?.recipients ?? [], active: !!s && s.active, createdById: req.bv!.userId,
        nextRunAt: s && s.active ? nextRunAfter(s, new Date(), tz) : null,
      },
    });
    await auditReq(req, 'report.saved.create', { entityType: 'BvReportSchedule', entityId: row.id, after: { name: row.name, frequency: row.frequency, recipients: row.recipients } });
    return reply.code(201).send(view(row));
  });

  app.put('/reports/saved/:id', { preHandler: exportPerm }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const b = parse(savedBody.partial(), req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const cur = await prisma.bvReportSchedule.findFirst({ where: { id, orgId, reportType: 'CUSTOM' } });
    if (!cur) return sendError(reply, 404, 'report.not_found', 'Relatório não encontrado');
    const tz = await tzOf(orgId);
    const prevParams = (cur.params ?? {}) as any;
    const sched = b.schedule === undefined ? undefined : b.schedule; // null = remover agendamento
    const freq = sched === undefined ? cur.frequency : sched?.frequency ?? 'NONE';
    let def = prevParams.definition;
    if (b.definition) { def = buildDef(b.definition, freq, reply); if (!def) return; }
    if (sched && !checkRecipients(sched.recipients, reply)) return;
    const data: any = { ...(b.name ? { name: b.name } : {}) };
    const params: any = { ...prevParams, definition: def, ...(b.description !== undefined ? { description: b.description } : {}) };
    if (sched !== undefined) {
      if (sched === null) Object.assign(data, { frequency: 'NONE', active: false, nextRunAt: null, recipients: [] });
      else {
        Object.assign(params, { hour: sched.hour, weekday: sched.weekday, dayOfMonth: sched.dayOfMonth });
        Object.assign(data, { frequency: sched.frequency, format: sched.format, recipients: sched.recipients, active: sched.active, nextRunAt: sched.active ? nextRunAfter(sched, new Date(), tz) : null });
      }
    }
    data.params = params;
    await prisma.bvReportSchedule.updateMany({ where: { id, orgId }, data });
    const row = await prisma.bvReportSchedule.findFirstOrThrow({ where: { id, orgId } });
    await auditReq(req, 'report.saved.update', { entityType: 'BvReportSchedule', entityId: id, before: { name: cur.name, frequency: cur.frequency }, after: { name: row.name, frequency: row.frequency } });
    return view(row);
  });

  app.delete('/reports/saved/:id', { preHandler: exportPerm }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const r = await prisma.bvReportSchedule.deleteMany({ where: { id, orgId: req.bv!.orgId, reportType: 'CUSTOM' } });
    if (!r.count) return sendError(reply, 404, 'report.not_found', 'Relatório não encontrado');
    await auditReq(req, 'report.saved.delete', { entityType: 'BvReportSchedule', entityId: id });
    return reply.code(204).send();
  });

  app.post('/reports/saved/:id/run', { preHandler: exportPerm }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const send = (req.query as any)?.send === 'true';
    const row = await prisma.bvReportSchedule.findFirst({ where: { id, orgId: req.bv!.orgId, reportType: 'CUSTOM' } });
    if (!row) return sendError(reply, 404, 'report.not_found', 'Relatório não encontrado');
    const out = await executeSavedReport(row, `${id}:manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, { send: send && row.recipients.length > 0, createdById: req.bv!.userId });
    await auditReq(req, 'report.saved.run', { entityType: 'BvReportSchedule', entityId: id, meta: { status: out.status, send } });
    if (out.status === 'FAILED') return sendError(reply, 500, 'report.failed', out.error ?? 'Falha ao gerar o relatório');
    return { jobId: out.jobId, status: out.status, sent: out.sent, failed: out.failed, downloadUrl: out.jobId ? downloadUrl(out.jobId) : null };
  });

  // ── Arquivos gerados (relatórios agendados e mensal) ───────────────────────
  const jobView = (j: any) => ({ id: j.id, type: j.type, format: j.format, status: j.status, kind: j.params?.kind ?? null, name: j.params?.name ?? null, month: j.params?.month ?? null, sizeBytes: j.sizeBytes != null ? Number(j.sizeBytes) : null, sha256: j.sha256, error: j.error, createdAt: j.createdAt, expiresAt: j.expiresAt, mail: j.params?.mail ?? null });

  app.get('/reports/exports', { preHandler: read }, async (req) => {
    const rows = await prisma.bvExportJob.findMany({ where: { orgId: req.bv!.orgId, type: 'REPORT' }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { exports: rows.map(jobView) };
  });

  app.get('/reports/exports/:id/download', { preHandler: read }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const fmtQ = (req.query as any)?.format;
    let job = await prisma.bvExportJob.findFirst({ where: { id, orgId: req.bv!.orgId, type: 'REPORT' } });
    if (job && fmtQ === 'csv' && (job.params as any)?.csvJobId) job = await prisma.bvExportJob.findFirst({ where: { id: (job.params as any).csvJobId, orgId: req.bv!.orgId } });
    if (!job || job.status !== 'DONE' || !job.fileKey) return sendError(reply, 404, 'report.file_not_found', 'Arquivo não encontrado');
    if (job.expiresAt && job.expiresAt < new Date()) return sendError(reply, 410, 'report.file_expired', 'Arquivo expirado');
    let buf: Buffer;
    try { buf = await getObjectBuffer(job.fileKey); } catch { return sendError(reply, 404, 'report.file_not_found', 'Arquivo não encontrado no armazenamento'); }
    await auditReq(req, 'report.download', { entityType: 'BvExportJob', entityId: job.id });
    const isCsv = job.format === 'CSV';
    return reply.header('content-type', isCsv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="relatorio-${job.id}.${isCsv ? 'csv' : 'json'}"`).header('x-content-sha256', job.sha256 ?? '').send(buf);
  });

  // ── Relatório mensal da contratada (TR 8.2.9) ──────────────────────────────
  app.post('/reports/monthly', { preHandler: exportPerm }, async (req, reply) => {
    const b = parse(z.strictObject({ month: z.string().regex(MONTH_RE, 'use YYYY-MM') }), req.body, reply); if (!b) return;
    const out = await generateMonthly(req.bv!.orgId, b.month, req.bv!.userId);
    await auditReq(req, 'report.monthly', { entityType: 'BvExportJob', entityId: out.json.jobId, meta: { month: b.month } });
    return reply.code(201).send({ jobId: out.json.jobId, csvJobId: out.csv.jobId, sha256: out.json.sha256, csvSha256: out.csv.sha256, downloadUrl: downloadUrl(out.json.jobId), document: out.document });
  });

  // ── Exportação para BI (token de API com escopo report:read) ───────────────
  app.get('/reports/export/:dataset', { preHandler: read }, async (req, reply) => {
    const ds = z.enum(DATASETS).safeParse((req.params as any).dataset);
    if (!ds.success) return sendError(reply, 404, 'report.dataset_not_found', 'Dataset inexistente', { datasets: DATASETS });
    const q = parse(z.object({ from: z.string().max(40).optional(), to: z.string().max(40).optional(), cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000), format: z.enum(['ndjson', 'csv', 'json']).default('ndjson') }), req.query, reply);
    if (!q) return;
    const orgId = req.bv!.orgId;
    let period: Period;
    try { period = resolvePeriod(q, await tzOf(orgId)); } catch (e: any) { if (e instanceof PeriodError) return sendError(reply, 400, 'report.invalid_period', e.message); throw e; }
    let page;
    try { page = await exportPage(orgId, ds.data as Dataset, period, q.cursor, q.limit); } catch (e: any) { if (e instanceof CursorError) return sendError(reply, 400, 'report.invalid_cursor', e.message); throw e; }
    await auditReq(req, 'report.export', { entityType: 'dataset', entityId: ds.data, meta: { rows: page.rows.length, via: req.bv!.via, from: period.from, to: period.to } });
    reply.header('x-next-cursor', page.nextCursor ?? '').header('x-has-more', page.nextCursor ? 'true' : 'false').header('cache-control', 'no-store');
    if (q.format === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').send(toCsv(page.columns, page.rows, { decimalComma: false, header: 'key' }));
    if (q.format === 'json') return { dataset: ds.data, count: page.rows.length, nextCursor: page.nextCursor, data: page.rows };
    return reply.header('content-type', 'application/x-ndjson; charset=utf-8').send(page.rows.map((r) => JSON.stringify(r)).join('\n') + (page.rows.length ? '\n' : ''));
  });

  // ── Painel do Fiscal ───────────────────────────────────────────────────────
  const fiscal = guard('fiscal:read');
  const quotaPerm = guard('quota:manage');
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  app.get('/fiscal/consumption', { preHandler: fiscal }, async (req, reply) => {
    const q = parse(z.object({ period: z.enum(['DAY', 'MONTH']).default('DAY'), from: z.string().regex(DAY_RE).optional(), to: z.string().regex(DAY_RE).optional(), format: z.enum(['json', 'csv']).default('json') }), req.query, reply);
    if (!q) return;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const to = q.to ? new Date(`${q.to}T00:00:00Z`) : today;
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : q.period === 'DAY' ? new Date(to.getTime() - 29 * 86400_000) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 5, 1));
    if (from > to || (to.getTime() - from.getTime()) / 86400_000 > 800) return sendError(reply, 400, 'report.invalid_period', 'Período inválido (máx. 800 dias)');
    const r = await consumption(req.bv!.orgId, { period: q.period, from, to });
    if (q.format === 'csv') {
      const rows = r.items.flatMap((i) => i.series.map((s: any) => ({ item: i.item, trItem: i.trItem ?? '', label: i.label, unit: i.unit, bucket: s.day ?? s.month, quantity: s.quantity, unitPrice: i.unitPrice, estimatedCost: s.estimatedCost ?? '' })));
      return sendCsv(reply, 'consumo', [{ key: 'item', label: 'Item' }, { key: 'trItem', label: 'Item do TR' }, { key: 'label', label: 'Descrição' }, { key: 'unit', label: 'Unidade' }, { key: 'bucket', label: q.period === 'DAY' ? 'Dia' : 'Mês' }, { key: 'quantity', label: 'Quantidade' }, { key: 'unitPrice', label: 'Preço unitário estimado (R$)' }, { key: 'estimatedCost', label: 'Custo estimado (R$)' }], rows);
    }
    return r;
  });

  app.get('/fiscal/dashboard', { preHandler: fiscal }, async (req) => dashboard(req.bv!.orgId));

  app.get('/fiscal/quotas', { preHandler: fiscal }, async (req) => ({ quotas: await listQuotas(req.bv!.orgId) }));

  const quotaBody = z.strictObject({
    item: z.enum(USAGE_ITEMS), period: z.enum(['DAY', 'MONTH']),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), action: z.enum(['ALERT', 'BLOCK']).default('ALERT'), alertAtPct: z.number().int().min(1).max(100).default(80),
  });

  app.post('/fiscal/quotas', { preHandler: quotaPerm }, async (req, reply) => {
    const b = parse(quotaBody, req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvQuota.findUnique({ where: { orgId_item_period: { orgId, item: b.item, period: b.period } } });
    const row = await prisma.bvQuota.upsert({
      where: { orgId_item_period: { orgId, item: b.item, period: b.period } },
      create: { orgId, item: b.item, period: b.period, limit: BigInt(b.limit), action: b.action, alertAtPct: b.alertAtPct, updatedById: req.bv!.userId },
      update: { limit: BigInt(b.limit), action: b.action, alertAtPct: b.alertAtPct, updatedById: req.bv!.userId },
    });
    const snap = { item: row.item, period: row.period, limit: Number(row.limit), action: row.action, alertAtPct: row.alertAtPct };
    const version = await recordConfigVersion(orgId, 'quota', row.id, snap, req.bv!.userId);
    await auditReq(req, before ? 'quota.update' : 'quota.create', { entityType: 'BvQuota', entityId: row.id, before: before ? { limit: Number(before.limit), action: before.action, alertAtPct: before.alertAtPct } : undefined, after: snap });
    return reply.code(before ? 200 : 201).send({ id: row.id, ...snap, version });
  });

  app.put('/fiscal/quotas/:id', { preHandler: quotaPerm }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const b = parse(quotaBody.pick({ limit: true, action: true, alertAtPct: true }).partial(), req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvQuota.findFirst({ where: { id, orgId } });
    if (!before) return sendError(reply, 404, 'quota.not_found', 'Cota não encontrada');
    const row = await prisma.bvQuota.update({ where: { id }, data: { ...(b.limit != null ? { limit: BigInt(b.limit) } : {}), ...(b.action ? { action: b.action } : {}), ...(b.alertAtPct ? { alertAtPct: b.alertAtPct } : {}), updatedById: req.bv!.userId } });
    const snap = { item: row.item, period: row.period, limit: Number(row.limit), action: row.action, alertAtPct: row.alertAtPct };
    const version = await recordConfigVersion(orgId, 'quota', row.id, snap, req.bv!.userId);
    await auditReq(req, 'quota.update', { entityType: 'BvQuota', entityId: id, before: { limit: Number(before.limit), action: before.action, alertAtPct: before.alertAtPct }, after: snap });
    return { id, ...snap, version };
  });

  app.delete('/fiscal/quotas/:id', { preHandler: quotaPerm }, async (req, reply) => {
    const { id } = parse(idParam, req.params, reply) ?? {}; if (!id) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvQuota.findFirst({ where: { id, orgId } });
    if (!before) return sendError(reply, 404, 'quota.not_found', 'Cota não encontrada');
    await prisma.bvQuota.deleteMany({ where: { id, orgId } });
    await recordConfigVersion(orgId, 'quota', id, { deleted: true, item: before.item, period: before.period }, req.bv!.userId);
    await auditReq(req, 'quota.delete', { entityType: 'BvQuota', entityId: id, before: { item: before.item, period: before.period, limit: Number(before.limit) } });
    return reply.code(204).send();
  });

}
