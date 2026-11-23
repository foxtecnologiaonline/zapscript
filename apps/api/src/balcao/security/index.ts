import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { guard, idParam, parse, sendError } from '../core/http';
import { runExclusive } from '../core/scheduler';
import { getOrgSettings, updateOrgSettings } from '../core/settings';
import { getObjectStream, parseRange, statObject } from '../core/storage';
import { activeLegalHold, getSecuritySettings } from './config';
import { DSR_TYPES, DsrError, openDsr, parseNote, processDsr, rejectDsr } from './dsr';
import { createFullExportJob, runFullExport } from './exporter';
import { createIncident, getIncident, listIncidents, updateIncident } from './incidents';
import { guardAny } from './guards';
import { keyStatus, rotateFieldKeys } from './keys';
import { computePosture } from './posture';
import { publicDsrRoutes } from './publicDsr';
import './retention';
import { runRetentionExclusive } from './retention';

/** Plugin da frente security — prefixo /balcao/security (definido em balcao/index.ts). Ver docs/balcao/api-security.md. */
const bool = z.preprocess((v) => (v === '1' || v === 'true' || v === true ? true : v === '0' || v === 'false' || v === false || v === undefined ? false : v), z.boolean());
const dsrAccess = () => guardAny('contact:lgpd', 'security:manage');

async function sendFile(req: FastifyRequest, reply: FastifyReply, key: string, size: number, type: string, filename: string, sha256?: string | null) {
  const range = parseRange(req.headers.range, size);
  reply.header('Accept-Ranges', 'bytes').header('Content-Type', type).header('Content-Disposition', `attachment; filename="${filename}"`).header('Cache-Control', 'private, no-store');
  if (sha256) reply.header('X-Content-SHA256', sha256);
  if (req.headers.range && !range) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  if (range) {
    reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1);
    return reply.send(getObjectStream(key, range));
  }
  reply.header('Content-Length', size);
  return reply.send(getObjectStream(key));
}

const dsrView = (r: any) => { const n = parseNote(r.note); return { id: r.id, contactId: r.contactId, type: r.type, status: r.status, requestedAt: r.requestedAt, completedAt: r.completedAt, handledById: r.handledById, origin: n.origin ?? 'INTERNAL', justification: n.justification ?? null, text: n.text ?? null, rejectedReason: n.rejectedReason ?? null, report: n.report ?? null }; };
const handle = (reply: FastifyReply, err: unknown) => { if (err instanceof DsrError) return sendError(reply, err.status, err.code, err.message); throw err; };

export default async function plugin(app: FastifyInstance): Promise<void> {
  await publicDsrRoutes(app);

  // ── LGPD: direitos do titular ───────────────────────────────────────────────
  app.post('/dsr', { preHandler: dsrAccess() }, async (req, reply) => {
    const b = parse(z.object({ contactId: z.string().min(1).max(64), type: z.enum(DSR_TYPES), note: z.string().max(2000).optional(), justification: z.string().max(2000).optional() }), req.body, reply);
    if (!b) return;
    try {
      const { request, created } = await openDsr({ orgId: req.bv!.orgId, contactId: b.contactId, type: b.type, actorId: req.bv!.userId, note: b.note, justification: b.justification });
      return reply.code(created ? 201 : 200).send({ ...dsrView(request), created });
    } catch (e) { return handle(reply, e); }
  });

  app.get('/dsr', { preHandler: dsrAccess() }, async (req, reply) => {
    const q = parse(z.object({ status: z.enum(['OPEN', 'DONE', 'REJECTED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query, reply);
    if (!q) return;
    const rows = await prisma.bvDataSubjectRequest.findMany({ where: { orgId: req.bv!.orgId, ...(q.status ? { status: q.status } : {}) }, orderBy: { requestedAt: 'desc' }, take: q.limit });
    return { items: rows.map(dsrView) };
  });

  app.get('/dsr/:id', { preHandler: dsrAccess() }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const r = await prisma.bvDataSubjectRequest.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!r) return sendError(reply, 404, 'dsr.not_found', 'Solicitação não encontrada');
    return dsrView(r);
  });

  app.post('/dsr/:id/process', { preHandler: dsrAccess() }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.object({ justification: z.string().max(2000).optional(), redactAllMessages: z.boolean().optional() }), req.body ?? {}, reply);
    if (!b) return;
    try {
      const res = await processDsr(req.bv!.orgId, p.id, req.bv!.userId, b);
      return { ...dsrView(res.request), alreadyDone: res.alreadyDone };
    } catch (e) { return handle(reply, e); }
  });

  app.post('/dsr/:id/reject', { preHandler: dsrAccess() }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.object({ reason: z.string().min(5).max(1000) }), req.body, reply); if (!b) return;
    try { return dsrView(await rejectDsr(req.bv!.orgId, p.id, req.bv!.userId, b.reason)); } catch (e) { return handle(reply, e); }
  });

  app.get('/dsr/:id/export', { preHandler: dsrAccess() }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const orgId = req.bv!.orgId;
    const r = await prisma.bvDataSubjectRequest.findFirst({ where: { id: p.id, orgId } });
    const jobId = r && r.status === 'DONE' ? (parseNote(r.note).report as any)?.exportJobId : null;
    const job = jobId ? await prisma.bvExportJob.findFirst({ where: { id: jobId, orgId, type: 'DSAR' } }) : null;
    if (!job?.fileKey) return sendError(reply, 404, 'dsr.export_not_found', 'Exportação indisponível (não gerada ou expirada)');
    const st = await statObject(job.fileKey);
    if (!st) return sendError(reply, 404, 'dsr.export_not_found', 'Arquivo não encontrado');
    await auditReq(req, 'dsr.export.download', { entityType: 'contact', entityId: r!.contactId, meta: { requestId: r!.id, jobId: job.id } });
    return sendFile(req, reply, job.fileKey, st.size, 'application/json; charset=utf-8', `titular-${r!.id}.json`, job.sha256);
  });

  // ── Retenção ────────────────────────────────────────────────────────────────
  app.post('/retention/run', { preHandler: guard('security:manage') }, async (req, reply) => {
    const q = parse(z.object({ dryRun: bool.default(false), batchSize: z.coerce.number().int().min(1).max(1000).optional(), maxBatches: z.coerce.number().int().min(1).max(200).optional() }), req.query, reply);
    if (!q) return;
    const res = await runRetentionExclusive(req.bv!.orgId, q);
    if (!res) return sendError(reply, 409, 'retention.busy', 'Já existe uma execução de retenção em andamento');
    await auditReq(req, q.dryRun ? 'retention.dry_run' : 'retention.manual_run', { entityType: 'retention', meta: { kinds: res.kinds.map((k) => ({ kind: k.kind, purged: k.purged, candidates: k.candidates })) } });
    return res;
  });

  app.get('/retention/runs', { preHandler: guardAny('security:manage', 'audit:read') }, async (req) => ({
    items: await prisma.bvRetentionRun.findMany({ where: { orgId: req.bv!.orgId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  }));

  // ── Guarda legal ────────────────────────────────────────────────────────────
  app.get('/legal-hold', { preHandler: guardAny('security:manage', 'audit:read') }, async (req) => {
    const h = (await getSecuritySettings(req.bv!.orgId)).legalHold;
    return { legalHold: h, effective: !!activeLegalHold(h) };
  });
  app.put('/legal-hold', { preHandler: guard('security:manage') }, async (req, reply) => {
    const b = parse(z.object({ active: z.boolean(), basis: z.string().min(5).max(500).optional(), until: z.string().datetime().nullable().optional() }).refine((v) => !v.active || !!v.basis, { message: 'Informe a base legal da guarda' }), req.body, reply);
    if (!b) return;
    const orgId = req.bv!.orgId;
    const before = (await getSecuritySettings(orgId)).legalHold;
    const legalHold = { active: b.active, basis: b.basis, until: b.until ?? null, since: b.active ? new Date().toISOString() : undefined };
    const cur: any = await getOrgSettings(orgId);
    const settings = await updateOrgSettings(orgId, { security: { ...(cur.security ?? {}), legalHold } } as any);
    await recordConfigVersion(orgId, 'org.settings', orgId, settings, req.bv!.userId);
    await auditReq(req, 'security.legal_hold', { entityType: 'org', entityId: orgId, before, after: legalHold });
    return { legalHold, effective: !!activeLegalHold(legalHold) };
  });

  // ── Chaves de campo ─────────────────────────────────────────────────────────
  app.get('/keys/status', { preHandler: guard('security:manage') }, async (req) => keyStatus(req.bv!.orgId));
  app.post('/keys/rotate', { preHandler: guard('security:manage') }, async (req, reply) => {
    const b = parse(z.object({ batchSize: z.number().int().min(1).max(1000).optional(), maxRows: z.number().int().min(1).max(200_000).optional() }), req.body ?? {}, reply);
    if (!b) return;
    const orgId = req.bv!.orgId;
    const res = await runExclusive(`security.keys.rotate:${orgId}`, 600, () => rotateFieldKeys({ orgId, batchSize: b.batchSize, maxRows: b.maxRows ?? 20_000 }));
    if (!res) return sendError(reply, 409, 'keys.busy', 'Rotação já em andamento');
    await auditReq(req, 'security.keys.rotate', { entityType: 'keys', meta: { currentKid: res.currentKid, rotated: res.rotated, failed: res.failed, remaining: res.remaining, byTable: res.tables.map((t) => ({ table: t.table, rotated: t.rotated, remaining: t.remaining })) } });
    return res;
  });

  // ── Exportação integral ─────────────────────────────────────────────────────
  app.post('/export', { preHandler: guard('security:manage', 'org:manage') }, async (req, reply) => {
    const b = parse(z.object({ format: z.enum(['JSON', 'CSV', 'XML', 'SQL']), includeDocuments: z.boolean().default(false), includeFiles: z.boolean().default(true) }), req.body, reply);
    if (!b) return;
    const orgId = req.bv!.orgId;
    const busy = await prisma.bvExportJob.findFirst({ where: { orgId, type: 'FULL_EXPORT', status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
    if (busy) return sendError(reply, 409, 'export.busy', 'Já existe uma exportação integral em andamento', { jobId: busy.id });
    const job = await createFullExportJob(orgId, b.format, { includeDocuments: b.includeDocuments, includeFiles: b.includeFiles, requestedBy: req.bv!.userId }, req.bv!.userId);
    await auditReq(req, 'security.export.request', { entityType: 'export', entityId: job.id, meta: { format: b.format, includeFiles: b.includeFiles } });
    if (b.includeDocuments) await auditReq(req, 'security.export.documents', { entityType: 'export', entityId: job.id, meta: { warning: 'CPF/CNPJ em claro solicitado explicitamente' } });
    void runExclusive(`security.export:${job.id}`, 6 * 3600, () => runFullExport(job.id)).catch(() => undefined);
    return reply.code(202).send({ id: job.id, status: job.status, format: b.format });
  });

  const jobView = (j: any) => ({ id: j.id, type: j.type, format: j.format, status: j.status, createdAt: j.createdAt, finishedAt: j.finishedAt, expiresAt: j.expiresAt, sha256: j.sha256, sizeBytes: j.sizeBytes == null ? null : Number(j.sizeBytes), error: j.error, progress: (j.params as any)?.progress ?? null, includeDocuments: !!(j.params as any)?.includeDocuments, totals: (j.params as any)?.totals ?? null, downloadable: j.status === 'DONE' && !!j.fileKey });

  app.get('/exports', { preHandler: guard('security:manage') }, async (req) => ({
    items: (await prisma.bvExportJob.findMany({ where: { orgId: req.bv!.orgId, type: 'FULL_EXPORT' }, orderBy: { createdAt: 'desc' }, take: 50 })).map(jobView),
  }));
  app.get('/exports/:id', { preHandler: guard('security:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const j = await prisma.bvExportJob.findFirst({ where: { id: p.id, orgId: req.bv!.orgId, type: 'FULL_EXPORT' } });
    return j ? jobView(j) : sendError(reply, 404, 'export.not_found', 'Exportação não encontrada');
  });
  app.get('/exports/:id/download', { preHandler: guard('security:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const orgId = req.bv!.orgId;
    const j = await prisma.bvExportJob.findFirst({ where: { id: p.id, orgId, type: 'FULL_EXPORT' } });
    if (!j) return sendError(reply, 404, 'export.not_found', 'Exportação não encontrada');
    if (j.status !== 'DONE' || !j.fileKey) return sendError(reply, 409, 'export.not_ready', 'Exportação não está pronta ou expirou');
    const st = await statObject(j.fileKey);
    if (!st) return sendError(reply, 404, 'export.file_missing', 'Arquivo não encontrado no storage');
    // toda requisição é auditada (inclusive cada pedaço de um download retomado por Range)
    await auditReq(req, 'security.export.download', { entityType: 'export', entityId: j.id, meta: { format: j.format, bytes: st.size, range: req.headers.range ?? null } });
    return sendFile(req, reply, j.fileKey, st.size, 'application/gzip', `balcao-export-${j.id}.tar.gz`, j.sha256);
  });

  // ── Postura e incidentes ────────────────────────────────────────────────────
  app.get('/posture', { preHandler: guardAny('security:manage', 'audit:read') }, async (req) => computePosture(req.bv!.orgId, req));

  const incidentBody = z.object({
    title: z.string().min(5).max(200), description: z.string().min(10).max(5000), dataAffected: z.array(z.string().min(1).max(100)).max(30).default([]),
    affectedSubjects: z.number().int().min(0).nullable().optional(), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    awareAt: z.string().datetime(), notifiedAt: z.string().datetime().nullable().optional(), notifiedTo: z.string().max(200).nullable().optional(), measures: z.string().max(5000).nullable().optional(),
  });
  app.post('/incidents', { preHandler: guard('security:manage') }, async (req, reply) => {
    const b = parse(incidentBody, req.body, reply); if (!b) return;
    const inc = await createIncident(req.bv!.orgId, req.bv!.userId, { ...b, awareAt: new Date(b.awareAt), notifiedAt: b.notifiedAt ? new Date(b.notifiedAt) : null });
    return reply.code(201).send(inc);
  });
  app.get('/incidents', { preHandler: guardAny('security:manage', 'audit:read') }, async (req) => ({ items: await listIncidents(req.bv!.orgId) }));
  app.get('/incidents/:id', { preHandler: guardAny('security:manage', 'audit:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    return (await getIncident(req.bv!.orgId, p.id)) ?? sendError(reply, 404, 'incident.not_found', 'Incidente não encontrado');
  });
  app.patch('/incidents/:id', { preHandler: guard('security:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(incidentBody.partial().omit({ awareAt: true }).extend({ status: z.enum(['OPEN', 'CONTAINED', 'CLOSED']).optional() }), req.body, reply); if (!b) return;
    const { notifiedAt, ...rest } = b;
    const inc = await updateIncident(req.bv!.orgId, p.id, req.bv!.userId, { ...rest, ...(notifiedAt !== undefined ? { notifiedAt: notifiedAt ? new Date(notifiedAt) : null } : {}) });
    return inc ?? sendError(reply, 404, 'incident.not_found', 'Incidente não encontrado');
  });
}
