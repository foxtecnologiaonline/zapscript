import {
  BRIEFING_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  GROUP_DIGEST_SYSTEM_PROMPT,
  aggressivenessGuide,
  AXES,
  TECHNIQUES,
  type Axis,
} from './copiloto-playbook';
import { buildModelChain, callAiWithFallback, type ModelSpec } from './ai-fallback';
import { logger } from '../lib/logger';

/**
 * Agente do ZapScript Copiloto — lê a conversa e produz, para o DONO, um
 * briefing e 3 opções de ação.
 *
 * Diferença para o atende-agent.ts: nada do que sai daqui vai para o cliente
 * sem o dono mandar. Por isso não existe limiar de confiança que bloqueie envio;
 * o freio é humano. O que existe aqui é o freio de CUSTO (triagem barata antes
 * do briefing caro) e o de CONTEÚDO (copiloto-guardrails.ts, aplicado por quem
 * chama — ver apps/worker/src/copiloto.ts).
 *
 * Rede de fallback multi-provedor (Anthropic → OpenAI → Groq → Gemini) vem de
 * ./ai-fallback — compartilhada com atende-agent.ts e voice-command-agent.ts.
 */

// Triagem roda em toda rajada de mensagem: precisa ser barata. O briefing roda
// só no que passou pela triagem: pode ser mais caro. Prompt caching (~90% de
// desconto no prefixo estável — o system prompt, que não muda entre chamadas
// da mesma feature) já está ligado em ai-fallback.ts desde o upgrade do SDK
// pra 0.125.x (a 0.24.x fixada antes não tinha cache_control estável).
const TRIAGE_MODELS: ModelSpec[] = buildModelChain({
  anthropic: [process.env.COPILOTO_TRIAGE_MODEL || 'claude-haiku-4-5', 'claude-sonnet-4-6'],
  openaiModel: process.env.COPILOTO_TRIAGE_MODEL_OPENAI || 'gpt-4o-mini',
  groqModel: process.env.COPILOTO_TRIAGE_MODEL_GROQ || 'llama-3.3-70b-versatile',
  geminiModel: process.env.COPILOTO_TRIAGE_MODEL_GEMINI || 'gemini-2.5-flash',
});

const BRIEF_MODELS: ModelSpec[] = buildModelChain({
  anthropic: [process.env.COPILOTO_BRIEF_MODEL || 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openaiModel: process.env.COPILOTO_BRIEF_MODEL_OPENAI || 'gpt-4o',
  groqModel: process.env.COPILOTO_BRIEF_MODEL_GROQ || 'llama-3.3-70b-versatile',
  geminiModel: process.env.COPILOTO_BRIEF_MODEL_GEMINI || 'gemini-2.5-pro',
});

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
    const parsed = await callAiWithFallback({
      models: TRIAGE_MODELS,
      system: TRIAGE_SYSTEM_PROMPT,
      user,
      maxTokens: 200,
      userId: params.userId,
      feature: 'copiloto_triage',
      label: '[Copiloto]',
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
  commitment: { title: string; dueAt: string } | null;
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

/** Valida o "compromisso" que o modelo devolveu — título não-vazio + data ISO válida. */
function parseCommitment(raw: any): { title: string; dueAt: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.titulo === 'string' ? raw.titulo.trim() : '';
  const dueAt = typeof raw.prazo === 'string' ? raw.prazo.trim() : '';
  if (!title || !dueAt || isNaN(new Date(dueAt).getTime())) return null;
  return { title, dueAt };
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
  // Anotação do dono sobre sugestões anteriores DESSA MESMA conversa ("cliente
  // não fala assim", "preço tá errado") — só existe se ele editou no site
  // (/dashboard/copiloto). Mais recente primeiro.
  pastFeedback?: string[];
}): Promise<BriefingResult> {
  const kbBlock = params.knowledgeBase?.length
    ? params.knowledgeBase.map((k, i) => `[${i + 1}] P: ${k.question}\nR: ${k.answer}`).join('\n\n')
    : '(o dono não cadastrou perguntas frequentes)';

  const nowLabel = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
  });

  const user = [
    `Agora é: ${nowLabel} (timezone America/Sao_Paulo, UTC-3) — use isso pra inferir o prazo de "compromisso".`,
    `Sobre o negócio: ${params.businessContext?.trim() || '(não informado)'}`,
    aggressivenessGuide(params.aggressiveness),
    params.contactName ? `Nome do cliente: ${params.contactName}` : null,
    `Fatos do negócio que você PODE usar (única fonte de preço, prazo e política):\n${kbBlock}`,
    params.pastFeedback?.length
      ? `O dono já corrigiu sugestões anteriores DESTA conversa — leve em conta, não repita o mesmo erro:\n${params.pastFeedback.map((f) => `- ${f}`).join('\n')}`
      : null,
    `Conversa (mais antiga primeiro):\n${formatHistory(params.history)}`,
  ].filter(Boolean).join('\n\n');

  const parsed = await callAiWithFallback({
    models: BRIEF_MODELS,
    system: BRIEFING_SYSTEM_PROMPT,
    user,
    maxTokens: 1500,
    userId: params.userId,
    feature: 'copiloto_brief',
    label: '[Copiloto]',
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
      commitment: parseCommitment(found.compromisso),
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

// ─────────────────────────────────────────────────────────────────────────
// Função 2 — resumo diário de grupos
// ─────────────────────────────────────────────────────────────────────────

// Extrativo, sem persuasão nem guardrails de conteúdo (nunca sugere resposta) —
// roda no mesmo modelo barato da triagem em vez do de briefing.
const GROUP_DIGEST_MODELS = TRIAGE_MODELS;

export interface GroupDigestInput {
  name: string;
  messages: string[]; // "Fulano: texto", já formatado
}

export interface GroupDigestBlock {
  grupo: string;
  decidido: string | null;
  pendente: string | null;
  ruido: number;
}

export async function buildGroupDigest(params: {
  userId: string;
  ownerName?: string | null;
  groups: GroupDigestInput[];
}): Promise<{ blocos: GroupDigestBlock[] }> {
  const user = [
    // O próprio GROUP_DIGEST_SYSTEM_PROMPT pede "menções diretas ao dono" como
    // critério de relevância — sem o nome dele aqui, a IA não tinha como saber
    // quem procurar. Gap real, sem isso a regra nunca tinha efeito prático.
    params.ownerName ? `Nome do dono do negócio (procure menções diretas a ele nas mensagens): ${params.ownerName}` : null,
    params.groups
      .map((g) => `### Grupo: ${g.name}\n${g.messages.length ? g.messages.join('\n') : '(sem mensagens hoje)'}`)
      .join('\n\n'),
  ].filter(Boolean).join('\n\n');

  const parsed = await callAiWithFallback({
    models: GROUP_DIGEST_MODELS,
    system: GROUP_DIGEST_SYSTEM_PROMPT,
    user,
    maxTokens: 1200,
    userId: params.userId,
    feature: 'copiloto_grupo_digest',
    label: '[Copiloto]',
  });

  const blocos: GroupDigestBlock[] = Array.isArray(parsed?.blocos)
    ? parsed.blocos.map((b: any) => ({
        grupo:    typeof b?.grupo === 'string' ? b.grupo : '',
        decidido: typeof b?.decidido === 'string' && b.decidido.trim() ? b.decidido.trim() : null,
        pendente: typeof b?.pendente === 'string' && b.pendente.trim() ? b.pendente.trim() : null,
        ruido:    typeof b?.ruido === 'number' ? b.ruido : 0,
      }))
    : [];

  return { blocos };
}
