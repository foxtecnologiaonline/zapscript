import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { auditReq } from '../../core/audit';
import { getContactDocument, maskDocument, mergeContacts, normalizeDocument, normalizeEmail, normalizePhone, setContactDocument } from '../../core/contacts';
import { blindIndex } from '../../core/crypto';
import { idParam, parse, sendError } from '../../core/http';
import { can } from '../../core/permissions';
import { getOrgSettings } from '../../core/settings';
import { actor, decodeCursor, encodeCursor, guardUser, isUniqueViolation, notFound, qbool } from './common';

/** Dígitos verificadores de CPF (11) e CNPJ (14). Rejeita sequências repetidas. */
export function validDocument(raw: string): boolean {
  const d = normalizeDocument(raw);
  if (!/^\d+$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, weights: number[]) => { const s = base.split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]; const w2 = [11, ...w1];
    return calc(d.slice(0, 9), w1) === Number(d[9]) && calc(d.slice(0, 10), w2) === Number(d[10]);
  }
  if (d.length === 14) {
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const w2 = [6, ...w1];
    return calc(d.slice(0, 12), w1) === Number(d[12]) && calc(d.slice(0, 13), w2) === Number(d[13]);
  }
  return false;
}

const contactView = (c: { id: string; name: string | null; email: string | null; phone: string | null; category: string; tags: string[]; documentEnc: string | null; identityVerifiedAt: Date | null; govbrLevel: string | null; createdAt: Date }) => ({
  id: c.id, name: c.name, email: c.email, phone: c.phone, category: c.category, tags: c.tags, hasDocument: !!c.documentEnc,
  identityVerifiedAt: c.identityVerifiedAt, govbrLevel: c.govbrLevel, createdAt: c.createdAt,
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contacts/categories', { preHandler: guardUser('contact:read') }, async (req) => ({ items: (await getOrgSettings(actor(req).orgId)).contactCategories }));

  app.get('/contacts', { preHandler: guardUser('contact:read') }, async (req, reply) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(120).optional(), category: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().optional() }), req.query, reply); if (!q) return;
    const a = actor(req);
    const and: Prisma.BvContactWhereInput[] = [{ orgId: a.orgId, mergedIntoId: null, anonymizedAt: null }];
    if (q.category) and.push({ category: q.category });
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const or: Prisma.BvContactWhereInput[] = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }];
      if (digits.length >= 4) or.push({ phone: { contains: normalizePhone(digits) ?? digits } });
      if (digits.length === 11 || digits.length === 14) or.push({ documentHash: blindIndex(digits) });
      if (/^[a-z]{1,6}-\d{4}-\d+$/i.test(q.q)) or.push({ conversations: { some: { orgId: a.orgId, protocol: { equals: q.q, mode: 'insensitive' } } } });
      and.push({ OR: or });
    }
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (cur) and.push({ OR: [{ createdAt: { lt: new Date(cur.t) } }, { createdAt: new Date(cur.t), id: { lt: cur.id } }] });
    const rows = await prisma.bvContact.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const more = rows.length > q.limit; const page = more ? rows.slice(0, q.limit) : rows;
    await auditReq(req, 'contact.search', { entityType: 'contact', meta: { hasQuery: !!q.q, results: page.length } });
    const last = page[page.length - 1];
    return { items: page.map(contactView), nextCursor: more && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null };
  });

  app.get('/contacts/:id', { preHandler: guardUser('contact:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const q = parse(z.object({ reveal: qbool, limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query, reply); if (!q) return;
    const a = actor(req);
    const c = await prisma.bvContact.findFirst({ where: { id: p.id, orgId: a.orgId }, include: { identities: { select: { channel: true, externalId: true, createdAt: true } } } });
    if (!c || c.anonymizedAt) return notFound(reply, 'Contato');
    if (c.mergedIntoId) return sendError(reply, 404, 'contact.merged', 'Contato foi mesclado em outro', { mergedIntoId: c.mergedIntoId });
    let document: string | null = null;
    if (c.documentEnc) {
      const full = getContactDocument(c.documentEnc)!;
      if (q.reveal) {
        if (!can(a.role, 'contact:lgpd')) return sendError(reply, 403, 'auth.forbidden', 'Documento completo exige permissão LGPD');
        document = full;
        await auditReq(req, 'contact.document.reveal', { entityType: 'contact', entityId: c.id });
      } else document = maskDocument(full);
    }
    // histórico unificado entre canais: só metadados (mensagens exigem abrir a conversa, com checagem de acesso)
    const history = await prisma.bvConversation.findMany({
      where: { orgId: a.orgId, contactId: c.id }, orderBy: { startedAt: 'desc' }, take: q.limit,
      select: { id: true, protocol: true, channel: true, status: true, category: true, subject: true, startedAt: true, closedAt: true, closeReason: true, queueId: true, assignedUserId: true, csatScore: true },
    });
    await auditReq(req, 'contact.read', { entityType: 'contact', entityId: c.id });
    return { contact: { ...contactView(c), document, identities: c.identities }, conversations: history };
  });

  const patchSchema = z.strictObject({
    name: z.string().trim().min(1).max(200).nullable(), email: z.string().trim().email().max(200).nullable(), phone: z.string().trim().max(30).nullable(),
    category: z.string().trim().min(1).max(40), tags: z.array(z.string().trim().min(1).max(40)).max(30),
  }).partial();
  app.patch('/contacts/:id', { preHandler: guardUser('contact:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(patchSchema, req.body, reply); if (!b) return;
    const a = actor(req);
    const c = await prisma.bvContact.findFirst({ where: { id: p.id, orgId: a.orgId, mergedIntoId: null, anonymizedAt: null } });
    if (!c) return notFound(reply, 'Contato');
    const data: Prisma.BvContactUpdateInput = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.email !== undefined) data.email = normalizeEmail(b.email);
    if (b.phone !== undefined) {
      const ph = b.phone === null ? null : normalizePhone(b.phone);
      if (b.phone !== null && !ph) return sendError(reply, 400, 'validation.failed', 'Telefone inválido');
      data.phone = ph;
    }
    if (b.category !== undefined) {
      if (!(await getOrgSettings(a.orgId)).contactCategories.includes(b.category)) return sendError(reply, 400, 'contact.invalid_category', 'Categoria não cadastrada para o órgão');
      data.category = b.category;
    }
    if (b.tags !== undefined) data.tags = [...new Set(b.tags)];
    const u = await prisma.bvContact.update({ where: { id: c.id }, data });
    await auditReq(req, 'contact.update', { entityType: 'contact', entityId: c.id, meta: { fields: Object.keys(b) } });
    return { contact: contactView(u) };
  });

  app.post('/contacts/:id/document', { preHandler: guardUser('contact:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(z.strictObject({ document: z.string().trim().min(11).max(20) }), req.body, reply); if (!b) return;
    const a = actor(req);
    const c = await prisma.bvContact.findFirst({ where: { id: p.id, orgId: a.orgId, mergedIntoId: null, anonymizedAt: null }, select: { id: true } });
    if (!c) return notFound(reply, 'Contato');
    if (!validDocument(b.document)) return sendError(reply, 400, 'contact.invalid_document', 'CPF/CNPJ inválido');
    try { await setContactDocument(c.id, b.document); } catch (e) {
      if (isUniqueViolation(e)) return sendError(reply, 409, 'contact.document_conflict', 'Já existe outro contato com este documento; use a mesclagem');
      throw e;
    }
    await auditReq(req, 'contact.document.set', { entityType: 'contact', entityId: c.id });
    return { ok: true, document: maskDocument(normalizeDocument(b.document)) };
  });

  // Mesclagem é irreversível: exige perfil com permissão LGPD (supervisão/administração).
  app.post('/contacts/merge', { preHandler: guardUser('contact:lgpd') }, async (req, reply) => {
    const b = parse(z.strictObject({ intoId: z.string().min(1).max(64), fromId: z.string().min(1).max(64) }), req.body, reply); if (!b) return;
    const a = actor(req);
    if (b.intoId === b.fromId) return sendError(reply, 400, 'contact.merge_same', 'Escolha contatos diferentes');
    const [into, from] = await Promise.all([
      prisma.bvContact.findFirst({ where: { id: b.intoId, orgId: a.orgId, mergedIntoId: null, anonymizedAt: null } }),
      prisma.bvContact.findFirst({ where: { id: b.fromId, orgId: a.orgId, mergedIntoId: null, anonymizedAt: null } }),
    ]);
    if (!into || !from) return notFound(reply, 'Contato');
    await mergeContacts(a.orgId, into.id, from.id);
    // o núcleo zera o documentHash do mesclado; se o destino não tinha documento, herda o do mesclado
    const patch: Prisma.BvContactUpdateInput = { tags: [...new Set([...into.tags, ...from.tags])] };
    if (!into.documentEnc && from.documentEnc) { patch.documentEnc = from.documentEnc; patch.documentHash = from.documentHash; }
    if (!into.name && from.name) patch.name = from.name;
    if (!into.email && from.email) patch.email = from.email;
    if (!into.phone && from.phone) patch.phone = from.phone;
    await prisma.bvContact.update({ where: { id: into.id }, data: patch });
    await auditReq(req, 'contact.merge', { entityType: 'contact', entityId: into.id, meta: { fromId: from.id } });
    return { contactId: into.id };
  });
}
