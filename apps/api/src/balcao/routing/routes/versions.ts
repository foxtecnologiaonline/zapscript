import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { recordConfigVersion } from '../../core/configVersion';
import { idParam, parse, sendError } from '../../core/http';
import { actor, guardUser, isUniqueViolation, notFound } from './common';
import { queueFields, queuePatchSchema, snapshot, validateOverflow } from './queues';

/**
 * Histórico de versões da configuração (BvConfigVersion, gravado por queues.ts/rules.ts via recordConfigVersion):
 * GET /queues/:id/versions · GET /routing-rules/:id/versions · POST /queues/:id/versions/:version/restore.
 */
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const versionParam = idParam.extend({ version: z.coerce.number().int().min(1).max(1_000_000) });
const QUEUE_KEYS = Object.keys(queueFields) as Array<keyof typeof queueFields>;

async function listVersions(orgId: string, entityType: 'queue' | 'routing-rule', entityId: string, limit: number) {
  const rows = await prisma.bvConfigVersion.findMany({ where: { orgId, entityType, entityId }, orderBy: { version: 'desc' }, take: limit });
  const ids = [...new Set(rows.map((r) => r.changedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.bvUser.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    version: r.version, snapshot: r.snapshot, createdAt: r.createdAt,
    deleted: !!(r.snapshot as { deleted?: boolean } | null)?.deleted,
    changedBy: r.changedById ? { id: r.changedById, name: name.get(r.changedById) ?? null } : null,
  }));
}

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/queues/:id/versions', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const q = parse(listQuery, req.query, reply); if (!q) return;
    const items = await listVersions(actor(req).orgId, 'queue', p.id, q.limit);
    if (items.length === 0 && !(await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: actor(req).orgId }, select: { id: true } }))) return notFound(reply, 'Fila');
    return { items };
  });

  app.get('/routing-rules/:id/versions', { preHandler: guardUser('routing:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const q = parse(listQuery, req.query, reply); if (!q) return;
    const items = await listVersions(actor(req).orgId, 'routing-rule', p.id, q.limit);
    if (items.length === 0 && !(await prisma.bvRoutingRule.findFirst({ where: { id: p.id, orgId: actor(req).orgId }, select: { id: true } }))) return notFound(reply, 'Regra');
    return { items };
  });

  /** Restaura os campos de configuração da fila a partir de um snapshot (validado como um PATCH). Membros não são alterados. */
  app.post('/queues/:id/versions/:version/restore', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(versionParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const queue = await prisma.bvQueue.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!queue) return notFound(reply, 'Fila');
    const ver = await prisma.bvConfigVersion.findFirst({ where: { orgId: a.orgId, entityType: 'queue', entityId: queue.id, version: p.version } });
    if (!ver) return sendError(reply, 404, 'version.not_found', 'Versão não encontrada');
    const snap = (ver.snapshot ?? {}) as Record<string, unknown>;
    if (snap.deleted) return sendError(reply, 409, 'version.not_restorable', 'Esta versão registra a exclusão da fila e não pode ser restaurada');

    // só os campos de configuração conhecidos; tudo é revalidado com o mesmo schema do PATCH
    const picked: Record<string, unknown> = {};
    for (const k of QUEUE_KEYS) if (k in snap) picked[k] = snap[k];
    const parsed = queuePatchSchema.safeParse(picked);
    if (!parsed.success) return sendError(reply, 422, 'version.invalid_snapshot', 'O snapshot desta versão não é mais válido', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const data = parsed.data;
    const ovErr = await validateOverflow(a.orgId, queue.id, data.overflowQueueId);
    if (ovErr) return sendError(reply, 422, 'version.invalid_snapshot', ovErr, [{ path: 'overflowQueueId', message: ovErr }]);
    if (data.sectorId && !(await prisma.bvSector.findFirst({ where: { id: data.sectorId, orgId: a.orgId }, select: { id: true } }))) {
      return sendError(reply, 422, 'version.invalid_snapshot', 'Setor da versão não existe mais', [{ path: 'sectorId', message: 'Setor inexistente' }]);
    }
    try {
      const after = await prisma.bvQueue.update({ where: { id: queue.id }, data: { ...data, businessHours: data.businessHours === undefined ? undefined : ((data.businessHours ?? null) as never) } as never });
      const version = await recordConfigVersion(a.orgId, 'queue', queue.id, snapshot(after), a.userId);
      await auditReq(req, 'queue.restore', { entityType: 'queue', entityId: queue.id, before: queue, after, meta: { restoredFromVersion: ver.version, newVersion: version } });
      return { queue: after, version, restoredFrom: ver.version };
    } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'queue.slug_taken', 'Já existe outra fila com o identificador desta versão');
      throw e;
    }
  });
}
