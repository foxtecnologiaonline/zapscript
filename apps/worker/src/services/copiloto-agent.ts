import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';
import { logAiUsage } from '../lib/aiUsage';
import {
  BRIEFING_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  aggressivenessGuide,
  AXES,
  TECHNIQUES,
  type Axis,
} from './copiloto-playbook';

/**
 * Agente do ZapScript Copiloto — lê a conversa e produz, para o DONO, um
 * briefing e 3 opções de ação.
 *
 * Diferença para o atende-agent.ts: nada do que sai daqui vai para o cliente
 * sem o dono mandar. Por isso não existe limiar de confiança que bloqueie envio;
 * o freio é humano. O que existe aqui é o freio de CUSTO (triagem barata antes
 * do briefing caro) e o de CONTEÚDO (copiloto-guardrails.ts, aplicado por quem
 * chama — ver apps/worker/src/copiloto.ts).
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Triagem roda em toda rajada de mensagem: precisa ser barata. O briefing roda
// só no que passou pela triagem: pode ser mais caro.
// (Prompt caching daria ~90% de desconto no prefixo estável, mas o SDK fixado
//  aqui — @anthropic-ai/sdk 0.24.x — só expõe cache pelo namespace beta. Migrar
//  o SDK e ligar cache é o próximo ganho óbvio de custo.)
const TRIAGE_MODELS = [
  process.env.COPILOTO_TRIAGE_MODEL || 'claude-haiku-4-5',
  'claude-sonnet-4-6',
].filter((v, i, a) => a.indexOf(v) === i);

const BRIEF_MODELS = [
  process.env.COPILOTO_BRIEF_MODEL || 'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Copiloto: resposta sem JSON');
  return JSON.parse(match[0]);
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
}

/** Chama o modelo percorrendo a lista de fallback; erro só se todos falharem. */
async function callWithFallback(params: {
  models: string[];
  system: string;
  user: string;
  maxTokens: number;
  userId: string;
  feature: string;
}): Promise<any> {
  let lastErr: any;
  for (const model of params.models) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
      });
      logAiUsage(params.userId, params.feature, model, res.usage?.input_tokens, res.usage?.output_tokens);
      return extractJson(textOf(res));
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[Copiloto] Modelo ${model} falhou (${params.feature}): ${err.message}`);
    }
  }
  throw new Error(`Copiloto: todos os modelos falharam (${params.feature}): ${lastErr?.message ?? 'erro desconhecido'}`);
}

export interface CopilotoMessageLike {
  direction: string; // 'in' | 'out'
  content: string;
}

/** Conversa formatada para o prompt, do mais antigo ao mais novo. */
function formatHistory(messages: CopilotoMessageLike[]): string {
  return messages
    .map((m) => `${m.direction === 'in' ? 'Cliente' : 'Você (dono)'}: ${m.content}`)
    .join('\n');
}

// ── Triagem ──────────────────────────────────────────────────────────────────

export interface TriageResult {
  shouldBrief: boolean;
  reason: string;
  confidence: number;
}

/**
 * Decide se a conversa merece interromper o dono. Enviesada para "não":
 * o custo de um falso positivo (notificação à toa) é maior que o de um falso
 * negativo (o dono vê a mensagem sozinho, como já faz hoje).
 */
export async function triageConversation(params: {
  userId: string;
  contactName?: string | null;
  newMessages: CopilotoMessageLike[];
  recentHistory?: CopilotoMessageLike[];
}): Promise<TriageResult> {
  const user = [
    params.contactName ? `Contato: ${params.contactName}` : null,
    params.recentHistory?.length
      ? `Histórico anterior (para contexto):\n${formatHistory(params.recentHistory)}`
      : null,
    `Mensagens novas do cliente, ainda não avaliadas:\n${formatHistory(params.newMessages)}`,
  ].filter(Boolean).join('\n\n');

  try {
    const parsed = await callWithFallback({
      models: TRIAGE_MODELS,
      system: TRIAGE_SYSTEM_PROMPT,
      user,
      maxTokens: 200,
      userId: params.userId,
      feature: 'copiloto_triage',
    });
    return {
      shouldBrief: parsed?.decisao === 'briefing',
      reason: typeof parsed?.motivo === 'string' ? parsed.motivo : '',
      confidence: typeof parsed?.confianca === 'number' ? parsed.confianca : 0,
    };
  } catch (err: any) {
    // Triagem indisponível não pode virar enxurrada de briefing caro nem
    // silêncio permanente: falha fechada (não interrompe o dono) e loga.
    logger.error(`[Copiloto] Triagem falhou: ${err.message}`);
    return { shouldBrief: false, reason: 'triagem indisponível', confidence: 0 };
  }
}

// ── Briefing + 3 opções ──────────────────────────────────────────────────────

export interface CopilotoOption {
  axis: Axis;
  title: string;
  draft: string;
  rationale: string;
  risk: string | null;
  technique: string;
  confidence: number;
}

export interface BriefingResult {
  summary: string;
  intent: string;
  temperature: string;
  blocker: string | null;
  riskLevel: string;
  sensitive: boolean;
  note: string | null;
  options: CopilotoOption[];
}

const TEMPERATURES = new Set(['quente', 'morno', 'frio']);
const RISKS = new Set(['baixo', 'medio', 'alto']);
const BLOCKERS = new Set(['preco', 'prazo', 'confianca', 'autoridade', 'urgencia']);

function pickEnum(value: any, allowed: Set<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/**
 * Produz o briefing e as 3 opções. Não valida conteúdo (isso é dos guardrails)
 * nem envia nada — só devolve o material para quem chamou decidir.
 */
export async function buildBriefing(params: {
  userId: string;
  contactName?: string | null;
  businessContext?: string | null;
  aggressiveness?: string | null;
  knowledgeBase?: Array<{ question: string; answer: string }>;
  history: CopilotoMessageLike[];
}): Promise<BriefingResult> {
  const kbBlock = params.knowledgeBase?.length
    ? params.knowledgeBase.map((k, i) => `[${i + 1}] P: ${k.question}\nR: ${k.answer}`).join('\n\n')
    : '(o dono não cadastrou perguntas frequentes)';

  const user = [
    `Sobre o negócio: ${params.businessContext?.trim() || '(não informado)'}`,
    aggressivenessGuide(params.aggressiveness),
    params.contactName ? `Nome do cliente: ${params.contactName}` : null,
    `Fatos do negócio que você PODE usar (única fonte de preço, prazo e política):\n${kbBlock}`,
    `Conversa (mais antiga primeiro):\n${formatHistory(params.history)}`,
  ].filter(Boolean).join('\n\n');

  const parsed = await callWithFallback({
    models: BRIEF_MODELS,
    system: BRIEFING_SYSTEM_PROMPT,
    user,
    maxTokens: 1500,
    userId: params.userId,
    feature: 'copiloto_brief',
  });

  const rawOptions: any[] = Array.isArray(parsed?.opcoes) ? parsed.opcoes : [];

  // Normaliza para os 3 eixos na ordem canônica. Se o modelo repetir eixo ou
  // devolver menos de 3, ficamos com o que veio — 2 opções boas valem mais que
  // 3 com uma inventada só para fechar a conta.
  const options: CopilotoOption[] = [];
  for (const axis of AXES) {
    const found = rawOptions.find((o) => o?.eixo === axis);
    if (!found) continue;
    const draft = typeof found.rascunho === 'string' ? found.rascunho.trim() : '';
    if (!draft) continue;
    options.push({
      axis,
      title: (typeof found.titulo === 'string' && found.titulo.trim()) || axis,
      draft,
      rationale: typeof found.porque === 'string' ? found.porque.trim() : '',
      risk: typeof found.risco === 'string' && found.risco.trim() ? found.risco.trim() : null,
      technique: TECHNIQUES.includes(found.tecnica) ? found.tecnica : 'proximo-passo',
      confidence: typeof found.confianca === 'number' ? found.confianca : 0,
    });
  }

  return {
    summary: typeof parsed?.resumo === 'string' ? parsed.resumo.trim() : '',
    intent: typeof parsed?.intencao === 'string' ? parsed.intencao.trim() : '',
    temperature: pickEnum(parsed?.temperatura, TEMPERATURES, 'morno'),
    blocker: typeof parsed?.trava === 'string' && BLOCKERS.has(parsed.trava) ? parsed.trava : null,
    riskLevel: pickEnum(parsed?.risco, RISKS, 'baixo'),
    sensitive: parsed?.sensivel === true,
    note: typeof parsed?.observacao === 'string' && parsed.observacao.trim() ? parsed.observacao.trim() : null,
    options,
  };
}
