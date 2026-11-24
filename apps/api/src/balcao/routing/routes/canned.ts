import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BvCannedResponse } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { idParam, parse, sendError } from '../../core/http';
import { can } from '../../core/permissions';
import { actor, guardUser, isUniqueViolation, notFound } from './common';

const shortcut = z.string().trim().transform((s) => s.replace(/^\/+/, '').toLowerCase()).pipe(z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Use de 1 a 32 letras, números, _ ou -'));
const fields = { shortcut, title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4096) };
const createSchema = z.strictObject({ ...fields, scope: z.enum(['PERSONAL', 'ORG']).optional() });
const patchSchema = z.strictObject(fields).partial();

type Scope = 'PERSONAL' | 'ORG';
const scopeOf = (r: Pick<BvCannedResponse, 'ownerId'>): Scope => (r.ownerId ? 'PERSONAL' : 'ORG');
const taken = (reply: FastifyReply) => sendError(reply, 409, 'canned.shortcut_taken', 'Já existe resposta pronta com este atalho');

/**
 * Respostas prontas. Dois escopos: do ÓRGÃO (`ownerId` nulo; escrita exige queue:manage) e PESSOAIS (`ownerId` = usuário;
 * o atendente com conversation:reply cria/edita/exclui só as suas e ninguém mais as enxerga). Atalho único por órgão
 * entre as do órgão e único por dono entre as pessoais; o pessoal pode repetir o atalho de uma do órgão (e vence na listagem).
 */
export async function cannedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/canned-responses', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const q = parse(z.object({ q: z.string().trim().max(60).optional(), includeShadowed: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).optional() }), req.query, reply); if (!q) return;
    const a = actor(req);
    const rows = await prisma.bvCannedResponse.findMany({
      where: {
        orgId: a.orgId, OR: [{ ownerId: null }, { ownerId: a.userId }],
        ...(q.q ? { AND: [{ OR: [{ shortcut: { contains: q.q.replace(/^\//, ''), mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] }] } : {}),
      },
      orderBy: { shortcut: 'asc' }, take: 1000,
    });
    // Pessoais primeiro (por atalho), depois as do órgão; a pessoal "sobrescreve" a do órgão de mesmo atalho.
    const personal = rows.filter((r) => r.ownerId);
    const mine = new Set(personal.map((r) => r.shortcut));
    const org = rows.filter((r) => !r.ownerId);
    const items = [
      ...personal.map((r) => ({ ...r, scope: scopeOf(r), shadowsOrg: org.some((o) => o.shortcut === r.shortcut) })),
      ...org.filter((r) => q.includeShadowed || !mine.has(r.shortcut)).map((r) => ({ ...r, scope: scopeOf(r), shadowsOrg: false, shadowed: mine.has(r.shortcut) })),
    ].slice(0, 500);
    return { items };
  });

  app.post('/canned-responses', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const b = parse(createSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    // Sem `scope`: quem gerencia filas cria do órgão (comportamento anterior); atendente cria pessoal.
    const scope: Scope = b.scope ?? (can(a.role, 'queue:manage') ? 'ORG' : 'PERSONAL');
    if (scope === 'ORG' && !can(a.role, 'queue:manage')) return sendError(reply, 403, 'auth.forbidden', 'Só a gestão cria respostas prontas do órgão');
    if (scope === 'PERSONAL' && !can(a.role, 'conversation:reply')) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para esta ação');
    const { scope: _s, ...data } = b;
    try {
      const r = await prisma.bvCannedResponse.create({ data: { orgId: a.orgId, ownerId: scope === 'PERSONAL' ? a.userId : null, ...data } });
      await auditReq(req, 'canned-response.create', { entityType: 'canned-response', entityId: r.id, meta: { shortcut: r.shortcut, scope } });
      return reply.code(201).send({ item: { ...r, scope } });
    } catch (e) {
      if (isUniqueViolation(e)) return taken(reply);
      throw e;
    }
  });

  /** Carrega a resposta que o usuário pode alterar: a própria (pessoal) ou do órgão (queue:manage). Outra pessoal → 404. */
  async function loadWritable(req: Parameters<typeof actor>[0], reply: FastifyReply, id: string): Promise<BvCannedResponse | null> {
    const a = actor(req);
    const cur = await prisma.bvCannedResponse.findFirst({ where: { id, orgId: a.orgId, OR: [{ ownerId: null }, { ownerId: a.userId }] } });
    if (!cur) { notFound(reply, 'Resposta pronta'); return null; }
    if (cur.ownerId === null && !can(a.role, 'queue:manage')) { sendError(reply, 403, 'auth.forbidden', 'Só a gestão altera respostas prontas do órgão'); return null; }
    if (cur.ownerId !== null && !can(a.role, 'conversation:reply')) { sendError(reply, 403, 'auth.forbidden', 'Sem permissão para esta ação'); return null; }
    return cur;
  }

  app.patch('/canned-responses/:id', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(patchSchema, req.body, reply); if (!b) return;
    const cur = await loadWritable(req, reply, p.id); if (!cur) return;
    try {
      const r = await prisma.bvCannedResponse.update({ where: { id: cur.id }, data: b });
      await auditReq(req, 'canned-response.update', { entityType: 'canned-response', entityId: r.id, meta: { fields: Object.keys(b), scope: scopeOf(r) } });
      return { item: { ...r, scope: scopeOf(r) } };
    } catch (e) {
      if (isUniqueViolation(e)) return taken(reply);
      throw e;
    }
  });

  app.delete('/canned-responses/:id', { preHandler: guardUser('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const cur = await loadWritable(req, reply, p.id); if (!cur) return;
    await prisma.bvCannedResponse.delete({ where: { id: cur.id } });
    await auditReq(req, 'canned-response.delete', { entityType: 'canned-response', entityId: cur.id, meta: { shortcut: cur.shortcut, scope: scopeOf(cur) } });
    return reply.code(204).send();
  });
}
