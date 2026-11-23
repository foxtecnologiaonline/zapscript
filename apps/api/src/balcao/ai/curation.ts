import crypto from 'crypto';
import { z } from 'zod';
import type { BvKbSuggestion, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { audit } from '../core/audit';
import { listMessages } from '../core/messages';
import { getOrgSettings } from '../core/settings';
import { createArticle, KbError } from './kb';
import { extractJsonObject, getLlmClient, type LlmClient } from './llm';
import { callJson, type Parsed } from './llmcall';
import { isGreetingOnly } from './detect';
import { PiiRedactor } from './pii';
import { searchKb } from './search';
import { buildIdf, cosine, jaccard, tfidfVec, tokenize, truncate, type Vec } from './text';

/**
 * Curadoria (TR 1.1.3.1.5.2.1): minera conversas SEM cobertura da base, agrupa perguntas parecidas
 * (normalização + TF-IDF/Jaccard, sem embeddings), detecta ambiguidades e PROPÕE texto (LLM forte) a partir das
 * respostas reais dos atendentes. A curadoria só SUGERE: publicar exige aprovação humana (kb:approve).
 */
export interface CurationOptions {
  days?: number; minCluster?: number; similarity?: number; maxConversations?: number; llm?: LlmClient;
  /** false = não chama o LLM (só agrupa). */
  propose?: boolean;
}
export interface CurationResult { analyzed: number; clusters: number; created: number; updated: number; ambiguities: number; proposals: number; suggestionIds: string[] }

export const clusterTokens = (q: string) => tokenize(q.replace(/\[[A-Z]+_\d+\]/g, ' '), { dropRequestWords: true });

interface Item { convId: string; question: string; answers: string[]; intent: string | null; tokens: string[]; fromBot: boolean }

async function loadItem(conv: { id: string; intent: string | null; botHandled: boolean }): Promise<Item | null> {
  const msgs = await listMessages(conv.id, { limit: 40, includeInternal: false });
  const red = new PiiRedactor();
  const inbound = msgs.filter((m) => m.direction === 'IN' && m.body && m.body.trim().length >= 8 && !isGreetingOnly(m.body));
  if (!inbound.length) return null;
  const question = truncate(red.redact(inbound[0].body!.trim()), 400);
  const answers = msgs.filter((m) => m.direction === 'OUT' && m.senderType === 'AGENT' && m.body && m.body.trim().length >= 20).slice(0, 3).map((m) => truncate(red.redact(m.body!.trim()), 800));
  return { convId: conv.id, question, answers, intent: conv.intent, tokens: clusterTokens(question), fromBot: conv.botHandled };
}

interface Cluster { items: Item[]; vec: Vec; seed: string[] }

export function clusterQuestions(items: Item[], threshold = 0.35): Cluster[] {
  const idf = buildIdf(items.map((i) => i.tokens));
  const clusters: Cluster[] = [];
  for (const it of items) {
    if (!it.tokens.length) continue;
    const v = tfidfVec(it.tokens, idf);
    let best: Cluster | null = null; let bestSim = 0;
    for (const c of clusters) {
      const sim = Math.max(cosine(c.vec, v), jaccard(c.seed, it.tokens));
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= threshold) {
      best.items.push(it);
      for (const [k, x] of v) best.vec.set(k, (best.vec.get(k) ?? 0) + x);
    } else clusters.push({ items: [it], vec: new Map(v), seed: it.tokens });
  }
  return clusters;
}

const ProposalSchema = z.object({
  title: z.string().min(3).max(200), question: z.string().min(3).max(500), answer: z.string().min(10).max(6000),
  category: z.string().max(100).nullish().transform((v) => v ?? null),
  tags: z.array(z.string()).nullish().transform((v) => (v ?? []).slice(0, 10)),
});
const parseProposal = (text: string): Parsed<z.infer<typeof ProposalSchema>> => {
  try {
    const r = ProposalSchema.safeParse(extractJsonObject(text));
    return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  } catch (err: any) { return { ok: false, error: String(err?.message ?? 'json inválido').slice(0, 120) }; }
};

const PROPOSE_SYSTEM = `Você é curador da base de conhecimento do Balcão Virtual (órgão do Poder Judiciário). Recebe perguntas reais de cidadãos e as respostas que ATENDENTES HUMANOS deram.
Redija UM artigo de FAQ que consolide as respostas dos atendentes. REGRAS: use somente fatos presentes nas respostas dos atendentes; NÃO invente prazos, valores, links ou telefones; se as respostas divergirem, use a formulação mais prudente e genérica; marcadores como [CPF_1] são dados ocultados — não os inclua no artigo. Isto é apenas uma PROPOSTA que um humano revisará.
SAÍDA: apenas JSON {"title": string, "question": string (pergunta genérica), "answer": string (resposta clara, pt-BR), "category": string ou null, "tags": [string]}`;

async function propose(orgId: string, llm: LlmClient, cluster: Cluster) {
  const qs = cluster.items.slice(0, 5).map((i, n) => `${n + 1}. ${truncate(i.question, 250)}`).join('\n');
  const ans = cluster.items.flatMap((i) => i.answers).slice(0, 5).map((a, n) => `${n + 1}. ${truncate(a, 600)}`).join('\n');
  const r = await callJson(orgId, llm, { tier: 'strong', system: PROPOSE_SYSTEM, user: `PERGUNTAS DOS CIDADÃOS:\n${qs}\n\nRESPOSTAS DOS ATENDENTES:\n${ans}\n\nApenas o JSON.`, maxTokens: 1200, label: 'bv.curation' }, parseProposal);
  return r.ok ? r : null;
}

const keyOf = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

async function findOpenByKey(orgId: string, key: string) {
  return prisma.bvKbSuggestion.findFirst({ where: { orgId, status: 'OPEN', evidence: { path: ['key'], equals: key } } });
}

const meanPairwise = (sets: string[][]) => {
  let s = 0; let n = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { s += jaccard(sets[i], sets[j]); n++; }
  return n ? s / n : 1;
};

export async function runCuration(orgId: string, opts: CurationOptions = {}): Promise<CurationResult> {
  const days = opts.days ?? Number(process.env.BV_AI_CURATION_DAYS ?? 30);
  const minCluster = opts.minCluster ?? 2;
  const llm = opts.llm ?? getLlmClient();
  const since = new Date(Date.now() - days * 86400_000);
  const res: CurationResult = { analyzed: 0, clusters: 0, created: 0, updated: 0, ambiguities: 0, proposals: 0, suggestionIds: [] };

  // 1) conversas sem cobertura: bot não achou artigo (e não resolveu) OU atendimento 100% humano encerrado
  const cands = await prisma.bvConversation.findMany({
    where: {
      orgId, startedAt: { gte: since },
      OR: [
        { botHandled: true, automatable: false, resolvedByBot: false, intent: { not: null }, NOT: { intent: 'saudacao' } },
        { botHandled: false, status: 'CLOSED', assignedUserId: { not: null } },
      ],
    },
    select: { id: true, intent: true, botHandled: true }, orderBy: { startedAt: 'desc' }, take: opts.maxConversations ?? 500,
  });
  const items: Item[] = [];
  for (const c of cands) { const it = await loadItem(c); if (it) items.push(it); }
  res.analyzed = items.length;

  // 2) agrupamento
  const clusters = clusterQuestions(items, opts.similarity ?? 0.35).filter((c) => c.items.length >= minCluster);
  res.clusters = clusters.length;
  const recentClosed = await prisma.bvKbSuggestion.findMany({ where: { orgId, status: { in: ['ACCEPTED', 'DISMISSED'] }, resolvedAt: { gte: new Date(Date.now() - 60 * 86400_000) } }, select: { question: true }, take: 500 });
  const open = await prisma.bvKbSuggestion.findMany({ where: { orgId, status: 'OPEN', type: { not: 'AMBIGUITY' } }, take: 500 });

  for (const cl of clusters) {
    const idf = buildIdf(cl.items.map((i) => i.tokens));
    const rep = cl.items.map((i) => ({ i, s: cosine(tfidfVec(i.tokens, idf), cl.vec) })).sort((a, b) => b.s - a.s)[0].i;
    const repTokens = rep.tokens;
    const convIds = [...new Set(cl.items.map((i) => i.convId))];
    const samples = cl.items.slice(0, 5).map((i) => truncate(i.question, 200));

    // já tratada recentemente (aceita/descartada)? não recria
    if (recentClosed.some((s) => jaccard(clusterTokens(s.question), repTokens) >= 0.6)) continue;
    // já existe sugestão aberta parecida? só atualiza a evidência
    const existing = open.find((s) => jaccard(clusterTokens(s.question), repTokens) >= 0.5);
    if (existing) {
      const ev = (existing.evidence ?? {}) as any;
      const merged = [...new Set([...(ev.conversationIds ?? []), ...convIds])];
      await prisma.bvKbSuggestion.update({ where: { id: existing.id }, data: { evidence: { ...ev, conversationIds: merged, count: merged.length, sampleMessages: samples, lastRunAt: new Date() } as any } });
      res.updated++; res.suggestionIds.push(existing.id);
      continue;
    }

    // cobertura parcial (artigo parecido existe)? → IMPROVE; senão NEW_ARTICLE (com proposta) ou GAP
    const hits = await searchKb(orgId, rep.question.replace(/\[[A-Z]+_\d+\]/g, ' '), { limit: 3, first: 'any' });
    const close = hits.find((h) => jaccard(clusterTokens(`${h.title} ${h.question}`), repTokens) >= 0.4);
    let type: 'NEW_ARTICLE' | 'GAP' | 'IMPROVE' = close ? 'IMPROVE' : 'GAP';
    let proposedAnswer: string | null = null;
    const evidence: Record<string, unknown> = { conversationIds: convIds, count: convIds.length, sampleMessages: samples, hasAgentAnswers: cl.items.some((i) => i.answers.length), key: `cluster:${keyOf(repTokens.slice().sort().join(' '))}`, generatedAt: new Date() };
    if (opts.propose !== false && cl.items.some((i) => i.answers.length) && !close) {
      const p = await propose(orgId, llm, cl).catch((err) => { logger.warn({ err: err?.message }, '[balcao.ai] proposta de curadoria falhou'); return null; });
      if (p) {
        type = 'NEW_ARTICLE'; proposedAnswer = p.value.answer; res.proposals++;
        evidence.proposal = { by: 'LLM', model: p.model, title: p.value.title, question: p.value.question, category: p.value.category, tags: p.value.tags, basedOnConversations: convIds.length, requiresHumanReview: true };
      }
    }
    const s = await prisma.bvKbSuggestion.create({
      data: { orgId, type, question: truncate((evidence.proposal as any)?.question ?? rep.question, 500), proposedAnswer, evidence: evidence as any, articleId: close?.id ?? null },
    });
    open.push(s); res.created++; res.suggestionIds.push(s.id);
  }

  res.ambiguities = await detectAmbiguities(orgId, since, res);
  await audit({ orgId, actorType: 'SYSTEM', action: 'kb.curation.run', meta: { ...res, suggestionIds: undefined, days } });
  return res;
}

async function addAmbiguity(orgId: string, key: string, question: string, evidence: Record<string, unknown>, res: CurationResult): Promise<boolean> {
  const dup = await findOpenByKey(orgId, key);
  if (dup) return false;
  const recent = await prisma.bvKbSuggestion.findFirst({ where: { orgId, status: 'DISMISSED', resolvedAt: { gte: new Date(Date.now() - 60 * 86400_000) }, evidence: { path: ['key'], equals: key } } });
  if (recent) return false;
  const s = await prisma.bvKbSuggestion.create({ data: { orgId, type: 'AMBIGUITY', question: truncate(question, 500), evidence: { ...evidence, key, generatedAt: new Date() } as any } });
  res.suggestionIds.push(s.id);
  return true;
}

/** (a) mesma intenção respondida de formas diferentes; (b) artigos concorrentes; (c) baixa confiança recorrente. */
async function detectAmbiguities(orgId: string, since: Date, res: CurationResult): Promise<number> {
  let n = 0;

  // (a) respostas divergentes por intenção
  const convs = await prisma.bvConversation.findMany({ where: { orgId, startedAt: { gte: since }, intent: { not: null }, assignedUserId: { not: null } }, select: { id: true, intent: true, botHandled: true }, take: 300 });
  const byIntent = new Map<string, Array<{ convId: string; ans: string }>>();
  for (const c of convs) {
    const msgs = await listMessages(c.id, { limit: 40, includeInternal: false });
    const a = msgs.find((m) => m.direction === 'OUT' && m.senderType === 'AGENT' && m.body && m.body.trim().length >= 20);
    if (a) byIntent.set(c.intent!, [...(byIntent.get(c.intent!) ?? []), { convId: c.id, ans: new PiiRedactor().redact(a.body!.trim()) }]);
  }
  for (const [intent, list] of byIntent) {
    if (list.length < 3) continue;
    const mean = meanPairwise(list.map((l) => clusterTokens(l.ans)));
    if (mean < 0.25 && await addAmbiguity(orgId, `ambiguity:divergent:${intent}`, `Respostas divergentes dos atendentes para a intenção "${intent}"`,
      { kind: 'DIVERGENT_ANSWERS', intent, conversationIds: list.map((l) => l.convId), count: list.length, meanSimilarity: Number(mean.toFixed(2)), sampleMessages: list.slice(0, 3).map((l) => truncate(l.ans, 200)) }, res)) n++;
  }

  // (b) artigos APPROVED concorrentes (perguntas quase iguais)
  const arts = await prisma.bvKbArticle.findMany({ where: { orgId, status: 'APPROVED' }, select: { id: true, title: true, question: true }, take: 300 });
  const toks = arts.map((a) => clusterTokens(`${a.title} ${a.question}`));
  for (let i = 0; i < arts.length; i++) for (let j = i + 1; j < arts.length; j++) {
    const sim = jaccard(toks[i], toks[j]);
    if (sim >= 0.6) {
      const ids = [arts[i].id, arts[j].id].sort();
      if (await addAmbiguity(orgId, `ambiguity:competing:${ids.join(':')}`, `Artigos concorrentes: "${arts[i].title}" e "${arts[j].title}"`,
        { kind: 'COMPETING_ARTICLES', articleIds: ids, conversationIds: [], count: 2, similarity: Number(sim.toFixed(2)) }, res)) n++;
    }
  }

  // (c) baixa confiança recorrente na mesma intenção
  const evs = await prisma.bvConversationEvent.findMany({ where: { orgId, type: 'ESCALATED', createdAt: { gte: since } }, select: { conversationId: true, data: true }, take: 2000 });
  const lowIds = evs.filter((e) => (e.data as any)?.reason === 'LOW_CONFIDENCE').map((e) => e.conversationId);
  if (lowIds.length) {
    const lc = await prisma.bvConversation.findMany({ where: { orgId, id: { in: lowIds }, intent: { not: null } }, select: { id: true, intent: true } });
    const g = new Map<string, string[]>();
    for (const c of lc) g.set(c.intent!, [...(g.get(c.intent!) ?? []), c.id]);
    for (const [intent, ids] of g) {
      if (ids.length >= 3 && await addAmbiguity(orgId, `ambiguity:lowconf:${intent}`, `Baixa confiança recorrente do bot na intenção "${intent}"`, { kind: 'RECURRING_LOW_CONFIDENCE', intent, conversationIds: ids, count: ids.length }, res)) n++;
    }
  }
  res.created += n;
  return n;
}

// ── Aceitar / descartar ──────────────────────────────────────────────────────

export interface AcceptOverrides { title?: string; question?: string; answer?: string; category?: string | null; tags?: string[]; submitForReview?: boolean }

/** Aceita a sugestão: cria artigo DRAFT (ou PENDING_REVIEW) com source CURATORSHIP. Nunca publica. */
export async function acceptSuggestion(orgId: string, id: string, userId: string, o: AcceptOverrides = {}): Promise<{ suggestion: BvKbSuggestion; articleId: string | null }> {
  const s = await prisma.bvKbSuggestion.findFirst({ where: { id, orgId } });
  if (!s) throw new KbError('kb.suggestion_not_found', 'Sugestão não encontrada', 404);
  if (s.status !== 'OPEN') throw new KbError('kb.suggestion_closed', 'Sugestão já tratada', 409);
  const ev = (s.evidence ?? {}) as any;
  let articleId: string | null = null;
  if (s.type !== 'AMBIGUITY') {
    const prop = ev.proposal ?? {};
    const answer = o.answer ?? s.proposedAnswer;
    if (!answer) throw new KbError('kb.answer_required', 'Esta sugestão não tem proposta de resposta: informe "answer" para criar o artigo', 400);
    const question = o.question ?? s.question;
    const a = await createArticle(orgId, userId, {
      title: o.title ?? prop.title ?? truncate(question, 120), question, answer, category: o.category ?? prop.category ?? null, tags: o.tags ?? prop.tags ?? [],
    }, { source: 'CURATORSHIP', status: o.submitForReview ? 'PENDING_REVIEW' : 'DRAFT', sourceConversationIds: (ev.conversationIds ?? []).slice(0, 200) });
    articleId = a.id;
  }
  const claimed = await prisma.bvKbSuggestion.updateMany({ where: { id, orgId, status: 'OPEN' }, data: { status: 'ACCEPTED', articleId: articleId ?? s.articleId, resolvedById: userId, resolvedAt: new Date() } });
  if (claimed.count === 0) throw new KbError('kb.suggestion_closed', 'Sugestão já tratada', 409);
  return { suggestion: await prisma.bvKbSuggestion.findUniqueOrThrow({ where: { id } }), articleId };
}

export async function dismissSuggestion(orgId: string, id: string, userId: string, reason?: string): Promise<BvKbSuggestion> {
  const s = await prisma.bvKbSuggestion.findFirst({ where: { id, orgId } });
  if (!s) throw new KbError('kb.suggestion_not_found', 'Sugestão não encontrada', 404);
  const r = await prisma.bvKbSuggestion.updateMany({ where: { id, orgId, status: 'OPEN' }, data: { status: 'DISMISSED', resolvedById: userId, resolvedAt: new Date(), evidence: { ...((s.evidence ?? {}) as any), dismissReason: reason ?? null } as any } });
  if (r.count === 0) throw new KbError('kb.suggestion_closed', 'Sugestão já tratada', 409);
  return prisma.bvKbSuggestion.findUniqueOrThrow({ where: { id } });
}

export async function listSuggestions(orgId: string, f: { status?: string; type?: string; limit?: number }) {
  const where: Prisma.BvKbSuggestionWhereInput = { orgId, ...(f.status ? { status: f.status } : {}), ...(f.type ? { type: f.type } : {}) };
  const rows = await prisma.bvKbSuggestion.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(f.limit ?? 100, 200) });
  return rows.map((r) => ({ ...r, evidenceCount: Number((r.evidence as any)?.count ?? 0) }));
}

// ── Métricas de curadoria ────────────────────────────────────────────────────

export async function curationStats(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  const [botConvs, covered, resolved, byStatus, open, curatorArticles] = await Promise.all([
    prisma.bvConversation.count({ where: { orgId, startedAt: { gte: since }, botHandled: true } }),
    prisma.bvConversation.count({ where: { orgId, startedAt: { gte: since }, botHandled: true, automatable: true } }),
    prisma.bvConversation.count({ where: { orgId, startedAt: { gte: since }, botHandled: true, resolvedByBot: true } }),
    prisma.bvKbSuggestion.groupBy({ by: ['status'], where: { orgId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bvKbSuggestion.findMany({ where: { orgId, status: 'OPEN' }, take: 200 }),
    prisma.bvKbArticle.count({ where: { orgId, source: 'CURATORSHIP', createdAt: { gte: since } } }),
  ]);
  const st = (k: string) => byStatus.find((x) => x.status === k)?._count._all ?? 0;
  const topGaps = open.map((s) => ({ id: s.id, type: s.type, question: s.question, count: Number((s.evidence as any)?.count ?? 0) })).sort((a, b) => b.count - a.count).slice(0, 5);
  const minPerSuggestion = Number(process.env.BV_AI_CURATION_MIN_PER_SUGGESTION ?? 12);
  const minPerArticle = Number(process.env.BV_AI_CURATION_MIN_PER_ARTICLE ?? 20);
  const hours = ((st('ACCEPTED') + st('DISMISSED')) * minPerSuggestion + curatorArticles * minPerArticle) / 60;
  return {
    windowDays: days, botConversations: botConvs,
    coverage: botConvs ? covered / botConvs : null, // % das conversas do bot com artigo/fluxo que cobre a intenção
    containment: botConvs ? resolved / botConvs : null, // % resolvidas sem humano
    suggestions: { open: open.length, accepted: st('ACCEPTED'), dismissed: st('DISMISSED') }, topGaps,
    curationHoursEstimated: Number(hours.toFixed(1)), contractedHoursPerMonth: 40,
    assumptions: { minutesPerSuggestionReviewed: minPerSuggestion, minutesPerCuratedArticle: minPerArticle },
  };
}

/** Job diário: roda a curadoria em todos os órgãos com IA habilitada. */
export async function runCurationJob(): Promise<void> {
  const orgs = await prisma.bvOrg.findMany({ select: { id: true } });
  for (const o of orgs) {
    try {
      if (!(await getOrgSettings(o.id)).ai.enabled) continue;
      await runCuration(o.id);
    } catch (err: any) { logger.error({ err: err?.message, orgId: o.id }, '[balcao.ai] curadoria falhou'); }
  }
}
