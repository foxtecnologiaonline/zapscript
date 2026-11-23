import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { guard, idParam, parse, sendError } from '../core/http';
import { getOrgSettings, invalidateHolidays, invalidateOrgSettings, updateOrgSettings, type BvOrgSettings } from '../core/settings';
import { ROLES } from '../core/types';
import { guardAny, route } from './common';
import { IamError, uniqueTarget } from './service';

// ── Schemas ───────────────────────────────────────────────────────────────────
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const windowSchema = z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, 'O início deve ser anterior ao fim');
const dayWindows = z.array(windowSchema).max(6);
const businessHoursSchema = z.object({
  sun: dayWindows.optional(), mon: dayWindows.optional(), tue: dayWindows.optional(), wed: dayWindows.optional(),
  thu: dayWindows.optional(), fri: dayWindows.optional(), sat: dayWindows.optional(),
}).strict();
const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const origin = z.string().max(300).refine((o) => { try { return new URL(o).origin === o.replace(/\/$/, ''); } catch { return false; } }, 'Informe origens no formato https://dominio');

export const orgPatchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  timezone: z.string().refine(validTimezone, 'Fuso horário inválido (use nomes IANA, ex.: America/Araguaina)').optional(),
  businessHours: businessHoursSchema.optional(),
  protocolPrefix: z.string().regex(/^[A-Z0-9]{2,10}$/, 'Use 2 a 10 letras maiúsculas/números').optional(),
  language: z.string().min(2).max(10).optional(),
  contactCategories: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  recordingNotice: z.string().max(1000).optional(),
  outsideHoursMessage: z.string().max(1000).optional(),
  retention: z.object({
    messagesDays: z.number().int().min(1).max(36500).optional(), recordingsDays: z.number().int().min(1).max(36500).optional(),
    auditDays: z.number().int().min(1).max(36500).optional(), logsDays: z.number().int().min(1).max(36500).optional(),
  }).strict().optional(),
  sla: z.object({ firstResponseSec: z.number().int().min(10).max(7 * 86400).optional(), resolutionSec: z.number().int().min(60).max(30 * 86400).optional() }).strict().optional(),
  ai: z.object({
    enabled: z.boolean().optional(), mode: z.enum(['ASSISTED', 'PROGRESSIVE']).optional(), confidenceThreshold: z.number().min(0).max(1).optional(),
    welcomeMessage: z.string().max(1000).optional(), escalationKeywords: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    maxBotTurns: z.number().int().min(1).max(50).optional(),
  }).strict().optional(),
  csat: z.object({ enabled: z.boolean().optional(), prompt: z.string().max(500).optional() }).strict().optional(),
  webchat: z.object({
    allowedOrigins: z.array(origin).max(50).optional(), title: z.string().max(100).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB').optional(), offlineMessage: z.string().max(500).optional(),
  }).strict().optional(),
  whatsapp: z.object({ windowHours: z.number().int().min(1).max(24).optional() }).strict().optional(),
  reopenWindowSec: z.number().int().min(0).max(30 * 86400).optional(),
  security: z.object({ requireMfaRoles: z.array(z.enum(ROLES)).max(4).optional() }).strict().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, 'Informe ao menos um campo');

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Data inválida');
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const holidayBody = z.object({ day: dateStr, name: z.string().trim().min(2).max(120) });
const holidayPatch = z.object({ day: dateStr.optional(), name: z.string().trim().min(2).max(120).optional() }).refine((o) => Object.keys(o).length > 0, 'Informe ao menos um campo');
const holidayBulk = z.object({ items: z.array(holidayBody).min(1).max(500) });
const sectorBody = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(200).nullable().optional() });
const sectorPatch = z.object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().email().max(200).nullable().optional(), active: z.boolean().optional() }).refine((o) => Object.keys(o).length > 0, 'Informe ao menos um campo');
const holidayQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const sectorQuery = z.object({ active: z.enum(['true', 'false']).optional() });

const holidayView = (h: { id: string; day: Date; name: string }) => ({ id: h.id, day: h.day.toISOString().slice(0, 10), name: h.name });

export default async function adminOrgRoutes(app: FastifyInstance): Promise<void> {
  // ── Configurações do órgão ──────────────────────────────────────────────────
  app.get('/admin/org', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const orgId = req.bv!.orgId;
    invalidateOrgSettings(orgId);
    const org = await prisma.bvOrg.findUniqueOrThrow({ where: { id: orgId } });
    const settings = await getOrgSettings(orgId);
    const raw = (org.settings ?? {}) as Record<string, any>;
    return reply.send({
      id: org.id, name: org.name, slug: org.slug, settings, overrides: raw,
      security: { requireMfaRoles: Array.isArray(raw.security?.requireMfaRoles) ? raw.security.requireMfaRoles : [] },
    });
  }));

  app.patch('/admin/org', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const body = parse(orgPatchSchema, req.body, reply); if (!body) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvOrg.findUniqueOrThrow({ where: { id: orgId } });
    const { name, ...patch } = body;
    if (name && name !== before.name) await prisma.bvOrg.update({ where: { id: orgId }, data: { name } });
    if (Object.keys(patch).length > 0) await updateOrgSettings(orgId, patch as unknown as Partial<BvOrgSettings>);
    const after = await prisma.bvOrg.findUniqueOrThrow({ where: { id: orgId } });
    await recordConfigVersion(orgId, 'org-settings', orgId, { name: after.name, settings: after.settings }, req.bv!.userId);
    await auditReq(req, 'org.update', { entityType: 'org', entityId: orgId, before: { name: before.name, settings: before.settings }, after: { name: after.name, settings: after.settings } });
    return reply.send({ id: after.id, name: after.name, slug: after.slug, settings: await getOrgSettings(orgId), overrides: after.settings });
  }));

  // ── Setores ─────────────────────────────────────────────────────────────────
  app.get('/admin/sectors', { preHandler: guardAny('user:manage', 'queue:manage') }, route(async (req, reply) => {
    const q = parse(sectorQuery, req.query, reply); if (!q) return;
    const items = await prisma.bvSector.findMany({ where: { orgId: req.bv!.orgId, ...(q.active ? { active: q.active === 'true' } : {}) }, orderBy: { name: 'asc' }, take: 500 });
    return reply.send({ items });
  }));

  app.post('/admin/sectors', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const body = parse(sectorBody, req.body, reply); if (!body) return;
    try {
      const s = await prisma.bvSector.create({ data: { orgId: req.bv!.orgId, name: body.name, email: body.email ?? null } });
      await auditReq(req, 'sector.create', { entityType: 'sector', entityId: s.id, after: s });
      return reply.code(201).send(s);
    } catch (e) {
      if (uniqueTarget(e)) throw new IamError(409, 'sector.name_taken', 'Já existe um setor com este nome.');
      throw e;
    }
  }));

  app.patch('/admin/sectors/:id', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const p = parse(idParam, req.params, reply); const body = parse(sectorPatch, req.body, reply); if (!p || !body) return;
    const before = await prisma.bvSector.findFirst({ where: { id: p.id, orgId: req.bv!.orgId } });
    if (!before) return sendError(reply, 404, 'sector.not_found', 'Setor não encontrado.');
    try {
      const after = await prisma.bvSector.update({ where: { id: before.id }, data: body });
      await auditReq(req, 'sector.update', { entityType: 'sector', entityId: before.id, before, after });
      return reply.send(after);
    } catch (e) {
      if (uniqueTarget(e)) throw new IamError(409, 'sector.name_taken', 'Já existe um setor com este nome.');
      throw e;
    }
  }));

  app.delete('/admin/sectors/:id', { preHandler: guard('user:manage') }, route(async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvSector.findFirst({ where: { id: p.id, orgId } });
    if (!before) return sendError(reply, 404, 'sector.not_found', 'Setor não encontrado.');
    const [users, queues] = await Promise.all([prisma.bvUser.count({ where: { orgId, sectorId: before.id } }), prisma.bvQueue.count({ where: { orgId, sectorId: before.id } })]);
    if (users + queues > 0) throw new IamError(409, 'sector.in_use', 'O setor está em uso por usuários ou filas. Desative-o (PATCH active=false) em vez de excluir.', { users, queues });
    await prisma.bvSector.delete({ where: { id: before.id } });
    await auditReq(req, 'sector.delete', { entityType: 'sector', entityId: before.id, before });
    return reply.send({ ok: true });
  }));

  // ── Feriados ────────────────────────────────────────────────────────────────
  app.get('/admin/holidays', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const q = parse(holidayQuery, req.query, reply); if (!q) return;
    const where = { orgId: req.bv!.orgId, ...(q.year ? { day: { gte: toDate(`${q.year}-01-01`), lte: toDate(`${q.year}-12-31`) } } : {}) };
    const rows = await prisma.bvHoliday.findMany({ where, orderBy: { day: 'asc' }, take: 2000 });
    return reply.send({ items: rows.map(holidayView) });
  }));

  app.post('/admin/holidays', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const body = parse(holidayBody, req.body, reply); if (!body) return;
    const orgId = req.bv!.orgId;
    try {
      const h = await prisma.bvHoliday.create({ data: { orgId, day: toDate(body.day), name: body.name } });
      invalidateHolidays(orgId);
      await auditReq(req, 'holiday.create', { entityType: 'holiday', entityId: h.id, after: holidayView(h) });
      return reply.code(201).send(holidayView(h));
    } catch (e) {
      if (uniqueTarget(e)) throw new IamError(409, 'holiday.exists', 'Já existe um feriado nesta data.');
      throw e;
    }
  }));

  app.post('/admin/holidays/bulk', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const body = parse(holidayBulk, req.body, reply); if (!body) return;
    const orgId = req.bv!.orgId;
    for (const it of body.items) {
      await prisma.bvHoliday.upsert({ where: { orgId_day: { orgId, day: toDate(it.day) } }, create: { orgId, day: toDate(it.day), name: it.name }, update: { name: it.name } });
    }
    invalidateHolidays(orgId);
    await auditReq(req, 'holiday.bulk_upsert', { entityType: 'holiday', meta: { count: body.items.length } });
    return reply.send({ ok: true, count: body.items.length });
  }));

  app.patch('/admin/holidays/:id', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const p = parse(idParam, req.params, reply); const body = parse(holidayPatch, req.body, reply); if (!p || !body) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvHoliday.findFirst({ where: { id: p.id, orgId } });
    if (!before) return sendError(reply, 404, 'holiday.not_found', 'Feriado não encontrado.');
    try {
      const after = await prisma.bvHoliday.update({ where: { id: before.id }, data: { ...(body.day ? { day: toDate(body.day) } : {}), ...(body.name ? { name: body.name } : {}) } });
      invalidateHolidays(orgId);
      await auditReq(req, 'holiday.update', { entityType: 'holiday', entityId: before.id, before: holidayView(before), after: holidayView(after) });
      return reply.send(holidayView(after));
    } catch (e) {
      if (uniqueTarget(e)) throw new IamError(409, 'holiday.exists', 'Já existe um feriado nesta data.');
      throw e;
    }
  }));

  app.delete('/admin/holidays/:id', { preHandler: guard('org:manage') }, route(async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const orgId = req.bv!.orgId;
    const before = await prisma.bvHoliday.findFirst({ where: { id: p.id, orgId } });
    if (!before) return sendError(reply, 404, 'holiday.not_found', 'Feriado não encontrado.');
    await prisma.bvHoliday.delete({ where: { id: before.id } });
    invalidateHolidays(orgId);
    await auditReq(req, 'holiday.delete', { entityType: 'holiday', entityId: before.id, before: holidayView(before) });
    return reply.send({ ok: true });
  }));
}
