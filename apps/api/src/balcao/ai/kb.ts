import type { BvKbArticle, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../core/audit';
import { emitToUser } from '../core/realtime';
import { normalizeText } from './text';

/**
 * Base de conhecimento: ciclo DRAFT → PENDING_REVIEW → APPROVED/REJECTED → ARCHIVED, versionamento,
 * revisão periódica, importação em lote, feedback e métricas. A busca fica em search.ts.
 * Só artigos APPROVED alimentam o chatbot (resposta ancorada — decisão D9).
 */
export class KbError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export const REVIEW_INTERVAL_DAYS_DEFAULT = 180;
export type ArticleStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';

export interface ArticleInput { title: string; question: string; answer: string; category?: string | null; tags?: string[]; language?: string }
export type Article = BvKbArticle;

const CONTENT_FIELDS = ['title', 'question', 'answer', 'category', 'tags'] as const;

const snapshotOf = (a: Pick<BvKbArticle, 'title' | 'question' | 'answer' | 'category' | 'tags' | 'language' | 'status'>) =>
  ({ title: a.title, question: a.question, answer: a.answer, category: a.category, tags: a.tags, language: a.language, status: a.status });

async function writeVersion(a: BvKbArticle, changedById?: string | null, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await tx.bvKbArticleVersion.create({ data: { articleId: a.id, version: a.version, snapshot: snapshotOf(a) as any, changedById: changedById ?? null } });
}

export async function getArticle(orgId: string, id: string): Promise<Article> {
  const a = await prisma.bvKbArticle.findFirst({ where: { id, orgId } });
  if (!a) throw new KbError('kb.not_found', 'Artigo não encontrado', 404);
  return a;
}

export async function createArticle(orgId: string, userId: string | null, input: ArticleInput, extra: { source?: 'MANUAL' | 'CURATORSHIP' | 'IMPORT'; status?: 'DRAFT' | 'PENDING_REVIEW'; sourceConversationIds?: string[] } = {}): Promise<Article> {
  return prisma.$transaction(async (tx) => {
    const a = await tx.bvKbArticle.create({
      data: {
        orgId, title: input.title.trim(), question: input.question.trim(), answer: input.answer.trim(), category: input.category ?? null,
        tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean), language: input.language ?? 'pt-BR',
        status: extra.status ?? 'DRAFT', source: extra.source ?? 'MANUAL', sourceConversationIds: extra.sourceConversationIds ?? [], authorId: userId,
      },
    });
    await writeVersion(a, userId, tx);
    return a;
  });
}

/**
 * Edita um artigo. Mudança de conteúdo (título/pergunta/resposta/categoria/tags) gera nova versão.
 *  - REJECTED volta a DRAFT; ARCHIVED não é editável;
 *  - APPROVED editado por quem NÃO tem kb:approve volta a PENDING_REVIEW (sai do bot até nova aprovação);
 *    quem tem kb:approve mantém APPROVED (a própria edição é a revisão) e a data de revisão é renovada.
 */
export async function updateArticle(orgId: string, id: string, userId: string | null, patch: Partial<ArticleInput>, canApprove: boolean): Promise<Article> {
  const cur = await getArticle(orgId, id);
  if (cur.status === 'ARCHIVED') throw new KbError('kb.archived', 'Artigo arquivado não pode ser editado (restaure-o antes)', 409);
  const next: Record<string, any> = {};
  let relevant = false;
  for (const f of CONTENT_FIELDS) {
    const v = (patch as any)[f];
    if (v === undefined) continue;
    const value = typeof v === 'string' ? v.trim() : f === 'tags' ? (v as string[]).map((t) => t.trim()).filter(Boolean) : v;
    if (JSON.stringify(value) !== JSON.stringify((cur as any)[f])) { next[f] = value; relevant = true; }
  }
  if (patch.language && patch.language !== cur.language) next.language = patch.language;
  if (!relevant && !Object.keys(next).length) return cur;
  if (relevant) {
    next.version = cur.version + 1;
    if (cur.status === 'REJECTED') { next.status = 'DRAFT'; next.rejectedReason = null; }
    if (cur.status === 'APPROVED') {
      if (canApprove) { next.approvedById = userId; next.approvedAt = new Date(); next.nextReviewAt = addDays(new Date(), REVIEW_INTERVAL_DAYS_DEFAULT); }
      else { next.status = 'PENDING_REVIEW'; next.approvedById = null; next.approvedAt = null; }
    }
  }
  return prisma.$transaction(async (tx) => {
    // updateMany com a versão atual evita duas edições simultâneas gerarem a mesma versão
    const r = await tx.bvKbArticle.updateMany({ where: { id, orgId, version: cur.version, status: cur.status }, data: next });
    if (r.count === 0) throw new KbError('kb.conflict', 'O artigo foi alterado por outra pessoa; recarregue e tente de novo', 409);
    const a = await tx.bvKbArticle.findUniqueOrThrow({ where: { id } });
    if (relevant) await writeVersion(a, userId, tx);
    return a;
  });
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

async function transition(orgId: string, id: string, from: ArticleStatus[], data: Prisma.BvKbArticleUpdateManyMutationInput, userId: string | null, errMsg: string): Promise<Article> {
  const res = await prisma.bvKbArticle.updateMany({ where: { id, orgId, status: { in: from } }, data });
  if (res.count === 0) {
    const a = await getArticle(orgId, id); // 404 se não existir
    throw new KbError('kb.invalid_transition', `${errMsg} (status atual: ${a.status})`, 409);
  }
  const a = await getArticle(orgId, id);
  void userId;
  return a;
}

export const submitForReview = (orgId: string, id: string, userId: string | null) =>
  transition(orgId, id, ['DRAFT', 'REJECTED'], { status: 'PENDING_REVIEW', rejectedReason: null }, userId, 'Só rascunhos ou rejeitados podem ser enviados para revisão');

export interface ApprovalResult { article: Article; warnings: string[] }

export async function approveArticle(orgId: string, id: string, approverId: string, opts: { reviewInDays?: number } = {}): Promise<ApprovalResult> {
  const cur = await getArticle(orgId, id);
  const warnings: string[] = [];
  if (cur.authorId && cur.authorId === approverId) {
    // Recomendação, não bloqueio: só avisa se existir outro supervisor/admin que poderia aprovar.
    const others = await prisma.bvUser.count({ where: { orgId, active: true, id: { not: approverId }, role: { in: ['SUPERVISOR', 'ADMIN'] } } });
    if (others > 0) {
      warnings.push('SELF_APPROVAL: o autor aprovou o próprio artigo havendo outro supervisor disponível (recomenda-se revisão por outra pessoa)');
      await audit({ orgId, actorId: approverId, action: 'kb.self_approval', entityType: 'BvKbArticle', entityId: id });
    }
  }
  const article = await transition(orgId, id, ['PENDING_REVIEW'], {
    status: 'APPROVED', approvedById: approverId, approvedAt: new Date(), rejectedReason: null,
    nextReviewAt: addDays(new Date(), opts.reviewInDays ?? REVIEW_INTERVAL_DAYS_DEFAULT),
  }, approverId, 'Só artigos pendentes de revisão podem ser aprovados');
  return { article, warnings };
}

export const rejectArticle = (orgId: string, id: string, userId: string, reason: string) =>
  transition(orgId, id, ['PENDING_REVIEW'], { status: 'REJECTED', rejectedReason: reason, approvedById: null, approvedAt: null }, userId, 'Só artigos pendentes de revisão podem ser rejeitados');

export const archiveArticle = (orgId: string, id: string, userId: string | null) =>
  transition(orgId, id, ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'], { status: 'ARCHIVED' }, userId, 'Artigo já arquivado');

export const restoreArticle = (orgId: string, id: string, userId: string | null) =>
  transition(orgId, id, ['ARCHIVED'], { status: 'DRAFT', approvedById: null, approvedAt: null, nextReviewAt: null }, userId, 'Só artigos arquivados podem ser restaurados');

/** Marca o artigo como revisado (conteúdo continua válido): renova nextReviewAt sem nova versão. */
export async function markReviewed(orgId: string, id: string, userId: string, inDays = REVIEW_INTERVAL_DAYS_DEFAULT): Promise<Article> {
  return transition(orgId, id, ['APPROVED'], { nextReviewAt: addDays(new Date(), inDays) }, userId, 'Só artigos aprovados têm revisão periódica');
}

export async function listVersions(orgId: string, id: string) {
  await getArticle(orgId, id);
  return prisma.bvKbArticleVersion.findMany({ where: { articleId: id }, orderBy: { version: 'desc' }, take: 200 });
}

/** Restaura o conteúdo de uma versão antiga como NOVA versão (o histórico nunca é reescrito). */
export async function revertToVersion(orgId: string, id: string, version: number, userId: string, canApprove: boolean): Promise<Article> {
  await getArticle(orgId, id);
  const v = await prisma.bvKbArticleVersion.findUnique({ where: { articleId_version: { articleId: id, version } } });
  if (!v) throw new KbError('kb.version_not_found', 'Versão não encontrada', 404);
  const s = v.snapshot as any;
  return updateArticle(orgId, id, userId, { title: s.title, question: s.question, answer: s.answer, category: s.category, tags: s.tags }, canApprove);
}

export interface ListFilter { status?: ArticleStatus; category?: string; tag?: string; source?: string; q?: string; limit?: number; cursor?: string }

export async function listArticles(orgId: string, f: ListFilter) {
  const limit = Math.min(f.limit ?? 50, 200);
  const where: Prisma.BvKbArticleWhereInput = {
    orgId, ...(f.status ? { status: f.status } : {}), ...(f.category ? { category: f.category } : {}),
    ...(f.tag ? { tags: { has: f.tag } } : {}), ...(f.source ? { source: f.source } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, { question: { contains: f.q, mode: 'insensitive' } }, { answer: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const rows = await prisma.bvKbArticle.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Contabiliza uso (resposta enviada) dos artigos. */
export async function markUsed(orgId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.bvKbArticle.updateMany({ where: { orgId, id: { in: ids } }, data: { useCount: { increment: 1 } } });
}

/** Feedback "útil/não útil". `útil` incrementa helpfulCount; o "não útil" fica na trilha de auditoria (sem coluna própria). */
export async function recordArticleFeedback(orgId: string, id: string, helpful: boolean, actorId: string | null, extra: { conversationId?: string; source?: string } = {}): Promise<Article> {
  await getArticle(orgId, id);
  if (helpful) await prisma.bvKbArticle.update({ where: { id }, data: { helpfulCount: { increment: 1 } } });
  await audit({ orgId, actorType: actorId ? 'USER' : 'SYSTEM', actorId, action: helpful ? 'kb.feedback.helpful' : 'kb.feedback.unhelpful', entityType: 'BvKbArticle', entityId: id, meta: extra });
  return getArticle(orgId, id);
}

export async function kbMetrics(orgId: string) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byStatus, due, top, agg, fb] = await Promise.all([
    prisma.bvKbArticle.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
    prisma.bvKbArticle.count({ where: { orgId, status: 'APPROVED', nextReviewAt: { lte: new Date() } } }),
    prisma.bvKbArticle.findMany({ where: { orgId, status: 'APPROVED' }, orderBy: [{ useCount: 'desc' }, { id: 'asc' }], take: 5, select: { id: true, title: true, useCount: true, helpfulCount: true } }),
    prisma.bvKbArticle.aggregate({ where: { orgId, status: 'APPROVED' }, _sum: { useCount: true, helpfulCount: true } }),
    prisma.bvAuditLog.groupBy({ by: ['action'], where: { orgId, action: { in: ['kb.feedback.helpful', 'kb.feedback.unhelpful'] }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { DRAFT: 0, PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0, ARCHIVED: 0 };
  for (const r of byStatus) counts[r.status] = r._count._all;
  const helpful = fb.find((x) => x.action === 'kb.feedback.helpful')?._count._all ?? 0;
  const unhelpful = fb.find((x) => x.action === 'kb.feedback.unhelpful')?._count._all ?? 0;
  const used = agg._sum.useCount ?? 0;
  return {
    byStatus: counts, total: Object.values(counts).reduce((a, b) => a + b, 0), reviewDue: due, topUsed: top,
    totalUses: used, totalHelpful: agg._sum.helpfulCount ?? 0,
    helpfulRate: used ? Math.min(1, (agg._sum.helpfulCount ?? 0) / used) : null,
    feedback30d: { helpful, unhelpful, helpfulRate: helpful + unhelpful ? helpful / (helpful + unhelpful) : null },
  };
}

// ── Importação em lote ───────────────────────────────────────────────────────

/** Parser CSV (RFC 4180 simplificado): aspas, aspas escapadas, quebras de linha em campos; delimitador `,` ou `;`. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof ArticleInput | 'tags'> = {
  title: 'title', titulo: 'title', question: 'question', pergunta: 'question', answer: 'answer', resposta: 'answer',
  category: 'category', categoria: 'category', tags: 'tags', etiquetas: 'tags',
};

export function csvToArticles(csv: string): Array<Record<string, unknown>> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => HEADER_ALIASES[normalizeText(h)] ?? null);
  return rows.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    header.forEach((k, i) => { if (k && r[i] !== undefined) o[k] = k === 'tags' ? r[i].split(/[|;,]/).map((t) => t.trim()).filter(Boolean) : r[i].trim(); });
    return o;
  });
}

export interface ImportResult { created: number; skipped: number; errors: Array<{ row: number; message: string }>; articleIds: string[] }

/** Importa em lote como PENDING_REVIEW (source IMPORT). Perguntas já existentes (não arquivadas) são ignoradas. */
export async function importArticles(orgId: string, userId: string | null, rows: Array<Record<string, unknown>>, validate: (r: unknown) => ArticleInput | string): Promise<ImportResult> {
  const existing = await prisma.bvKbArticle.findMany({ where: { orgId, status: { not: 'ARCHIVED' } }, select: { question: true }, take: 20000 });
  const seen = new Set(existing.map((e) => normalizeText(e.question)));
  const res: ImportResult = { created: 0, skipped: 0, errors: [], articleIds: [] };
  for (let i = 0; i < rows.length; i++) {
    const v = validate(rows[i]);
    if (typeof v === 'string') { res.errors.push({ row: i + 1, message: v }); continue; }
    const key = normalizeText(v.question);
    if (seen.has(key)) { res.skipped++; res.errors.push({ row: i + 1, message: 'Pergunta já existe na base (ignorada)' }); continue; }
    seen.add(key);
    const a = await createArticle(orgId, userId, v, { source: 'IMPORT', status: 'PENDING_REVIEW' });
    res.created++; res.articleIds.push(a.id);
  }
  return res;
}

// ── Revisão periódica (job) ──────────────────────────────────────────────────

/** Notifica supervisores/admins sobre artigos APPROVED com revisão vencida (1 aviso por artigo a cada 7 dias). */
export async function runKbReviewJob(now = new Date()): Promise<{ notified: number; articles: number }> {
  const due = await prisma.bvKbArticle.findMany({
    where: { status: 'APPROVED', nextReviewAt: { lte: now } }, select: { id: true, orgId: true, title: true, nextReviewAt: true }, orderBy: { nextReviewAt: 'asc' }, take: 1000,
  });
  const byOrg = new Map<string, typeof due>();
  for (const a of due) byOrg.set(a.orgId, [...(byOrg.get(a.orgId) ?? []), a]);
  let notified = 0;
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  for (const [orgId, list] of byOrg) {
    const sups = await prisma.bvUser.findMany({ where: { orgId, active: true, role: { in: ['SUPERVISOR', 'ADMIN'] } }, select: { id: true } });
    for (const a of list) {
      for (const u of sups) {
        const dup = await prisma.bvNotification.findFirst({ where: { userId: u.id, type: 'KB_REVIEW_DUE', createdAt: { gte: weekAgo }, data: { path: ['articleId'], equals: a.id } }, select: { id: true } });
        if (dup) continue;
        const n = await prisma.bvNotification.create({
          data: { orgId, userId: u.id, type: 'KB_REVIEW_DUE', title: `Revisão pendente: ${a.title.slice(0, 120)}`, body: 'O prazo de revisão deste artigo da base de conhecimento venceu.', data: { articleId: a.id, dueAt: a.nextReviewAt } as any },
        });
        emitToUser(u.id, 'notification', { id: n.id, type: n.type, title: n.title, data: n.data });
        notified++;
      }
    }
  }
  return { notified, articles: due.length };
}
