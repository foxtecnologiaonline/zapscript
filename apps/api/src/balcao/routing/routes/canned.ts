import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { idParam, parse, sendError } from '../../core/http';
import { actor, guardUser, isUniqueViolation, notFound } from './common';

const shortcut = z.string().trim().transform((s) => s.replace(/^\/+/, '').toLowerCase()).pipe(z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Use de 1 a 32 letras, números, _ ou -'));
const createSchema = z.strictObject({ shortcut, title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4096) });
const patchSchema = createSchema.partial();

export async function cannedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/canned-responses', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const q = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query, reply); if (!q) return;
    const items = await prisma.bvCannedResponse.findMany({
      where: { orgId: actor(req).orgId, ...(q.q ? { OR: [{ shortcut: { contains: q.q.replace(/^\//, ''), mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      orderBy: { shortcut: 'asc' }, take: 500,
    });
    return { items };
  });

  // Escrita: respostas prontas são compartilhadas pelo órgão todo, então exige perfil de gestão (queue:manage).
  app.post('/canned-responses', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const b = parse(createSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    try {
      const r = await prisma.bvCannedResponse.create({ data: { orgId: a.orgId, ...b } });
      await auditReq(req, 'canned-response.create', { entityType: 'canned-response', entityId: r.id, meta: { shortcut: r.shortcut } });
      return reply.code(201).send({ item: r });
    } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'canned.shortcut_taken', 'Já existe resposta pronta com este atalho');
      throw e;
    }
  });

  app.patch('/canned-responses/:id', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(patchSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    const cur = await prisma.bvCannedResponse.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!cur) return notFound(reply, 'Resposta pronta');
    try {
      const r = await prisma.bvCannedResponse.update({ where: { id: cur.id }, data: b });
      await auditReq(req, 'canned-response.update', { entityType: 'canned-response', entityId: r.id, meta: { fields: Object.keys(b) } });
      return { item: r };
    } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'canned.shortcut_taken', 'Já existe resposta pronta com este atalho');
      throw e;
    }
  });

  app.delete('/canned-responses/:id', { preHandler: guardUser('queue:manage') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const a = actor(req);
    const cur = await prisma.bvCannedResponse.findFirst({ where: { id: p.id, orgId: a.orgId } });
    if (!cur) return notFound(reply, 'Resposta pronta');
    await prisma.bvCannedResponse.delete({ where: { id: cur.id } });
    await auditReq(req, 'canned-response.delete', { entityType: 'canned-response', entityId: cur.id, meta: { shortcut: cur.shortcut } });
    return reply.code(204).send();
  });
}
