import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { auditReq } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { canAccessConversation } from '../core/conversations';
import { guard, idParam, parse, sendError } from '../core/http';
import { can } from '../core/permissions';
import { getOrgSettings, updateOrgSettings, type BvOrgSettings } from '../core/settings';
import { AssistError, lastSuggestion, summarizeConversation, suggestReply } from './assist';
import { analyzeMessage, aiExtras, type AiMode } from './bot';
import { acceptSuggestion, curationStats, dismissSuggestion, listSuggestions, runCuration } from './curation';
import * as kb from './kb';
import { searchKb } from './search';
import { aiStats } from './stats';

/** Rotas: /balcao/kb/* e /balcao/ai/* (o plugin raiz registra esta frente com prefixo '/'). */
const articleBody = z.object({
  title: z.string().trim().min(3).max(200), question: z.string().trim().min(3).max(1000), answer: z.string().trim().min(3).max(8000),
  category: z.string().trim().max(100).nullish(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(), language: z.string().max(10).optional(),
});
const importRow = (r: unknown): kb.ArticleInput | string => {
  const p = articleBody.safeParse(r);
  if (p.success) return { ...p.data, category: p.data.category ?? null };
  return p.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
};

function handleErr(reply: any, err: unknown) {
  if (err instanceof kb.KbError) return sendError(reply, err.status, err.code, err.message);
  if (err instanceof AssistError) return sendError(reply, err.status, err.code, err.message);
  throw err;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── Artigos ──
  app.get('/kb/articles', { preHandler: guard('kb:read') }, async (req, reply) => {
    const q = parse(z.object({
      status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED']).optional(), category: z.string().optional(), tag: z.string().optional(),
      source: z.string().optional(), q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional(),
    }), req.query, reply); if (!q) return;
    return kb.listArticles(req.bv!.orgId, q);
  });

  app.post('/kb/articles', { preHandler: guard('kb:write') }, async (req, reply) => {
    const b = parse(articleBody, req.body, reply); if (!b) return;
    const a = await kb.createArticle(req.bv!.orgId, req.bv!.userId, { ...b, category: b.category ?? null });
    await auditReq(req, 'kb.article.create', { entityType: 'BvKbArticle', entityId: a.id });
    return reply.code(201).send(a);
  });

  app.get('/kb/articles/:id', { preHandler: guard('kb:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    try { return await kb.getArticle(req.bv!.orgId, p.id); } catch (e) { return handleErr(reply, e); }
  });

  app.put('/kb/articles/:id', { preHandler: guard('kb:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    const b = parse(articleBody.partial(), req.body, reply); if (!b) return;
    try {
      const a = await kb.updateArticle(req.bv!.orgId, p.id, req.bv!.userId, b, can(req.bv!.role, 'kb:approve'));
      await auditReq(req, 'kb.article.update', { entityType: 'BvKbArticle', entityId: a.id, meta: { version: a.version, status: a.status } });
      return a;
    } catch (e) { return handleErr(reply, e); }
  });

  const act = (path: string, perm: 'kb:write' | 'kb:approve', fn: (req: any, id: string, body: any) => Promise<any>, bodySchema: z.ZodTypeAny = z.object({}).passthrough()) =>
    app.post(path, { preHandler: guard(perm) }, async (req, reply) => {
      const p = parse(idParam, req.params, reply); if (!p) return;
      const b = parse(bodySchema, req.body ?? {}, reply); if (!b) return;
      try { return await fn(req, p.id, b); } catch (e) { return handleErr(reply, e); }
    });

  act('/kb/articles/:id/submit', 'kb:write', async (req, id) => {
    const a = await kb.submitForReview(req.bv.orgId, id, req.bv.userId);
    await auditReq(req, 'kb.article.submit', { entityType: 'BvKbArticle', entityId: id });
    return a;
  });
  act('/kb/articles/:id/approve', 'kb:approve', async (req, id, b) => {
    const r = await kb.approveArticle(req.bv.orgId, id, req.bv.userId, { reviewInDays: b.reviewInDays });
    await auditReq(req, 'kb.article.approve', { entityType: 'BvKbArticle', entityId: id, meta: { warnings: r.warnings } });
    return { ...r.article, warnings: r.warnings };
  }, z.object({ reviewInDays: z.number().int().min(7).max(1095).optional() }));
  act('/kb/articles/:id/reject', 'kb:approve', async (req, id, b) => {
    const a = await kb.rejectArticle(req.bv.orgId, id, req.bv.userId, b.reason);
    await auditReq(req, 'kb.article.reject', { entityType: 'BvKbArticle', entityId: id, meta: { reason: b.reason } });
    return a;
  }, z.object({ reason: z.string().trim().min(3).max(1000) }));
  act('/kb/articles/:id/reviewed', 'kb:approve', async (req, id, b) => {
    const a = await kb.markReviewed(req.bv.orgId, id, req.bv.userId, b.reviewInDays);
    await auditReq(req, 'kb.article.reviewed', { entityType: 'BvKbArticle', entityId: id });
    return a;
  }, z.object({ reviewInDays: z.number().int().min(7).max(1095).optional() }));
  app.post('/kb/articles/:id/archive', { preHandler: guard('kb:write') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    try {
      const cur = await kb.getArticle(req.bv!.orgId, p.id);
      if (cur.status === 'APPROVED' && !can(req.bv!.role, 'kb:approve')) return sendError(reply, 403, 'auth.forbidden', 'Arquivar artigo aprovado exige permissão de aprovação');
      const a = await kb.archiveArticle(req.bv!.orgId, p.id, req.bv!.userId);
      await auditReq(req, 'kb.article.archive', { entityType: 'BvKbArticle', entityId: p.id });
      return a;
    } catch (e) { return handleErr(reply, e); }
  });
  act('/kb/articles/:id/restore', 'kb:write', async (req, id) => kb.restoreArticle(req.bv.orgId, id, req.bv.userId));
  act('/kb/articles/:id/feedback', 'kb:read' as any, async (req, id, b) => kb.recordArticleFeedback(req.bv.orgId, id, b.helpful, req.bv.userId, { conversationId: b.conversationId, source: 'agent' }),
    z.object({ helpful: z.boolean(), conversationId: z.string().max(64).optional() }));
  app.get('/kb/articles/:id/versions', { preHandler: guard('kb:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    try { return { items: await kb.listVersions(req.bv!.orgId, p.id) }; } catch (e) { return handleErr(reply, e); }
  });
  act('/kb/articles/:id/revert', 'kb:write', async (req, id, b) => kb.revertToVersion(req.bv.orgId, id, b.version, req.bv.userId, can(req.bv.role, 'kb:approve')),
    z.object({ version: z.number().int().min(1) }));

  // ── Busca, importação, métricas ──
  app.get('/kb/search', { preHandler: guard('kb:read') }, async (req, reply) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(500), limit: z.coerce.number().int().min(1).max(50).default(10) }), req.query, reply); if (!q) return;
    const hits = await searchKb(req.bv!.orgId, q.q, { limit: q.limit });
    return { items: hits.map((h) => ({ ...h, answer: undefined, snippet: h.answer.slice(0, 280) })) };
  });

  app.post('/kb/import', { preHandler: guard('kb:write') }, async (req, reply) => {
    const b = parse(z.union([
      z.object({ format: z.literal('csv'), csv: z.string().min(1).max(2_000_000) }),
      z.object({ format: z.literal('json').optional(), articles: z.array(z.record(z.string(), z.unknown())).min(1).max(500) }),
    ]), req.body, reply); if (!b) return;
    const rows = 'csv' in b ? kb.csvToArticles(b.csv) : b.articles;
    if (!rows.length) return sendError(reply, 400, 'kb.import_empty', 'Nenhuma linha para importar');
    if (rows.length > 500) return sendError(reply, 400, 'kb.import_too_large', 'Máximo de 500 artigos por importação');
    const r = await kb.importArticles(req.bv!.orgId, req.bv!.userId, rows, importRow);
    await auditReq(req, 'kb.import', { entityType: 'BvKbArticle', meta: { created: r.created, skipped: r.skipped, errors: r.errors.length } });
    return reply.code(r.created ? 201 : 200).send(r);
  });

  app.get('/kb/metrics', { preHandler: guard('kb:read') }, async (req) => kb.kbMetrics(req.bv!.orgId));

  // ── Curadoria ──
  app.get('/kb/suggestions', { preHandler: guard('kb:read') }, async (req, reply) => {
    const q = parse(z.object({ status: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED']).default('OPEN'), type: z.enum(['NEW_ARTICLE', 'AMBIGUITY', 'GAP', 'IMPROVE']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query, reply); if (!q) return;
    return { items: await listSuggestions(req.bv!.orgId, q) };
  });
  act('/kb/suggestions/:id/accept', 'kb:write', async (req, id, b) => {
    const r = await acceptSuggestion(req.bv.orgId, id, req.bv.userId, b);
    await auditReq(req, 'kb.suggestion.accept', { entityType: 'BvKbSuggestion', entityId: id, meta: { articleId: r.articleId } });
    return r;
  }, z.object({ title: z.string().trim().min(3).max(200).optional(), question: z.string().trim().min(3).max(1000).optional(), answer: z.string().trim().min(3).max(8000).optional(),
    category: z.string().max(100).nullish(), tags: z.array(z.string().max(40)).max(20).optional(), submitForReview: z.boolean().optional() }));
  act('/kb/suggestions/:id/dismiss', 'kb:write', async (req, id, b) => {
    const s = await dismissSuggestion(req.bv.orgId, id, req.bv.userId, b.reason);
    await auditReq(req, 'kb.suggestion.dismiss', { entityType: 'BvKbSuggestion', entityId: id });
    return s;
  }, z.object({ reason: z.string().max(500).optional() }));
  app.post('/kb/curation/run', { preHandler: guard('kb:approve') }, async (req, reply) => {
    const b = parse(z.object({ days: z.number().int().min(1).max(365).optional(), minCluster: z.number().int().min(2).max(50).optional(), propose: z.boolean().optional() }), req.body ?? {}, reply); if (!b) return;
    const r = await runCuration(req.bv!.orgId, b);
    await auditReq(req, 'kb.curation.run.manual', { meta: { ...r, suggestionIds: undefined } });
    return r;
  });
  app.get('/kb/curation/stats', { preHandler: guard('kb:read') }, async (req, reply) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query, reply); if (!q) return;
    return curationStats(req.bv!.orgId, q.days);
  });

  // ── Config / observabilidade / assistência ──
  const configView = (s: BvOrgSettings) => ({ ...s.ai, agentAssist: aiExtras(s).agentAssist, idleCloseMinutes: aiExtras(s).idleCloseMinutes, handoffMessage: aiExtras(s).handoffMessage });
  app.get('/ai/config', { preHandler: guard('kb:read') }, async (req) => configView(await getOrgSettings(req.bv!.orgId)));
  app.put('/ai/config', { preHandler: guard('kb:approve') }, async (req, reply) => {
    const b = parse(z.object({
      enabled: z.boolean().optional(), mode: z.enum(['ASSISTED', 'PROGRESSIVE']).optional(), confidenceThreshold: z.number().min(0).max(1).optional(),
      welcomeMessage: z.string().max(1000).optional(), escalationKeywords: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
      maxBotTurns: z.number().int().min(1).max(30).optional(), agentAssist: z.boolean().optional(), idleCloseMinutes: z.number().int().min(1).max(1440).optional(),
      handoffMessage: z.string().max(500).optional(),
    }).strict(), req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const before = configView(await getOrgSettings(orgId));
    const next = await updateOrgSettings(orgId, { ai: b } as any);
    const after = configView(next);
    await auditReq(req, 'config.update', { entityType: 'ai.config', entityId: orgId, before, after });
    await recordConfigVersion(orgId, 'ai.config', orgId, after, req.bv!.userId);
    return after;
  });
  app.get('/ai/stats', { preHandler: guard('report:read') }, async (req, reply) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query, reply); if (!q) return;
    return aiStats(req.bv!.orgId, q.days);
  });

  app.post('/ai/test', { preHandler: guard('kb:read') }, async (req, reply) => {
    const b = parse(z.object({ message: z.string().trim().min(1).max(2000), mode: z.enum(['ASSISTED', 'PROGRESSIVE']).optional(), identityLevel: z.enum(['bronze', 'prata', 'ouro']).nullish(),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(10).optional() }), req.body, reply); if (!b) return;
    const orgId = req.bv!.orgId;
    const settings = await getOrgSettings(orgId);
    const mode: AiMode = b.mode ?? (settings.ai.mode === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'ASSISTED');
    const a = await analyzeMessage({
      orgId, settings, mode, text: b.message, history: b.history ?? [],
      state: { botTurns: 0, welcomed: true, lastBotAnswered: false, identityLevel: b.identityLevel ?? null },
    });
    await auditReq(req, 'ai.test', { meta: { action: a.action, reason: a.reason, mode } });
    // modo seco: nada é enviado, escalado ou gravado em conversas
    return { dryRun: true, mode, action: a.action, reason: a.reason ?? null, answer: a.answer ?? a.suggestion ?? null, confidence: a.confidence ?? null, intent: a.intent ?? null, category: a.category ?? null,
      automatable: a.automatable ?? null, articles: a.articles, usedArticleIds: a.usedArticleIds, tool: a.tool ? { name: a.tool.name, minIdentityLevel: a.tool.minIdentityLevel ?? null } : null,
      model: a.model ?? null, tokens: a.tokensIn !== undefined ? { in: a.tokensIn, out: a.tokensOut } : null, piiRedacted: a.debug?.piiFound ?? 0, retrieved: a.debug?.retrieval ?? 0 };
  });

  const convBody = z.object({ conversationId: z.string().min(1).max(64) });
  async function loadConv(req: any, reply: any, conversationId: string) {
    const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId: req.bv.orgId } });
    if (!conv || !(await canAccessConversation(req.bv, conv))) { sendError(reply, 404, 'conversation.not_found', 'Conversa não encontrada'); return null; }
    return conv;
  }
  app.post('/ai/suggest', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const b = parse(convBody, req.body, reply); if (!b) return;
    if (!(await loadConv(req, reply, b.conversationId))) return;
    try { return await suggestReply(req.bv!.orgId, b.conversationId, { emit: false }); } catch (e) { return handleErr(reply, e); }
  });
  app.post('/ai/summarize', { preHandler: guard('conversation:reply') }, async (req, reply) => {
    const b = parse(convBody, req.body, reply); if (!b) return;
    if (!(await loadConv(req, reply, b.conversationId))) return;
    try { return await summarizeConversation(req.bv!.orgId, b.conversationId); } catch (e) { return handleErr(reply, e); }
  });
  /** Última sugestão guardada (triagem do bot / assistência) — usada pelo console ao abrir a conversa. */
  app.get('/ai/conversations/:id/suggestion', { preHandler: guard('conversation:read') }, async (req, reply) => {
    const p = parse(idParam, req.params, reply); if (!p) return;
    if (!(await loadConv(req, reply, p.id))) return;
    return { suggestion: await lastSuggestion(req.bv!.orgId, p.id) };
  });
}
