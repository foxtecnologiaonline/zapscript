import type { BvReportSchedule } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { sendEmail } from '../../lib/mailer';
import { getOrgSettings } from '../core/settings';
import { newKey, putObject } from '../core/storage';
import { registerJob } from '../core/scheduler';
import { customDefinitionSchema, runCustom, type CustomDefinition } from './custom';
import { nextRunAfter, toCsv, validTz, type Preset, type ScheduleSpec } from './util';

/** Relatórios salvos + agendamento + geração de arquivo (BvExportJob type REPORT). */

export type Mailer = (to: string, subject: string, html: string) => Promise<void>;
let mailer: Mailer = sendEmail;
/** Injeta o envio de e-mail (testes). Sem argumento, restaura o mailer real. */
export const setReportMailer = (m?: Mailer) => { mailer = m ?? sendEmail; };

export const FREQ_PRESET: Record<'DAILY' | 'WEEKLY' | 'MONTHLY', Preset> = { DAILY: 'YESTERDAY', WEEKLY: 'PREVIOUS_WEEK', MONTHLY: 'PREVIOUS_MONTH' };
export const REPORT_TTL_DAYS = 180;

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const publicApiUrl = () => (process.env.BV_PUBLIC_API_URL || 'https://api.zapscript.me').replace(/\/$/, '');
export const downloadUrl = (jobId: string) => `${publicApiUrl()}/balcao/reports/exports/${jobId}/download`;

/** Restrição opcional de domínios de destinatário (BV_REPORT_ALLOWED_DOMAINS=tjto.jus.br,...). */
export function recipientAllowed(email: string): boolean {
  const list = (process.env.BV_REPORT_ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const dom = email.split('@')[1]?.toLowerCase();
  return !!dom && list.some((d) => dom === d || dom.endsWith(`.${d}`));
}

export interface StoredReport { jobId: string; fileKey: string; sha256: string; sizeBytes: number }

/** Grava o arquivo em core/storage e registra o BvExportJob (sha256 + tamanho). */
export async function storeReportFile(orgId: string, content: string | Buffer, format: 'CSV' | 'JSON', params: Record<string, unknown>, createdById?: string | null): Promise<StoredReport> {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const key = newKey(orgId, 'exports', format.toLowerCase());
  const obj = await putObject(key, buf);
  const job = await prisma.bvExportJob.create({
    data: {
      orgId, type: 'REPORT', format, params: params as any, status: 'DONE', fileKey: obj.key, sha256: obj.sha256, sizeBytes: BigInt(obj.size),
      createdById: createdById ?? null, finishedAt: new Date(), expiresAt: new Date(Date.now() + REPORT_TTL_DAYS * 86400_000),
    },
  });
  return { jobId: job.id, fileKey: obj.key, sha256: obj.sha256, sizeBytes: obj.size };
}

export function renderResult(result: Awaited<ReturnType<typeof runCustom>>, format: 'CSV' | 'JSON'): string {
  if (format === 'JSON') return JSON.stringify({ period: result.period, columns: result.columns, rows: result.rows }, null, 2);
  return toCsv(result.columns, result.rows);
}

export interface RunOutcome { status: 'DONE' | 'SKIPPED' | 'FAILED'; jobId?: string; sent: string[]; failed: string[]; error?: string }

function specOf(s: BvReportSchedule): ScheduleSpec {
  const p = (s.params ?? {}) as any;
  return { frequency: s.frequency as ScheduleSpec['frequency'], hour: p.hour, weekday: p.weekday, dayOfMonth: p.dayOfMonth };
}

/** Executa um relatório salvo: gera arquivo, registra BvExportJob e (opcional) envia o link por e-mail. */
export async function executeSavedReport(s: BvReportSchedule, runKey: string, opts: { send: boolean; now?: Date; createdById?: string | null }): Promise<RunOutcome> {
  const now = opts.now ?? new Date();
  // idempotência por execução: mesma runKey nunca gera/envia duas vezes
  const dup = await prisma.bvExportJob.findFirst({ where: { orgId: s.orgId, type: 'REPORT', params: { path: ['runKey'], equals: runKey } }, select: { id: true } });
  if (dup) return { status: 'SKIPPED', jobId: dup.id, sent: [], failed: [] };
  try {
    const tz = validTz((await getOrgSettings(s.orgId)).timezone);
    const parsed = customDefinitionSchema.safeParse((s.params as any)?.definition);
    if (!parsed.success) throw new Error('definição do relatório inválida');
    const def: CustomDefinition = parsed.data;
    const result = await runCustom(s.orgId, def, tz, now);
    const format = s.format === 'JSON' ? 'JSON' : 'CSV';
    const stored = await storeReportFile(s.orgId, renderResult(result, format), format, { kind: 'SAVED', scheduleId: s.id, name: s.name, runKey, period: result.period, rows: result.rows.length }, opts.createdById);
    const sent: string[] = [], failed: string[] = [];
    if (opts.send) {
      const preview = result.rows.slice(0, 15);
      const html = `<p>Relatório <b>${esc(s.name)}</b> — período ${esc(result.period.fromLocal)} a ${esc(result.period.toLocal)} (${esc(result.period.timezone)}).</p>`
        + `<p>${result.rows.length} linha(s). Baixe o arquivo autenticado (${format}, sha256 <code>${stored.sha256.slice(0, 16)}…</code>): <a href="${esc(downloadUrl(stored.jobId))}">${esc(downloadUrl(stored.jobId))}</a></p>`
        + `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr>${result.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>`
        + preview.map((r) => `<tr>${result.columns.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`).join('') + '</table>';
      for (const to of s.recipients) {
        try { await mailer(to, `Relatório agendado: ${s.name}`, html); sent.push(to); } catch (err: any) { failed.push(to); logger.warn({ err: err?.message }, '[balcao] envio de relatório falhou'); }
      }
      await prisma.bvExportJob.update({ where: { id: stored.jobId }, data: { params: { kind: 'SAVED', scheduleId: s.id, name: s.name, runKey, period: result.period, rows: result.rows.length, mail: { sent, failed } } as any, ...(failed.length && !sent.length ? { error: 'falha no envio de todos os e-mails' } : {}) } });
    }
    return { status: 'DONE', jobId: stored.jobId, sent, failed };
  } catch (err: any) {
    logger.error({ err: err?.message, scheduleId: s.id }, '[balcao] geração de relatório agendado falhou');
    await prisma.bvExportJob.create({ data: { orgId: s.orgId, type: 'REPORT', format: s.format, status: 'FAILED', error: String(err?.message ?? err).slice(0, 500), params: { kind: 'SAVED', scheduleId: s.id, runKey } as any, finishedAt: new Date() } }).catch(() => undefined);
    return { status: 'FAILED', sent: [], failed: [], error: err?.message };
  }
}

/**
 * Executa os agendamentos vencidos. A execução é "reivindicada" por UPDATE condicional em nextRunAt
 * (só uma instância vence) e a runKey `<id>:<nextRunAt>` impede reprocessar a mesma ocorrência.
 */
export async function runDueSchedules(now = new Date()): Promise<RunOutcome[]> {
  const due = await prisma.bvReportSchedule.findMany({ where: { active: true, nextRunAt: { lte: now }, frequency: { in: ['DAILY', 'WEEKLY', 'MONTHLY'] } }, orderBy: { nextRunAt: 'asc' }, take: 50 });
  const out: RunOutcome[] = [];
  for (const s of due) {
    const tz = validTz((await getOrgSettings(s.orgId)).timezone);
    const next = nextRunAfter(specOf(s), now, tz);
    const claim = await prisma.bvReportSchedule.updateMany({ where: { id: s.id, active: true, nextRunAt: s.nextRunAt }, data: { nextRunAt: next, lastRunAt: now } });
    if (claim.count !== 1) continue;
    out.push(await executeSavedReport(s, `${s.id}:${s.nextRunAt!.toISOString()}`, { send: s.recipients.length > 0, now }));
  }
  return out;
}

export function registerScheduleJob(): void {
  registerJob('balcao.reports.schedule', { intervalMs: 60_000, lockTtlSec: 300 }, async () => { await runDueSchedules(); });
}
