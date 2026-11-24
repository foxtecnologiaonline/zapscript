import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PassThrough, type Readable } from 'stream';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { audit } from '../core/audit';
import { decryptField, decryptJson } from '../core/crypto';
import { isFreeTextField } from '../tasks/content';
import { runExclusive, registerJob } from '../core/scheduler';
import { deleteObject, getObjectStream, newKey, putObject, statObject, storageRoot } from '../core/storage';
import { FORMAT_EXT, makeFormatter, type ColumnDef, type ExportFormat } from './formats';
import { TarWriter } from './tar';

/**
 * Exportação integral de fim de contrato (TR 7.1.14.2): um único .tar.gz com os dados do órgão em JSON/CSV/XML/SQL,
 * cópia dos anexos e gravações e `manifest.json` (sha256, bytes e linhas de cada arquivo). Streaming de ponta a ponta:
 * cada entidade é escrita em arquivo temporário (tamanho conhecido para o cabeçalho tar) e anexada ao tar, que passa
 * por gzip direto para o storage — memória constante.
 */
export const EXPORT_TTL_DAYS = 7;
export interface FullExportParams { includeDocuments?: boolean; includeFiles?: boolean; progress?: unknown; requestedBy?: string }

interface EntitySpec {
  name: string; model: string; where: (orgId: string) => any; exclude?: string[]; paged?: boolean;
  extra?: ColumnDef[]; transform?: (row: any, ctx: { includeDocuments: boolean }) => any;
}

const bySlot = (rel: string) => (orgId: string) => ({ [rel]: { orgId } });
const orgWhere = (orgId: string) => ({ orgId });

const SECRET_KEY = /(secret|token|password|senha|key|pass|credential|authorization|auth|private|cert|pem|signature|dsn|hmac|salt|pin)/i;
/** Config de integração sem segredos: valores de chaves suspeitas viram "[removido]"; URLs perdem credenciais embutidas. */
export function redactConfig(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.map((x) => redactConfig(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SECRET_KEY.test(k) && val ? '[removido]' : redactConfig(val, depth + 1)]));
  }
  if (typeof v === 'string' && /^[a-z]+:\/\/[^/\s]*@/i.test(v)) return v.replace(/\/\/[^/@\s]*@/, '//[removido]@');
  return v;
}

const safeBody = (b: string | null) => { try { return b ? decryptField(b) : null; } catch { return '[ilegível: chave de campo ausente]'; } };

/** Sugestões de IA guardam o texto cifrado em data.textEnc: exporta decifrado em data.text (sem o campo cifrado). */
function decryptEventData(r: any) {
  const d = r.data;
  if (!d || typeof d !== 'object' || typeof d.textEnc !== 'string') return r;
  const { textEnc, ...rest } = d;
  let text: string; try { text = decryptField(textEnc); } catch { text = '[ilegível: chave de campo ausente]'; }
  return { ...r, data: { ...rest, text } };
}

export const ENTITIES: EntitySpec[] = [
  { name: 'org', model: 'BvOrg', where: (o) => ({ id: o }) },
  { name: 'users', model: 'BvUser', where: orgWhere, exclude: ['passwordHash', 'totpSecretEnc'] },
  { name: 'sectors', model: 'BvSector', where: orgWhere },
  { name: 'holidays', model: 'BvHoliday', where: orgWhere },
  { name: 'canned_responses', model: 'BvCannedResponse', where: orgWhere },
  { name: 'queues', model: 'BvQueue', where: orgWhere },
  { name: 'queue_members', model: 'BvQueueMember', where: bySlot('queue'), paged: false },
  { name: 'routing_rules', model: 'BvRoutingRule', where: orgWhere },
  { name: 'ivr_flows', model: 'BvIvrFlow', where: orgWhere }, // todas as versões
  { name: 'config_versions', model: 'BvConfigVersion', where: orgWhere },
  { name: 'kb_articles', model: 'BvKbArticle', where: orgWhere },
  { name: 'kb_article_versions', model: 'BvKbArticleVersion', where: bySlot('article') },
  { name: 'kb_suggestions', model: 'BvKbSuggestion', where: orgWhere },
  { name: 'contacts', model: 'BvContact', where: orgWhere, exclude: ['documentEnc', 'documentHash'], extra: [{ name: 'document', type: 'String' }] },
  { name: 'contact_identities', model: 'BvContactIdentity', where: orgWhere },
  { name: 'conversations', model: 'BvConversation', where: orgWhere },
  { name: 'conversation_events', model: 'BvConversationEvent', where: orgWhere, transform: (r) => decryptEventData(r) },
  { name: 'messages', model: 'BvMessage', where: orgWhere, transform: (r) => ({ ...r, body: safeBody(r.body) }) },
  { name: 'calls', model: 'BvCall', where: orgWhere },
  // texto de tarefas é cifrado em repouso (tasks/content.ts): a exportação sai DECIFRADA
  { name: 'tasks', model: 'BvTask', where: orgWhere, transform: (r) => ({ ...r, description: safeBody(r.description) }) },
  { name: 'task_comments', model: 'BvTaskComment', where: bySlot('task'), transform: (r) => ({ ...r, body: safeBody(r.body) }) },
  { name: 'task_history', model: 'BvTaskHistory', where: bySlot('task'), transform: (r) => (isFreeTextField(r.field) ? { ...r, fromValue: safeBody(r.fromValue), toValue: safeBody(r.toValue) } : r) },
  { name: 'audit_log', model: 'BvAuditLog', where: orgWhere },
  { name: 'usage_daily', model: 'BvUsageDaily', where: orgWhere },
  { name: 'quotas', model: 'BvQuota', where: orgWhere },
  { name: 'counters', model: 'BvCounter', where: orgWhere, paged: false },
  { name: 'wa_templates', model: 'BvWaTemplate', where: orgWhere },
  {
    name: 'integrations', model: 'BvIntegration', where: orgWhere, exclude: ['configEnc'], extra: [{ name: 'config', type: 'Json' }],
    transform: (r) => { let config: unknown = {}; try { config = r.configEnc ? redactConfig(decryptJson(r.configEnc)) : {}; } catch { config = { erro: 'config ilegível' }; } return { ...r, config }; },
  },
  { name: 'integration_logs', model: 'BvIntegrationLog', where: orgWhere },
  { name: 'mailboxes', model: 'BvMailbox', where: orgWhere },
  { name: 'webchat_sessions', model: 'BvWebchatSession', where: orgWhere, exclude: ['tokenHash'] },
  { name: 'api_tokens', model: 'BvApiToken', where: orgWhere, exclude: ['tokenHash'] },
  { name: 'report_schedules', model: 'BvReportSchedule', where: orgWhere },
  { name: 'data_subject_requests', model: 'BvDataSubjectRequest', where: orgWhere },
  { name: 'retention_runs', model: 'BvRetentionRun', where: orgWhere },
  { name: 'notifications', model: 'BvNotification', where: orgWhere },
];

function columnsOf(spec: EntitySpec): ColumnDef[] {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === spec.model);
  if (!m) throw new Error(`modelo ${spec.model} inexistente`);
  const cols = m.fields.filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !(spec.exclude ?? []).includes(f.name)).map((f) => ({ name: f.name, type: f.type, list: f.isList }));
  return [...cols, ...(spec.extra ?? [])];
}
const delegate = (model: string) => (prisma as any)[model.charAt(0).toLowerCase() + model.slice(1)];

class FileSink {
  hash = crypto.createHash('sha256'); bytes = 0;
  private ws: fs.WriteStream;
  constructor(readonly file: string) { this.ws = fs.createWriteStream(file, { mode: 0o600 }); }
  async write(s: string): Promise<void> {
    if (!s) return;
    const b = Buffer.from(s, 'utf8');
    this.hash.update(b); this.bytes += b.length;
    if (!this.ws.write(b)) await new Promise<void>((res, rej) => { this.ws.once('drain', res); this.ws.once('error', rej); });
  }
  close(): Promise<void> { return new Promise((res, rej) => { this.ws.once('error', rej); this.ws.end(res); }); }
}

export interface ManifestFile { path: string; kind: 'data' | 'file'; sha256: string; bytes: number; rows?: number; entity?: string; sourceKey?: string }

async function setProgress(jobId: string, progress: Record<string, unknown>) {
  const j = await prisma.bvExportJob.findUnique({ where: { id: jobId }, select: { params: true } });
  await prisma.bvExportJob.update({ where: { id: jobId }, data: { params: { ...((j?.params as object) ?? {}), progress } as any } }).catch(() => undefined);
}

/** Itera chaves de arquivos (anexos de mensagens e gravações de chamadas) sem carregar tudo em memória. */
async function* fileRefs(orgId: string): AsyncGenerator<{ key: string; owner: string }> {
  let cursor: string | undefined;
  for (;;) {
    const rows: Array<{ id: string; attachments: Prisma.JsonValue }> = await prisma.bvMessage.findMany({ where: { orgId, attachments: { not: Prisma.DbNull } }, select: { id: true, attachments: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const r of rows) for (const a of Array.isArray(r.attachments) ? (r.attachments as any[]) : []) if (typeof a?.key === 'string') yield { key: a.key, owner: `message:${r.id}` };
    cursor = rows[rows.length - 1].id;
  }
  cursor = undefined;
  for (;;) {
    const rows: Array<{ id: string; recordingKey: string | null }> = await prisma.bvCall.findMany({ where: { orgId, recordingKey: { not: null } }, select: { id: true, recordingKey: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const r of rows) yield { key: r.recordingKey!, owner: `call:${r.id}` };
    cursor = rows[rows.length - 1].id;
  }
}

export async function createFullExportJob(orgId: string, format: ExportFormat, params: FullExportParams, actorId: string | null) {
  return prisma.bvExportJob.create({ data: { orgId, type: 'FULL_EXPORT', format, params: params as any, createdById: actorId, status: 'PENDING' } });
}

/** Executa o job (reivindica PENDING→RUNNING de forma atômica; devolve null se outro processo pegou). */
export async function runFullExport(jobId: string): Promise<{ status: 'DONE' | 'FAILED'; manifest?: any } | null> {
  const claim = await prisma.bvExportJob.updateMany({ where: { id: jobId, status: 'PENDING', type: 'FULL_EXPORT' }, data: { status: 'RUNNING' } });
  if (!claim.count) return null;
  const job = await prisma.bvExportJob.findUniqueOrThrow({ where: { id: jobId } });
  const { orgId } = job;
  const format = job.format as ExportFormat;
  const params = (job.params ?? {}) as FullExportParams;
  const includeDocuments = params.includeDocuments === true;
  const includeFiles = params.includeFiles !== false;
  const tmpDir = path.join(storageRoot(), orgId, 'tmp', `export-${jobId}`);
  const fileKey = newKey(orgId, 'exports', 'tgz');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const pass = new PassThrough({ highWaterMark: 1 << 20 });
  const gz = zlib.createGzip({ level: 6 });
  pass.on('error', (e) => gz.destroy(e));
  pass.pipe(gz);
  const storing = putObject(fileKey, gz as unknown as Readable);
  storing.catch(() => undefined);
  const tar = new TarWriter(pass);

  try {
    const total = (await Promise.all(ENTITIES.map((e) => delegate(e.model).count({ where: e.where(orgId) })))).reduce((a: number, b: number) => a + b, 0);
    let done = 0; let lastTick = 0;
    const tick = async (entity: string, force = false) => {
      if (!force && Date.now() - lastTick < 1500) return;
      lastTick = Date.now();
      await setProgress(jobId, { entity, rowsDone: done, rowsTotal: total, percent: total ? Math.min(99, Math.floor((done / total) * 100)) : 0 });
    };
    const files: ManifestFile[] = [];
    const missing: Array<{ key: string; owner: string; reason: string }> = [];

    for (const spec of ENTITIES) {
      const cols = columnsOf(spec);
      const fmt = makeFormatter(format, spec.name, spec.model, cols);
      const tmp = path.join(tmpDir, `${spec.name}.${FORMAT_EXT[format]}`);
      const sink = new FileSink(tmp);
      await sink.write(fmt.head());
      let rows = 0; let cursor: string | undefined;
      for (;;) {
        const batch: any[] = await delegate(spec.model).findMany({
          where: spec.where(orgId), take: spec.paged === false ? undefined : 500,
          ...(spec.paged === false ? {} : { orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
        });
        if (!batch.length) break;
        for (const raw of batch) {
          let row = spec.transform ? spec.transform(raw, { includeDocuments }) : raw;
          if (spec.model === 'BvContact') row = { ...row, document: includeDocuments && raw.documentEnc ? decryptField(raw.documentEnc) : null };
          await sink.write(fmt.row(row));
          rows++; done++;
        }
        await tick(spec.name);
        if (spec.paged === false) break;
        cursor = batch[batch.length - 1].id;
      }
      await sink.write(fmt.tail());
      await sink.close();
      const entry = await tar.addFile(`data/${spec.name}.${FORMAT_EXT[format]}`, sink.bytes, fs.createReadStream(tmp));
      await fs.promises.rm(tmp, { force: true });
      files.push({ path: `data/${spec.name}.${FORMAT_EXT[format]}`, kind: 'data', entity: spec.name, rows, bytes: entry.bytes, sha256: entry.sha256 });
    }

    if (includeFiles) {
      await tick('files', true);
      const seen = new Set<string>();
      for await (const ref of fileRefs(orgId)) {
        if (seen.has(ref.key)) continue;
        seen.add(ref.key);
        if (!ref.key.startsWith(`${orgId}/`)) { missing.push({ ...ref, reason: 'chave fora do órgão (ignorada)' }); continue; }
        const st = await statObject(ref.key);
        if (!st) { missing.push({ ...ref, reason: 'arquivo ausente no storage' }); continue; }
        const e = await tar.addFile(`files/${ref.key}`, st.size, getObjectStream(ref.key));
        files.push({ path: `files/${ref.key}`, kind: 'file', sourceKey: ref.key, bytes: e.bytes, sha256: e.sha256 });
      }
    }

    const manifest = {
      manifestVersion: 1, generatedAt: new Date().toISOString(), jobId, orgId, format, includeDocuments, includeFiles,
      notes: [
        'sha256 e bytes referem-se ao conteúdo de cada arquivo dentro do .tar (descompactado).',
        'Mensagens estão DECIFRADAS. Segredos (hash de senha, TOTP, tokens, credenciais de integração) não foram exportados.',
        includeDocuments ? 'ATENÇÃO: o campo contacts.document contém CPF/CNPJ em claro (exportação solicitada e auditada).' : 'Documentos (CPF/CNPJ) NÃO incluídos (flag includeDocuments ausente).',
        ...(format === 'SQL' ? ['SQL: colunas derivadas (contacts.document, integrations.config) não existem no schema original; o dump serve a migração/arquivamento.'] : []),
      ],
      totals: { dataFiles: files.filter((f) => f.kind === 'data').length, rows: files.reduce((a, f) => a + (f.rows ?? 0), 0), copiedFiles: files.filter((f) => f.kind === 'file').length, bytes: files.reduce((a, f) => a + f.bytes, 0) },
      files, missingFiles: missing,
    };
    const mbuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    await tar.addFile('manifest.json', mbuf.length, mbuf);
    await tar.finish();
    const stored = await storing;
    await prisma.bvExportJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE', fileKey, sha256: stored.sha256, sizeBytes: BigInt(stored.size), finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000), error: null,
        params: { ...params, progress: { percent: 100, rowsDone: done, rowsTotal: total }, manifestSha256: crypto.createHash('sha256').update(mbuf).digest('hex'), totals: manifest.totals } as any,
      },
    });
    await audit({ orgId, actorType: 'SYSTEM', actorId: job.createdById, action: 'security.export.done', entityType: 'export', entityId: jobId, meta: { format, includeDocuments, includeFiles, totals: manifest.totals, sha256: stored.sha256 } });
    return { status: 'DONE', manifest };
  } catch (err: any) {
    pass.destroy();
    await storing.catch(() => undefined);
    await deleteObject(fileKey).catch(() => undefined);
    logger.error({ err: err?.message, jobId }, '[balcao.security] exportação integral falhou');
    await prisma.bvExportJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: String(err?.message ?? err).slice(0, 500), finishedAt: new Date() } });
    await audit({ orgId, actorType: 'SYSTEM', action: 'security.export.failed', entityType: 'export', entityId: jobId, meta: { error: String(err?.message ?? err).slice(0, 200) } });
    return { status: 'FAILED' };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Retoma jobs PENDING (ex.: API reiniciou) e marca como FALHA os RUNNING parados há mais de 6 h. */
export async function pickPendingExports(): Promise<void> {
  const stale = new Date(Date.now() - 6 * 3600_000);
  await prisma.bvExportJob.updateMany({ where: { type: 'FULL_EXPORT', status: 'RUNNING', createdAt: { lt: stale } }, data: { status: 'FAILED', error: 'interrompido (processo reiniciado ou excedeu 6 h)', finishedAt: new Date() } });
  const pending = await prisma.bvExportJob.findMany({ where: { type: 'FULL_EXPORT', status: 'PENDING', createdAt: { lt: new Date(Date.now() - 30_000) } }, select: { id: true }, take: 3 });
  for (const j of pending) await runExclusive(`security.export:${j.id}`, 6 * 3600, () => runFullExport(j.id));
}

registerJob('balcao.security.exports', { intervalMs: 60_000, lockTtlSec: 120 }, pickPendingExports);
