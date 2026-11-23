import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { hashToken, randomToken } from '../core/crypto';
import { guard, idParam, parse, sendError } from '../core/http';
import { PERMISSIONS } from '../core/permissions';
import { csvRow, guardAny, route } from './common';

/** Escopos que um token de API NUNCA pode ter (o core também os recusa em requirePerm). */
const FORBIDDEN_SCOPES = new Set(['user:manage', 'security:manage', 'org:manage']);
const grantable = PERMISSIONS.filter((p) => !FORBIDDEN_SCOPES.has(p));

const tokenBody = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(z.string()).min(1, 'Informe ao menos um escopo').max(40)
    .refine((a) => a.every((s) => (grantable as readonly string[]).includes(s)), { message: `Escopos permitidos: ${grantable.join(', ')}` }),
});

const dateParam = z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional());
const auditQuery = z.object({
  actorId: z.string().max(80).optional(),
  action: z.string().max(100).optional(), // exato, ou prefixo quando termina em "*" (ex.: user.*)
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  from: dateParam, to: dateParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
const CSV_MAX_ROWS = 50_000;

export default async function adminSecurityRoutes(app: FastifyInstance): Promise<void> {
  // ── Tokens de API (BI / integrações somente leitura) ────────────────────────
  app.get('/admin/tokens', { preHandler: guard('security:manage') }, route(async (req, reply) => {
    const rows = await prisma.bvApiToken.findMany({ where: { orgId: req.bv!.orgId }, orderBy: { createdAt: 'desc' }, take: 500 });
    return reply.send({ items: rows.map(({ tokenHash: _h, ...t }) => t) });
  }));

  app.post('/admin/tokens', { preHandler: guard('security:manage') }, route(async (req, reply) => {
    const body = parse(tokenBody, req.body, reply); if (!body) return;
    const token = `bvt_${randomToken(32)}`;
    const row = await prisma.bvApiToken.create({ data: { orgId: req.bv!.orgId, name: body.name, scopes: [...new Set(body.scopes)], tokenHash: hashToken(token), createdById: req.bv!.userId } });
    await auditReq(req, 'apitoken.create', { entityType: 'apitoken', entityId: row.id, after: { name: row.name, scopes: row.scopes } });
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({ id: row.id, name: row.name, scopes: row.scopes, createdAt: row.createdAt, token, notice: 'Guarde este token agora: ele não será exibido novamente.' });
  }));

  app.delete('/admin/tokens/:id', { preHandler: guard('security:manage') }, route(async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const row = await prisma.bvApiToken.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!row) return sendError(reply, 404, 'apitoken.not_found', 'Token não encontrado.');
    if (!row.revokedAt) {
      await prisma.bvApiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await auditReq(req, 'apitoken.revoke', { entityType: 'apitoken', entityId: row.id, before: { name: row.name, scopes: row.scopes } });
    }
    return reply.send({ ok: true });
  }));

  // ── Trilha de auditoria ─────────────────────────────────────────────────────
  app.get('/admin/audit', { preHandler: guardAny('audit:read') }, route(async (req, reply) => {
    const q = parse(auditQuery, req.query, reply); if (!q) return;
    const orgId = req.bv!.orgId;
    const where: Prisma.BvAuditLogWhereInput = {
      orgId,
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? (q.action.endsWith('*') ? { action: { startsWith: q.action.slice(0, -1) } } : { action: q.action }) : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const order: Prisma.BvAuditLogOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

    const withActors = async <T extends { actorId: string | null }>(rows: T[]) => {
      const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x && !x.startsWith('token:')))];
      const users = ids.length ? await prisma.bvUser.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ ...r, actorName: r.actorId ? (r.actorId.startsWith('token:') ? 'Token de API' : names.get(r.actorId) ?? null) : null }));
    };

    if (q.format === 'csv') {
      const rows: Awaited<ReturnType<typeof prisma.bvAuditLog.findMany>> = [];
      let cursor: string | undefined;
      while (rows.length < CSV_MAX_ROWS) {
        const batch = await prisma.bvAuditLog.findMany({ where, orderBy: order, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        rows.push(...batch);
        if (batch.length < 1000) break;
        cursor = batch[batch.length - 1].id;
      }
      const truncated = rows.length >= CSV_MAX_ROWS;
      const enriched = await withActors(rows);
      await auditReq(req, 'audit.export', { entityType: 'audit', meta: { rows: rows.length, truncated, filters: { actorId: q.actorId, action: q.action, entityType: q.entityType, entityId: q.entityId, from: q.from, to: q.to } } });
      const header = ['id', 'data', 'tipo_ator', 'ator_id', 'ator_nome', 'acao', 'entidade', 'entidade_id', 'ip', 'user_agent', 'antes', 'depois', 'meta'];
      const lines = [csvRow(header), ...enriched.map((r) => csvRow([r.id, r.createdAt, r.actorType, r.actorId, r.actorName, r.action, r.entityType, r.entityId, r.ip, r.userAgent, r.before, r.after, r.meta]))];
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="auditoria.csv"');
      if (truncated) reply.header('x-truncated', 'true');
      return reply.send(lines.join('\r\n') + '\r\n');
    }

    const rows = await prisma.bvAuditLog.findMany({ where, orderBy: order, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, q.limit);
    return reply.send({ items: await withActors(page), nextCursor: rows.length > q.limit ? page[page.length - 1].id : null });
  }));
}
