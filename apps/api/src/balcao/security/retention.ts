import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { audit } from '../core/audit';
import { registerJob, runExclusive } from '../core/scheduler';
import { getOrgSettings } from '../core/settings';
import { deleteObject } from '../core/storage';
import { activeLegalHold, DAY_MS, getSecuritySettings, minAuditDays } from './config';
import { ENC_HISTORY_FIELDS } from '../tasks/content';

/**
 * Política de retenção por órgão (settings.retention), aplicada em lotes pequenos e retomáveis:
 *  - MESSAGES    mensagens além de `messagesDays`: corpo, anexos (arquivos no storage) e metadados do canal são
 *                removidos; a linha permanece (data, direção, status) para manter os agregados dos relatórios.
 *                O mesmo prazo vale para o TEXTO das tarefas ENCERRADAS (descrição, comentários, histórico de
 *                descrição/resolução): o texto sai, a tarefa e o título ficam (métricas de ISA/IOSA/IR).
 *  - RECORDINGS  chamadas além de `recordingsDays`: gravação removida do storage e números mascarados.
 *  - LOGS        BvIntegrationLog além de `logsDays`.
 *  - AUDIT       trilha de auditoria somente além de max(`auditDays`, BV_AUDIT_MIN_DAYS).
 * Guarda legal ativa (settings.security.legalHold) suspende MESSAGES/RECORDINGS/AUDIT. Cada execução grava
 * BvRetentionRun por tipo e uma entrada de auditoria. `dryRun` só conta.
 */
export type RetentionKind = 'MESSAGES' | 'RECORDINGS' | 'LOGS' | 'AUDIT';
export interface RetentionKindResult { kind: RetentionKind; cutoff: string | null; candidates?: number; purged: number; skipped?: string; more: boolean; /** MESSAGES: tarefas encerradas cujo texto foi removido (em dryRun, candidatas) */ tasks?: number }
export interface RetentionResult { orgId: string; dryRun: boolean; legalHold: boolean; kinds: RetentionKindResult[] }
export interface RetentionOptions { dryRun?: boolean; batchSize?: number; maxBatches?: number; now?: Date }

const keyBelongsToOrg = (orgId: string, key: unknown): key is string => typeof key === 'string' && key.startsWith(`${orgId}/`);

/** `***1234`: preserva só os 4 últimos dígitos. Idempotente. */
export const maskNumber = (n: string): string => (n.startsWith('***') ? n : `***${n.replace(/\D/g, '').slice(-4)}`);

/**
 * Sugestões de IA (BvConversationEvent AI_SUGGESTION) guardam texto cifrado derivado da conversa em `data.textEnc`.
 * Remove o texto (o evento fica, sem conteúdo, para métricas). Usado na retenção (`before`) e na anonimização (`conversationIds`).
 */
export async function scrubAiSuggestions(orgId: string, scope: { before?: Date; conversationIds?: string[] }, batchSize = 200, maxBatches = 1000): Promise<number> {
  const where: Prisma.BvConversationEventWhereInput = {
    orgId, type: 'AI_SUGGESTION', data: { path: ['textEnc'], string_starts_with: 'bv1.' },
    ...(scope.before ? { createdAt: { lt: scope.before } } : {}), ...(scope.conversationIds ? { conversationId: { in: scope.conversationIds } } : {}),
  };
  let n = 0;
  for (let b = 0; b < maxBatches; b++) {
    const rows = await prisma.bvConversationEvent.findMany({ where, select: { id: true, data: true }, take: batchSize });
    if (!rows.length) break;
    for (const r of rows) {
      const { textEnc: _t, ...rest } = (r.data ?? {}) as Record<string, unknown>;
      void _t;
      await prisma.bvConversationEvent.update({ where: { id: r.id }, data: { data: { ...rest, scrubbed: true } as any } });
      n++;
    }
    if (rows.length < batchSize) break;
  }
  return n;
}

export const TASK_RETENTION_MARKER = '[texto removido pela política de retenção]';

/**
 * Remove o texto livre de tarefas: descrição (→ `descriptionTo`), corpo dos comentários (→ `marker`) e valores de histórico
 * de `description`/`resolution` (→ null). Título e metadados ficam. Idempotente (só toca o que ainda tem texto).
 * Usado pela retenção (tarefas encerradas antigas) e pelo atendimento de DSR (tarefas do titular).
 */
export async function scrubTaskText(orgId: string, where: Prisma.BvTaskWhereInput, marker: string, descriptionTo: string | null): Promise<{ tasks: number; comments: number; history: number }> {
  const taskScope: Prisma.BvTaskWhereInput = { orgId, AND: [where] };
  const tasks = await prisma.bvTask.updateMany({ where: { ...taskScope, description: descriptionTo === null ? { not: null } : { not: descriptionTo } }, data: { description: descriptionTo } });
  const comments = await prisma.bvTaskComment.updateMany({ where: { task: taskScope, NOT: { body: marker } }, data: { body: marker } });
  const history = await prisma.bvTaskHistory.updateMany({
    where: { task: taskScope, field: { in: [...ENC_HISTORY_FIELDS] }, OR: [{ fromValue: { not: null } }, { toValue: { not: null } }] }, data: { fromValue: null, toValue: null },
  });
  return { tasks: tasks.count, comments: comments.count, history: history.count };
}

async function purgeTaskText(orgId: string, cutoff: Date, dry: boolean): Promise<number> {
  const where: Prisma.BvTaskWhereInput = { createdAt: { lt: cutoff }, status: { in: ['DONE', 'CANCELLED'] } };
  if (dry) {
    return prisma.bvTask.count({ where: { orgId, AND: [where], OR: [{ description: { not: null } }, { comments: { some: { NOT: { body: TASK_RETENTION_MARKER } } } }] } });
  }
  const r = await scrubTaskText(orgId, where, TASK_RETENTION_MARKER, null);
  return r.tasks + r.comments + r.history;
}

async function purgeMessages(orgId: string, cutoff: Date, dry: boolean, batchSize: number, maxBatches: number) {
  const where: Prisma.BvMessageWhereInput = { orgId, createdAt: { lt: cutoff }, OR: [{ body: { not: null } }, { attachments: { not: Prisma.DbNull } }] };
  if (dry) return { candidates: await prisma.bvMessage.count({ where }), purged: 0, more: false, files: 0, suggestions: 0, tasks: await purgeTaskText(orgId, cutoff, true) };
  let purged = 0; let files = 0; let more = false;
  for (let b = 0; b < maxBatches; b++) {
    const rows = await prisma.bvMessage.findMany({ where, select: { id: true, attachments: true }, orderBy: { createdAt: 'asc' }, take: batchSize });
    if (!rows.length) break;
    for (const r of rows) {
      for (const a of Array.isArray(r.attachments) ? (r.attachments as any[]) : []) {
        if (keyBelongsToOrg(orgId, a?.key)) { await deleteObject(a.key).catch(() => undefined); files++; }
      }
    }
    await prisma.bvMessage.updateMany({ where: { id: { in: rows.map((r) => r.id) }, orgId }, data: { body: null, attachments: Prisma.DbNull, channelMeta: Prisma.DbNull } });
    purged += rows.length;
    if (rows.length < batchSize) break;
    if (b === maxBatches - 1) more = true;
  }
  const suggestions = await scrubAiSuggestions(orgId, { before: cutoff }, batchSize, maxBatches);
  const tasks = await purgeTaskText(orgId, cutoff, false);
  return { candidates: undefined, purged, more, files, suggestions, tasks };
}

async function purgeRecordings(orgId: string, cutoff: Date, dry: boolean, batchSize: number, maxBatches: number) {
  const where: Prisma.BvCallWhereInput = { orgId, startedAt: { lt: cutoff }, OR: [{ recordingKey: { not: null } }, { NOT: { fromNumber: { startsWith: '***' } } }, { NOT: { toNumber: { startsWith: '***' } } }] };
  if (dry) return { candidates: await prisma.bvCall.count({ where }), purged: 0, more: false, files: 0 };
  let purged = 0; let files = 0; let more = false;
  for (let b = 0; b < maxBatches; b++) {
    const rows = await prisma.bvCall.findMany({ where, select: { id: true, recordingKey: true, fromNumber: true, toNumber: true }, orderBy: { startedAt: 'asc' }, take: batchSize });
    if (!rows.length) break;
    for (const r of rows) if (keyBelongsToOrg(orgId, r.recordingKey)) { await deleteObject(r.recordingKey).catch(() => undefined); files++; }
    await prisma.$transaction(rows.map((r) => prisma.bvCall.update({
      where: { id: r.id },
      data: { recordingKey: null, recordingSha256: null, recordingSizeBytes: null, fromNumber: maskNumber(r.fromNumber), toNumber: maskNumber(r.toNumber) },
    })));
    purged += rows.length;
    if (rows.length < batchSize) break;
    if (b === maxBatches - 1) more = true;
  }
  return { candidates: undefined, purged, more, files };
}

async function purgeByIds(kind: 'LOGS' | 'AUDIT', orgId: string, cutoff: Date, dry: boolean, batchSize: number, maxBatches: number) {
  const find = (take: number) => (kind === 'LOGS'
    ? prisma.bvIntegrationLog.findMany({ where: { orgId, createdAt: { lt: cutoff } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take })
    : prisma.bvAuditLog.findMany({ where: { orgId, createdAt: { lt: cutoff } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take }));
  if (dry) {
    const candidates = kind === 'LOGS' ? await prisma.bvIntegrationLog.count({ where: { orgId, createdAt: { lt: cutoff } } }) : await prisma.bvAuditLog.count({ where: { orgId, createdAt: { lt: cutoff } } });
    return { candidates, purged: 0, more: false, files: 0, from: undefined as Date | undefined };
  }
  let purged = 0; let more = false; let from: Date | undefined;
  if (kind === 'AUDIT') from = (await prisma.bvAuditLog.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt;
  for (let b = 0; b < maxBatches; b++) {
    const rows = await find(batchSize);
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    const res = kind === 'LOGS' ? await prisma.bvIntegrationLog.deleteMany({ where: { id: { in: ids }, orgId } }) : await prisma.bvAuditLog.deleteMany({ where: { id: { in: ids }, orgId } });
    purged += res.count;
    if (rows.length < batchSize) break;
    if (b === maxBatches - 1) more = true;
  }
  return { candidates: undefined, purged, more, files: 0, from };
}

/** Remove arquivos de exportação vencidos (BvExportJob.expiresAt) — resultados de DSR e de fim de contrato. */
export async function purgeExpiredExports(orgId: string, now = new Date(), dry = false): Promise<number> {
  const jobs = await prisma.bvExportJob.findMany({ where: { orgId, expiresAt: { lt: now }, fileKey: { not: null } }, select: { id: true, fileKey: true, params: true }, take: 200 });
  if (dry) return jobs.length;
  for (const j of jobs) {
    if (keyBelongsToOrg(orgId, j.fileKey)) await deleteObject(j.fileKey).catch(() => undefined);
    await prisma.bvExportJob.update({ where: { id: j.id }, data: { fileKey: null, params: { ...(j.params as object ?? {}), expired: true } as any } });
  }
  return jobs.length;
}

export async function runRetentionForOrg(orgId: string, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const dry = !!opts.dryRun;
  const now = opts.now ?? new Date();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 1000);
  const maxBatches = Math.max(opts.maxBatches ?? 25, 1);
  const settings = await getOrgSettings(orgId);
  const hold = activeLegalHold((await getSecuritySettings(orgId)).legalHold, now);
  const r = settings.retention;
  const days = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const kinds: RetentionKindResult[] = [];

  const plan: Array<{ kind: RetentionKind; days: number | null; held: boolean }> = [
    { kind: 'MESSAGES', days: days(r.messagesDays), held: !!hold },
    { kind: 'RECORDINGS', days: days(r.recordingsDays), held: !!hold },
    { kind: 'LOGS', days: days(r.logsDays), held: false },
    { kind: 'AUDIT', days: days(r.auditDays) === null ? null : Math.max(days(r.auditDays)!, minAuditDays()), held: !!hold },
  ];

  for (const p of plan) {
    if (p.days === null) { kinds.push({ kind: p.kind, cutoff: null, purged: 0, skipped: 'prazo não configurado', more: false }); continue; }
    if (p.held) { kinds.push({ kind: p.kind, cutoff: null, purged: 0, skipped: 'guarda legal ativa', more: false }); continue; }
    const cutoff = new Date(now.getTime() - p.days * DAY_MS);
    let res: { candidates?: number; purged: number; more: boolean; files: number; from?: Date; suggestions?: number; tasks?: number };
    try {
      res = p.kind === 'MESSAGES' ? await purgeMessages(orgId, cutoff, dry, batchSize, maxBatches)
        : p.kind === 'RECORDINGS' ? await purgeRecordings(orgId, cutoff, dry, batchSize, maxBatches)
          : await purgeByIds(p.kind, orgId, cutoff, dry, batchSize, maxBatches);
    } catch (err: any) {
      logger.error({ err: err?.message, orgId, kind: p.kind }, '[balcao.security] retenção falhou');
      kinds.push({ kind: p.kind, cutoff: cutoff.toISOString(), purged: 0, skipped: 'erro: ' + String(err?.message ?? err).slice(0, 120), more: false });
      continue;
    }
    kinds.push({ kind: p.kind, cutoff: cutoff.toISOString(), ...(dry ? { candidates: res.candidates } : {}), purged: res.purged, more: res.more, ...(res.tasks != null ? { tasks: res.tasks } : {}) });
    if (!dry) {
      await prisma.bvRetentionRun.create({ data: { orgId, kind: p.kind, purged: res.purged, cutoff } });
      if (res.purged > 0 || res.tasks) {
        await audit({
          orgId, actorType: 'SYSTEM', action: `retention.${p.kind.toLowerCase()}`, entityType: 'retention',
          meta: { cutoff: cutoff.toISOString(), purged: res.purged, files: res.files, ...(res.suggestions ? { aiSuggestionsScrubbed: res.suggestions } : {}), ...(res.tasks ? { taskTextScrubbed: res.tasks } : {}), ...(res.from ? { oldestPurged: res.from.toISOString() } : {}), more: res.more },
        });
      }
    }
  }
  const expired = await purgeExpiredExports(orgId, now, dry);
  if (expired && !dry) await audit({ orgId, actorType: 'SYSTEM', action: 'retention.exports', entityType: 'retention', meta: { expired } });
  return { orgId, dryRun: dry, legalHold: !!hold, kinds };
}

/** Execução exclusiva por órgão (job e endpoint manual não se sobrepõem). Retorna null se já houver uma em andamento. */
export async function runRetentionExclusive(orgId: string, opts: RetentionOptions = {}): Promise<RetentionResult | null> {
  const r = await runExclusive(`security.retention:${orgId}`, 900, () => runRetentionForOrg(orgId, opts));
  return r ?? null;
}

export async function runRetentionAllOrgs(): Promise<void> {
  const orgs = await prisma.bvOrg.findMany({ select: { id: true } });
  for (const o of orgs) {
    try { await runRetentionExclusive(o.id); } catch (err: any) { logger.error({ err: err?.message, orgId: o.id }, '[balcao.security] retenção do órgão falhou'); }
  }
}

registerJob('balcao.security.retention', { intervalMs: 24 * 3600_000, lockTtlSec: 3600 }, runRetentionAllOrgs);
