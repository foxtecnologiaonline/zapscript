import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { clearAuthCache, guard, idParam, parse, sendError } from '../core/http';
import { revokeAllSessions } from '../core/session';
import { ROLES } from '../core/types';
import { csvRow, route } from './common';
import { hashPasswordAsync } from './passwordAsync';
import {
  assertSector, conflictFromUnique, createUserRecord, dedupe, generateTempPassword, IamError, normalizeEmail, userView,
} from './service';

const roleEnum = z.enum(ROLES);
const skills = z.array(z.string().trim().min(1).max(50)).max(30);
const sip = z.string().trim().regex(/^[0-9A-Za-z_.-]{2,20}$/, 'Ramal inválido (2 a 20 caracteres alfanuméricos)');
const nameField = z.string().trim().min(2).max(120);

const createBody = z.object({
  email: z.string().trim().email().max(200), name: nameField, role: roleEnum, skills: skills.optional(),
  maxConcurrent: z.number().int().min(1).max(20).optional(), sectorId: z.string().min(1).max(64).nullable().optional(), sipExtension: sip.nullable().optional(),
});
const patchBody = z.object({
  name: nameField.optional(), role: roleEnum.optional(), skills: skills.optional(), maxConcurrent: z.number().int().min(1).max(20).optional(),
  sectorId: z.string().min(1).max(64).nullable().optional(), sipExtension: sip.nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, 'Informe ao menos um campo');
const listQuery = z.object({
  q: z.string().trim().max(100).optional(), role: roleEnum.optional(), active: z.enum(['true', 'false']).optional(),
  sectorId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(64).optional(),
});
const BULK_MAX = 500;
const bulkBody = z.object({ users: z.array(z.unknown()).min(1, 'Envie ao menos 1 linha').max(BULK_MAX, `No máximo ${BULK_MAX} linhas por requisição`) });
const bulkRow = z.object({
  email: z.string().trim().email().max(200), name: nameField, role: roleEnum, skills: skills.optional(),
  sectorId: z.string().min(1).max(64).optional(), sectorName: z.string().trim().min(1).max(120).optional(),
});
const bulkQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

/**
 * Executa `fn` numa transação que trava os ADMIN ativos do órgão (SELECT … FOR UPDATE). Dentro dela,
 * `othersAdmins(excluding)` conta os demais ADMIN ativos — garante que nunca sobre um órgão sem administrador,
 * mesmo com dois admins se rebaixando ao mesmo tempo.
 */
async function withAdminLock<T>(orgId: string, fn: (tx: Prisma.TransactionClient, othersAdmins: (excluding: string) => Promise<number>) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BvUser" WHERE "orgId" = ${orgId} AND role = 'ADMIN' AND active = true FOR UPDATE`;
    return fn(tx, (excluding) => tx.bvUser.count({ where: { orgId, role: 'ADMIN', active: true, id: { not: excluding } } }));
  });
}

async function loadTarget(req: FastifyRequest, reply: FastifyReply) {
  const p = parse(idParam, req.params, reply); if (!p) return null;
  const u = await prisma.bvUser.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
  if (!u) { sendError(reply, 404, 'user.not_found', 'Usuário não encontrado.'); return null; }
  return u;
}

const LAST_ADMIN = () => new IamError(409, 'user.last_admin', 'O órgão precisa manter pelo menos um administrador ativo.');

export default async function adminUsersRoutes(app: FastifyInstance): Promise<void> {
  // ── Listagem / detalhe ──────────────────────────────────────────────────────
  app.get('/admin/users', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const q = parse(listQuery, req.query, reply); if (!q) return;
    const where: Prisma.BvUserWhereInput = {
      orgId: req.bv!.orgId,
      ...(q.role ? { role: q.role } : {}), ...(q.active ? { active: q.active === 'true' } : {}), ...(q.sectorId ? { sectorId: q.sectorId } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.bvUser.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }),
      prisma.bvUser.count({ where }),
    ]);
    const page = rows.slice(0, q.limit);
    return reply.send({ items: page.map(userView), total, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null });
  }));

  app.get('/admin/users/:id', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const u = await loadTarget(req, reply); if (!u) return;
    return reply.send(userView(u));
  }));

  // ── Criação (individual e em massa) ─────────────────────────────────────────
  app.post('/admin/users', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const body = parse(createBody, req.body, reply); if (!body) return;
    const { user, temporaryPassword } = await createUserRecord(req.bv!.orgId, body);
    await auditReq(req, 'user.create', { entityType: 'user', entityId: user.id, after: userView(user) });
    noStore(reply);
    return reply.code(201).send({ user: userView(user), temporaryPassword });
  }));

  app.post('/admin/users/bulk', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const body = parse(bulkBody, req.body, reply); if (!body) return;
    const q = parse(bulkQuery, req.query, reply); if (!q) return;
    const orgId = req.bv!.orgId;

    const sectors = await prisma.bvSector.findMany({ where: { orgId }, select: { id: true, name: true } });
    const sectorIds = new Set(sectors.map((s) => s.id));
    const sectorByName = new Map(sectors.map((s) => [s.name.toLowerCase(), s.id]));

    type Row = { row: number; email: string; ok: boolean; id?: string; temporaryPassword?: string; error?: { code: string; message: string } };
    const results: Row[] = body.users.map((raw, i) => ({ row: i + 1, email: typeof (raw as any)?.email === 'string' ? normalizeEmail((raw as any).email) : '', ok: false }));
    const valid: Array<{ i: number; data: z.infer<typeof bulkRow> }> = [];
    const seen = new Set<string>();

    body.users.forEach((raw, i) => {
      const r = bulkRow.safeParse(raw);
      if (!r.success) { results[i].error = { code: 'validation.failed', message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }; return; }
      const email = normalizeEmail(r.data.email);
      results[i].email = email;
      if (seen.has(email)) { results[i].error = { code: 'user.duplicate_in_payload', message: 'E-mail repetido nesta carga.' }; return; }
      seen.add(email);
      if (r.data.sectorId && !sectorIds.has(r.data.sectorId)) { results[i].error = { code: 'sector.not_found', message: 'Setor inexistente neste órgão.' }; return; }
      if (!r.data.sectorId && r.data.sectorName && !sectorByName.has(r.data.sectorName.toLowerCase())) { results[i].error = { code: 'sector.not_found', message: `Setor "${r.data.sectorName}" não existe.` }; return; }
      valid.push({ i, data: r.data });
    });

    const existing = new Set((await prisma.bvUser.findMany({ where: { orgId, email: { in: valid.map((v) => normalizeEmail(v.data.email)) } }, select: { email: true } })).map((u) => u.email));
    const todo = valid.filter((v) => {
      if (existing.has(normalizeEmail(v.data.email))) { results[v.i].error = { code: 'user.email_taken', message: 'Já existe um usuário com este e-mail.' }; return false; }
      return true;
    });

    const created: Array<{ id: string; email: string; role: string }> = [];
    const CONCURRENCY = 8; // scrypt assíncrono roda no threadpool do libuv
    for (let k = 0; k < todo.length; k += CONCURRENCY) {
      await Promise.all(todo.slice(k, k + CONCURRENCY).map(async ({ i, data }) => {
        try {
          const sectorId = data.sectorId ?? (data.sectorName ? sectorByName.get(data.sectorName.toLowerCase()) : undefined) ?? null;
          const { user, temporaryPassword } = await createUserRecord(orgId, { email: data.email, name: data.name, role: data.role, skills: data.skills, sectorId }, { skipSectorCheck: true });
          Object.assign(results[i], { ok: true, id: user.id, temporaryPassword });
          created.push({ id: user.id, email: user.email, role: user.role });
          await auditReq(req, 'user.create', { entityType: 'user', entityId: user.id, after: userView(user), meta: { bulk: true } });
        } catch (e) {
          results[i].error = e instanceof IamError ? { code: e.code, message: e.message } : { code: 'internal', message: 'Falha ao criar o usuário.' };
        }
      }));
    }
    const failed = results.filter((r) => !r.ok).length;
    await auditReq(req, 'user.bulk_create', { entityType: 'user', meta: { total: results.length, created: created.length, failed } });
    noStore(reply);

    if (q.format === 'csv') {
      const lines = [csvRow(['linha', 'email', 'ok', 'senha_temporaria', 'erro']), ...results.map((r) => csvRow([r.row, r.email, r.ok ? 'sim' : 'nao', r.temporaryPassword ?? '', r.error?.message ?? '']))];
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="usuarios-importados.csv"').send(lines.join('\r\n') + '\r\n');
    }
    return reply.code(created.length > 0 || failed === 0 ? 200 : 422).send({ total: results.length, created: created.length, failed, results });
  }));

  // ── Edição ──────────────────────────────────────────────────────────────────
  app.patch('/admin/users/:id', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    const body = parse(patchBody, req.body, reply); if (!body) return;
    const orgId = req.bv!.orgId;
    const self = target.id === req.bv!.userId;
    if (self && body.role && body.role !== target.role) throw new IamError(403, 'user.self_change', 'Você não pode alterar o seu próprio perfil.');
    if (body.sectorId) await assertSector(orgId, body.sectorId);

    const data: Prisma.BvUserUncheckedUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}), ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.skills !== undefined ? { skills: dedupe(body.skills) } : {}), ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
      ...(body.sectorId !== undefined ? { sectorId: body.sectorId } : {}), ...(body.sipExtension !== undefined ? { sipExtension: body.sipExtension } : {}),
    };
    const demoting = target.role === 'ADMIN' && target.active && body.role !== undefined && body.role !== 'ADMIN';
    try {
      const after = demoting
        ? await withAdminLock(orgId, async (tx, others) => { if ((await others(target.id)) < 1) throw LAST_ADMIN(); return tx.bvUser.update({ where: { id: target.id }, data }); })
        : await prisma.bvUser.update({ where: { id: target.id }, data });
      clearAuthCache();
      await auditReq(req, 'user.update', { entityType: 'user', entityId: target.id, before: userView(target), after: userView(after) });
      return reply.send(userView(after));
    } catch (e) {
      throw conflictFromUnique(e) ?? e;
    }
  }));

  // ── Ativar / desativar ──────────────────────────────────────────────────────
  app.post('/admin/users/:id/deactivate', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    const orgId = req.bv!.orgId;
    if (target.id === req.bv!.userId) throw new IamError(403, 'user.self_change', 'Você não pode desativar a sua própria conta.');
    const data = { active: false, presence: 'OFFLINE', presenceAt: new Date() };
    const after = target.role === 'ADMIN' && target.active
      ? await withAdminLock(orgId, async (tx, others) => { if ((await others(target.id)) < 1) throw LAST_ADMIN(); return tx.bvUser.update({ where: { id: target.id }, data }); })
      : await prisma.bvUser.update({ where: { id: target.id }, data });
    await revokeAllSessions(target.id); // também limpa o cache de autenticação
    await auditReq(req, 'user.deactivate', { entityType: 'user', entityId: target.id, before: userView(target), after: userView(after) });
    return reply.send(userView(after));
  }));

  app.post('/admin/users/:id/activate', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    const after = await prisma.bvUser.update({ where: { id: target.id }, data: { active: true, failedLogins: 0, lockedUntil: null } });
    clearAuthCache();
    await auditReq(req, 'user.activate', { entityType: 'user', entityId: target.id, before: userView(target), after: userView(after) });
    return reply.send(userView(after));
  }));

  // ── Senha / MFA / bloqueio ──────────────────────────────────────────────────
  app.post('/admin/users/:id/reset-password', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    if (target.id === req.bv!.userId) throw new IamError(403, 'user.self_change', 'Para alterar a própria senha use POST /auth/password.');
    const temporaryPassword = generateTempPassword();
    await prisma.bvUser.update({ where: { id: target.id }, data: { passwordHash: await hashPasswordAsync(temporaryPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
    await revokeAllSessions(target.id);
    await auditReq(req, 'user.reset_password', { entityType: 'user', entityId: target.id });
    noStore(reply);
    return reply.send({ user: userView({ ...target, mustChangePassword: true, lockedUntil: null }), temporaryPassword });
  }));

  app.post('/admin/users/:id/reset-mfa', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    const after = await prisma.bvUser.update({ where: { id: target.id }, data: { totpEnabled: false, totpSecretEnc: null } });
    await revokeAllSessions(target.id);
    await auditReq(req, 'user.reset_mfa', { entityType: 'user', entityId: target.id, before: { totpEnabled: target.totpEnabled }, after: { totpEnabled: false } });
    return reply.send(userView(after));
  }));

  app.post('/admin/users/:id/unlock', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const target = await loadTarget(req, reply); if (!target) return;
    const after = await prisma.bvUser.update({ where: { id: target.id }, data: { failedLogins: 0, lockedUntil: null } });
    await auditReq(req, 'user.unlock', { entityType: 'user', entityId: target.id });
    return reply.send(userView(after));
  }));
}
