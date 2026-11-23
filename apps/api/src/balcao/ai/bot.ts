import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { addConversationEvent, closeConversation, escalateToHuman, sendMessage } from '../core/conversations';
import { emitBvEvent, onBvEvent, type BvEventMap } from '../core/events';
import { listMessages, readBody } from '../core/messages';
import { getOrgSettings, type BvOrgSettings } from '../core/settings';
import { getBotTool, identitySatisfies, listBotTools, type BotTool, type BotToolContext } from '../core/tools';
import { assertQuota, QuotaExceededError, recordUsage } from '../core/usage';
import { encryptField } from '../core/crypto';
import { isGreetingOnly, matchesEscalationKeyword, negativeSentimentScore, resolutionSignal, wantsHuman } from './detect';
import { getLlmClient, type LlmClient } from './llm';
import { markUsed, recordArticleFeedback } from './kb';
import { PiiRedactor } from './pii';
import { buildBotUserPrompt, BOT_SYSTEM, parseBotOutput, retrySuffix, type BotOutput } from './prompt';
import { searchKb, type KbHit } from './search';
import { estimateTokens } from './text';
import { handleAgentAssist } from './assist';

/**
 * Motor do chatbot (TR 1.1.3.1.5.1.1). Pipeline por mensagem do cidadão em conversa BOT:
 *   saudação → resolução ("obrigado") → pedido de humano/palavras de escalonamento/sentimento → limite de turnos →
 *   redação de PII → recuperação (FTS) → LLM (JSON estrito, 1 retry) → política por modo → efeitos (mensagem,
 *   escalonamento, ferramenta, métricas). A análise (`analyzeMessage`) é separada dos efeitos (`applyAnalysis`),
 *   o que permite o modo seco (POST /ai/test).
 */

export type AiMode = 'ASSISTED' | 'PROGRESSIVE';
type Level = BotToolContext['identityLevel'];

export type EscalationReason =
  | 'HUMAN_REQUEST' | 'KEYWORD' | 'NEGATIVE_SENTIMENT' | 'NOT_RESOLVED' | 'MAX_TURNS' | 'LOW_CONFIDENCE' | 'NO_ARTICLE'
  | 'LLM_NEEDS_HUMAN' | 'LLM_INVALID' | 'LLM_ERROR' | 'QUOTA' | 'NON_TEXT' | 'TOOL_ERROR' | 'TOOL_UNKNOWN' | 'ASSISTED_TRIAGE' | 'BOT_STALLED';

export const HANDOFF_NOTICE = 'Certo! Vou transferir você para um atendente. Aguarde um instante, por favor.';
export const FAREWELL = 'Que bom ter ajudado! Se precisar de algo mais, é só chamar.';
export const GREETING_FOLLOWUP = 'Como posso ajudar?';

/** Campos de settings.ai além dos tipados no core (lidos com padrão seguro). */
export function aiExtras(s: BvOrgSettings) {
  const a = s.ai as any;
  return {
    agentAssist: a.agentAssist !== false,
    idleCloseMinutes: Number(a.idleCloseMinutes ?? process.env.BV_AI_IDLE_MINUTES ?? 15),
    handoffMessage: typeof a.handoffMessage === 'string' && a.handoffMessage ? a.handoffMessage : HANDOFF_NOTICE,
    topK: Number(process.env.BV_AI_TOPK ?? 4),
  };
}

export interface AnalysisState {
  botTurns: number;
  welcomed: boolean;
  /** A mensagem anterior era uma resposta (ANSWER/TOOL) do bot — habilita detecção de "obrigado/resolveu". */
  lastBotAnswered: boolean;
  identityLevel: Level;
}

export interface AnalysisInput {
  orgId: string;
  settings: BvOrgSettings;
  mode: AiMode;
  text: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  state: AnalysisState;
  tools?: BotTool[];
  llm?: LlmClient;
}

export interface Analysis {
  action: 'REPLY' | 'ESCALATE' | 'RESOLVE' | 'WELCOME' | 'TOOL' | 'AUTH_REQUIRED';
  mode: AiMode;
  reason?: EscalationReason;
  answer?: string;
  /** ASSISTED: texto sugerido para o atendente (nunca enviado ao cidadão). */
  suggestion?: string;
  intent?: string;
  category?: string | null;
  confidence?: number;
  automatable?: boolean;
  articles: Array<{ id: string; title: string; rank: number }>;
  usedArticleIds: string[];
  tool?: { name: string; input: Record<string, unknown>; minIdentityLevel?: BotTool['minIdentityLevel'] };
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Detalhes de depuração para o modo seco. */
  debug?: { redacted: string; piiFound: number; retrieval: number; llmCalls: number };
}

const SMALLTALK = new Set(['saudacao', 'agradecimento', 'despedida', 'cumprimento']);

function esc(reason: EscalationReason, mode: AiMode, extra: Partial<Analysis> = {}): Analysis {
  return { action: 'ESCALATE', mode, reason, articles: [], usedArticleIds: [], ...extra };
}

/** Chama o LLM; 1 retry se a chamada falhar ou o JSON for inválido. Registra consumo (AI_CALLS/AI_TOKENS). */
export async function callJsonLlm(orgId: string, llm: LlmClient, req: Omit<Parameters<LlmClient['complete']>[0], 'user'> & { user: string }): Promise<
  { ok: true; value: BotOutput; model: string; tokensIn: number; tokensOut: number; calls: number } | { ok: false; kind: 'LLM_ERROR' | 'LLM_INVALID' | 'QUOTA'; calls: number }
> {
  let tokensIn = 0; let tokensOut = 0; let calls = 0; let lastErr = '';
  let user = req.user;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await assertQuota(orgId, 'AI_CALLS'); } catch (err) {
      if (err instanceof QuotaExceededError) return { ok: false, kind: 'QUOTA', calls };
    }
    let res;
    try {
      calls++;
      res = await llm.complete({ ...req, user });
    } catch (err: any) {
      lastErr = `llm: ${String(err?.message ?? err).slice(0, 80)}`;
      await recordUsage(orgId, 'AI_CALLS', 1);
      logger.warn({ label: req.label, attempt, err: lastErr }, '[balcao.ai] chamada ao LLM falhou');
      if (attempt === 1) return { ok: false, kind: 'LLM_ERROR', calls };
      continue;
    }
    const tin = res.inputTokens || estimateTokens(req.system + user);
    const tout = res.outputTokens || estimateTokens(res.text);
    tokensIn += tin; tokensOut += tout;
    await recordUsage(orgId, 'AI_CALLS', 1);
    await recordUsage(orgId, 'AI_TOKENS', tin + tout);
    const parsed = parseBotOutput(res.text);
    if (parsed.ok) return { ok: true, value: parsed.value, model: res.model, tokensIn, tokensOut, calls };
    lastErr = parsed.error;
    user = req.user + retrySuffix(parsed.error);
  }
  return { ok: false, kind: 'LLM_INVALID', calls };
}

/**
 * Decide o que fazer com a mensagem do cidadão. Só efeitos colaterais: chamadas ao LLM e contabilização de uso.
 */
export async function analyzeMessage(i: AnalysisInput): Promise<Analysis> {
  const { settings, mode, text, state } = i;
  const ai = settings.ai;
  const llm = i.llm ?? getLlmClient();

  // (h) resolução / não resolução, depois de uma resposta do bot
  if (state.lastBotAnswered) {
    const sig = resolutionSignal(text);
    if (sig === 'RESOLVED') return { action: 'RESOLVE', mode, articles: [], usedArticleIds: [] };
    if (sig === 'NOT_RESOLVED') return esc('NOT_RESOLVED', mode);
  }
  // (b) humano / palavras de escalonamento / sentimento
  if (wantsHuman(text)) return esc('HUMAN_REQUEST', mode);
  if (matchesEscalationKeyword(text, ai.escalationKeywords ?? [])) return esc('KEYWORD', mode);
  if (negativeSentimentScore(text) >= 2) return esc('NEGATIVE_SENTIMENT', mode);
  // limite de turnos
  if (mode === 'PROGRESSIVE' && state.botTurns >= ai.maxBotTurns) return esc('MAX_TURNS', mode);
  // (a) só saudação: sem LLM (custo zero)
  if (isGreetingOnly(text)) {
    return mode === 'PROGRESSIVE'
      ? { action: 'WELCOME', mode, intent: 'saudacao', articles: [], usedArticleIds: [] }
      : esc('ASSISTED_TRIAGE', mode, { intent: 'saudacao', automatable: false });
  }

  // (c) redação de PII — tudo o que sai para o LLM passa por aqui
  const red = new PiiRedactor();
  const redacted = red.redact(text);
  const history = i.history.slice(-8).map((h) => ({ role: h.role, text: red.redact(h.text) }));

  // (d) recuperação: mensagem atual (+ última pergunta do cidadão quando a atual é curta, p/ perguntas de seguimento)
  const lastUser = [...history].reverse().find((h) => h.role === 'user')?.text ?? '';
  const q = redacted.split(/\s+/).length < 4 && lastUser ? `${lastUser} ${redacted}` : redacted;
  const topK = aiExtras(settings).topK;
  const hits = await searchKb(i.orgId, q.replace(/\[[A-Z]+_\d+\]/g, ' '), { limit: topK, first: 'any' });
  const tools = i.tools ?? listBotTools();

  // (e) LLM
  const r = await callJsonLlm(i.orgId, llm, {
    tier: 'fast', system: BOT_SYSTEM, user: buildBotUserPrompt({ articles: hits, tools, history, message: redacted }), maxTokens: 900, label: 'bv.bot',
  });
  const debug = { redacted, piiFound: red.found, retrieval: hits.length, llmCalls: r.calls };
  const base = { mode, articles: hits.map((h) => ({ id: h.id, title: h.title, rank: h.rank })), debug };
  if (!r.ok) return esc(r.kind, mode, base as any);

  const out = r.value;
  const valid = new Set(hits.map((h) => h.id));
  const usedArticleIds = out.usedArticleIds.filter((id) => valid.has(id)); // descarta ids inventados
  const tool = out.toolCall ? tools.find((t) => t.name === out.toolCall!.name) ?? null : null;
  const answer = red.rehydrate(out.answer.trim());
  const common = {
    ...base, intent: out.intent, category: out.category, confidence: out.confidence, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
    usedArticleIds, automatable: usedArticleIds.length > 0 || !!tool,
  };

  // (f) política por modo
  if (mode === 'ASSISTED') {
    const hint = tool ? `Sugestão: consultar com a ferramenta "${tool.name}".` : answer;
    return esc('ASSISTED_TRIAGE', mode, { ...common, suggestion: out.needsHuman ? '' : hint });
  }
  if (out.toolCall && !tool) return esc('TOOL_UNKNOWN', mode, common);
  if (out.needsHuman) return esc('LLM_NEEDS_HUMAN', mode, common);
  const grounded = usedArticleIds.length > 0 || !!tool || SMALLTALK.has(out.intent);
  if (!grounded) return esc(hits.length ? 'LOW_CONFIDENCE' : 'NO_ARTICLE', mode, common);
  if (out.confidence < ai.confidenceThreshold) return esc('LOW_CONFIDENCE', mode, common);

  if (tool) {
    const input = red.rehydrate(out.toolCall!.input);
    const t = { name: tool.name, input, minIdentityLevel: tool.minIdentityLevel };
    if (!identitySatisfies(state.identityLevel, tool.minIdentityLevel)) return { action: 'AUTH_REQUIRED', ...common, tool: t };
    return { action: 'TOOL', ...common, tool: t };
  }
  if (!answer) return esc('LLM_INVALID', mode, common);
  return { action: 'REPLY', ...common, answer };
}

// ── Efeitos ──────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = { bronze: 1, prata: 2, ouro: 3 };
export function identityLevelOf(conversationMeta: any, contactLevel: string | null | undefined): Level {
  const cands = [conversationMeta?.identityLevel, conversationMeta?.govbr?.level, contactLevel].filter((x): x is string => typeof x === 'string' && x in RANK);
  if (!cands.length) return null;
  return cands.sort((a, b) => RANK[b] - RANK[a])[0] as Level;
}

/** Texto para o cidadão a partir do retorno de uma ferramenta (sem passar pelo LLM: dados do processo não vão a terceiros). */
export function renderToolResult(res: { ok: boolean; data?: unknown; message?: string }): string {
  if (res.message) return res.message;
  const d = res.data;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    return Object.entries(d as Record<string, unknown>).filter(([, v]) => v == null || typeof v !== 'object').map(([k, v]) => `${k}: ${v ?? '-'}`).join('\n');
  }
  return '';
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('tool.timeout')), ms))]);

interface ApplyCtx { orgId: string; conversationId: string; messageId: string; channel: string; contactId: string; settings: BvOrgSettings; identityLevel: Level; welcomed: boolean }

async function botSay(c: ApplyCtx, body: string, aiMeta: Record<string, unknown>) {
  return sendMessage({ orgId: c.orgId, conversationId: c.conversationId, senderType: 'BOT', body, aiMeta: { ...aiMeta, inReplyTo: c.messageId } });
}

async function lastBotArticleIds(conversationId: string): Promise<string[]> {
  const ev = await prisma.bvConversationEvent.findFirst({ where: { conversationId, type: 'BOT_REPLY' }, orderBy: { createdAt: 'desc' } });
  const ids = (ev?.data as any)?.articleIds;
  return Array.isArray(ids) ? ids : [];
}

/** Aplica a análise: envia/escala/fecha e atualiza a conversa (intent, category, automatable, botHandled). */
export async function applyAnalysis(c: ApplyCtx, a: Analysis): Promise<void> {
  const { orgId, conversationId } = c;
  const patch: Record<string, unknown> = { botHandled: true };
  if (a.intent) patch.intent = a.intent;
  if (a.category) patch.category = a.category;
  if (a.automatable !== undefined) patch.automatable = a.automatable;
  await prisma.bvConversation.updateMany({ where: { id: conversationId, orgId, status: { not: 'CLOSED' } }, data: patch });
  if (Object.keys(patch).length > 1) emitBvEvent('conversation.updated', { orgId, conversationId, fields: Object.keys(patch) });

  const meta = (kind: string) => ({
    kind, intent: a.intent ?? null, confidence: a.confidence ?? null, kbArticleIds: a.usedArticleIds, model: a.model ?? null,
    tokens: a.tokensIn !== undefined ? { in: a.tokensIn, out: a.tokensOut } : null, mode: a.mode,
  });

  switch (a.action) {
    case 'WELCOME': {
      const w = c.settings.ai.welcomeMessage?.trim();
      await botSay(c, c.welcomed ? GREETING_FOLLOWUP : (w || GREETING_FOLLOWUP), meta('WELCOME'));
      await addConversationEvent(orgId, conversationId, 'BOT_WELCOME', null, {});
      return;
    }
    case 'REPLY': {
      const welcome = !c.welcomed && c.settings.ai.welcomeMessage?.trim() ? `${c.settings.ai.welcomeMessage.trim()}\n\n` : '';
      const sent = await botSay(c, welcome + a.answer!, meta('ANSWER'));
      await addConversationEvent(orgId, conversationId, 'BOT_REPLY', null, { intent: a.intent, confidence: a.confidence, articleIds: a.usedArticleIds, model: a.model, delivered: !sent.error });
      await markUsed(orgId, a.usedArticleIds);
      return;
    }
    case 'AUTH_REQUIRED': {
      const t = a.tool!;
      const need = t.minIdentityLevel ?? 'bronze';
      let link = '';
      const login = getBotTool('identity.request_login');
      if (login) {
        try {
          const r = await withTimeout(login.handler({ orgId, conversationId, contactId: c.contactId, channel: c.channel as any, identityLevel: c.identityLevel }, { minLevel: need }), 10_000);
          const url = (r.data as any)?.url;
          link = typeof url === 'string' ? `\n\nAcesse para entrar: ${url}` : r.message ? `\n\n${r.message}` : '';
        } catch (err: any) { logger.warn({ err: err?.message }, '[balcao.ai] identity.request_login falhou'); }
      }
      const text = `Para fazer essa consulta preciso confirmar sua identidade pelo GOV.BR (nível ${need}).${link || ' Entre com sua conta GOV.BR ou, se preferir, peça para falar com um atendente.'}`;
      await botSay(c, text, meta('AUTH_REQUIRED'));
      await addConversationEvent(orgId, conversationId, 'BOT_AUTH_REQUIRED', null, { tool: t.name, need, have: c.identityLevel });
      return;
    }
    case 'TOOL': {
      const tool = getBotTool(a.tool!.name);
      if (!tool) return applyAnalysis(c, { ...a, action: 'ESCALATE', reason: 'TOOL_UNKNOWN' });
      let res: { ok: boolean; data?: unknown; message?: string };
      try {
        res = await withTimeout(tool.handler({ orgId, conversationId, contactId: c.contactId, channel: c.channel as any, identityLevel: c.identityLevel }, a.tool!.input), 20_000);
      } catch (err: any) {
        res = { ok: false, message: String(err?.message ?? 'erro') };
      }
      await addConversationEvent(orgId, conversationId, 'BOT_TOOL', null, { tool: tool.name, ok: res.ok }); // sem dados do retorno
      const text = res.ok ? renderToolResult(res) : '';
      if (!res.ok || !text) return applyAnalysis(c, { ...a, action: 'ESCALATE', reason: 'TOOL_ERROR' });
      await botSay(c, text, meta('TOOL'));
      await addConversationEvent(orgId, conversationId, 'BOT_REPLY', null, { intent: a.intent, confidence: a.confidence, articleIds: a.usedArticleIds, tool: tool.name });
      await markUsed(orgId, a.usedArticleIds);
      return;
    }
    case 'RESOLVE': {
      const ids = await lastBotArticleIds(conversationId);
      for (const id of ids) await recordArticleFeedback(orgId, id, true, null, { conversationId, source: 'implicit' }).catch(() => undefined);
      await botSay(c, FAREWELL, meta('FAREWELL'));
      await closeConversation({ orgId, conversationId, reason: 'RESOLVED', resolvedByBot: true });
      return;
    }
    case 'ESCALATE': {
      const reason = a.reason ?? 'LLM_NEEDS_HUMAN';
      if (reason === 'NOT_RESOLVED') {
        for (const id of await lastBotArticleIds(conversationId)) await recordArticleFeedback(orgId, id, false, null, { conversationId, source: 'implicit' }).catch(() => undefined);
      }
      if (a.suggestion) {
        await addConversationEvent(orgId, conversationId, 'AI_SUGGESTION', null, {
          kind: 'TRIAGE', textEnc: encryptField(a.suggestion), intent: a.intent ?? null, category: a.category ?? null, confidence: a.confidence ?? null, articleIds: a.usedArticleIds,
        });
      }
      // No modo PROGRESSIVE o bot "fala"; no ASSISTED ele não escreve nada ao cidadão.
      if (a.mode === 'PROGRESSIVE') await botSay(c, aiExtras(c.settings).handoffMessage, meta('HANDOFF'));
      await escalateToHuman(orgId, conversationId, { reason, category: a.category ?? undefined, intent: a.intent ?? undefined });
      return;
    }
  }
}

// ── Orquestração por evento ──────────────────────────────────────────────────

const chains = new Map<string, Promise<unknown>>();
/** Serializa o processamento por conversa (mensagens em rajada não geram respostas duplicadas). */
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(key, next);
  void next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => undefined);
  return next;
}

export async function processInbound(p: BvEventMap['message.inbound'], opts: { llm?: LlmClient } = {}): Promise<Analysis | null> {
  return serialize(p.conversationId, () => processInboundNow(p, opts));
}

async function processInboundNow(p: BvEventMap['message.inbound'], opts: { llm?: LlmClient }): Promise<Analysis | null> {
  const settings = await getOrgSettings(p.orgId);
  if (!settings.ai.enabled) return null;
  const conv = await prisma.bvConversation.findFirst({ where: { id: p.conversationId, orgId: p.orgId }, include: { contact: { select: { id: true, govbrLevel: true } } } });
  if (!conv || conv.status !== 'BOT') return null;
  const msg = await prisma.bvMessage.findFirst({ where: { id: p.messageId, orgId: p.orgId, conversationId: conv.id } });
  if (!msg || msg.direction !== 'IN') return null;
  // algo mais novo (outra mensagem do cidadão ou resposta) → este evento é obsoleto
  const newer = await prisma.bvMessage.findFirst({ where: { conversationId: conv.id, createdAt: { gt: msg.createdAt }, direction: { in: ['IN', 'OUT'] } }, select: { id: true } });
  if (newer) return null;

  const mode: AiMode = settings.ai.mode === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'ASSISTED';
  const text = readBody(msg.body)?.trim() ?? '';
  const botTurns = await prisma.bvMessage.count({ where: { conversationId: conv.id, direction: 'OUT', senderType: 'BOT', NOT: { aiMeta: { path: ['kind'], equals: 'HANDOFF' } } } });
  const prev = await prisma.bvMessage.findFirst({ where: { conversationId: conv.id, createdAt: { lt: msg.createdAt }, direction: { in: ['IN', 'OUT'] } }, orderBy: { createdAt: 'desc' }, select: { senderType: true, aiMeta: true } });
  const prevKind = (prev?.aiMeta as any)?.kind;
  const state: AnalysisState = {
    botTurns, welcomed: botTurns > 0,
    lastBotAnswered: prev?.senderType === 'BOT' && (prevKind === 'ANSWER' || prevKind === 'TOOL'),
    identityLevel: identityLevelOf(conv.metadata, conv.contact.govbrLevel),
  };
  const ctx: ApplyCtx = { orgId: p.orgId, conversationId: conv.id, messageId: msg.id, channel: conv.channel, contactId: conv.contactId, settings, identityLevel: state.identityLevel, welcomed: state.welcomed };

  let analysis: Analysis;
  if (!text) {
    analysis = esc('NON_TEXT', mode);
  } else {
    const history = (await listMessages(conv.id, { limit: 10, before: msg.createdAt, includeInternal: false }))
      .filter((m) => m.body).map((m) => ({ role: m.direction === 'IN' ? 'user' as const : 'assistant' as const, text: m.body! }));
    analysis = await analyzeMessage({ orgId: p.orgId, settings, mode, text, history, state, llm: opts.llm });
  }
  await applyAnalysis(ctx, analysis);
  return analysis;
}

// ── Varredura de conversas inativas (IQA) ────────────────────────────────────

/**
 * Conversas BOT paradas: (1) a última mensagem é uma RESPOSTA do bot e o cidadão não voltou em `idleCloseMinutes`
 * → encerra como RESOLVED/resolvedByBot (o silêncio após resposta conta como resolvido — documentado);
 * (2) a última é do cidadão e o bot não respondeu em `BV_AI_STALL_MINUTES` (padrão 5) → escala (rede de segurança).
 */
export async function sweepIdleBotConversations(now = new Date()): Promise<{ closed: number; escalated: number }> {
  const stallMin = Number(process.env.BV_AI_STALL_MINUTES ?? 5);
  const cands = await prisma.bvConversation.findMany({
    where: { status: 'BOT', lastMessageAt: { lt: new Date(now.getTime() - 60_000) } }, orderBy: { lastMessageAt: 'asc' }, take: 500,
    select: { id: true, orgId: true, lastMessageAt: true },
  });
  let closed = 0; let escalated = 0;
  for (const c of cands) {
    try {
      const settings = await getOrgSettings(c.orgId);
      if (!settings.ai.enabled) continue;
      const idleMs = aiExtras(settings).idleCloseMinutes * 60_000;
      const age = now.getTime() - (c.lastMessageAt?.getTime() ?? 0);
      const last = await prisma.bvMessage.findFirst({ where: { conversationId: c.id, direction: { in: ['IN', 'OUT'] } }, orderBy: { createdAt: 'desc' }, select: { direction: true, senderType: true, aiMeta: true } });
      if (!last) continue;
      const kind = (last.aiMeta as any)?.kind;
      if (last.direction === 'OUT' && last.senderType === 'BOT' && (kind === 'ANSWER' || kind === 'TOOL')) {
        if (age >= idleMs) {
          await closeConversation({ orgId: c.orgId, conversationId: c.id, reason: 'RESOLVED', resolvedByBot: true });
          await addConversationEvent(c.orgId, c.id, 'BOT_IDLE_CLOSE', null, { idleMinutes: Math.round(age / 60_000) });
          closed++;
        }
      } else if (last.direction === 'IN' && age >= stallMin * 60_000) {
        await escalateToHuman(c.orgId, c.id, { reason: 'BOT_STALLED' });
        escalated++;
      }
    } catch (err: any) { logger.warn({ err: err?.message, conversationId: c.id }, '[balcao.ai] varredura falhou para a conversa'); }
  }
  return { closed, escalated };
}

// ── Assinatura de eventos ────────────────────────────────────────────────────

let unsub: Array<() => void> = [];
/** Liga o motor (chatbot + assistência ao atendente) ao barramento. Idempotente. */
export function startAiEngine(opts: { llm?: LlmClient } = {}): void {
  if (unsub.length) return;
  unsub.push(onBvEvent('message.inbound', async (p) => {
    if (p.status === 'BOT') await processInbound(p, opts).catch((err) => logger.error({ err: err?.message, conversationId: p.conversationId }, '[balcao.ai] bot falhou'));
    else if (p.status === 'ACTIVE') await handleAgentAssist(p, opts).catch((err) => logger.error({ err: err?.message, conversationId: p.conversationId }, '[balcao.ai] assistência falhou'));
  }));
}
export function stopAiEngine(): void { while (unsub.length) unsub.pop()!(); }

export type { KbHit };
