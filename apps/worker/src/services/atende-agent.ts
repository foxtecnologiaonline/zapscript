import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { buildModelChain, callAiWithFallback, type ModelSpec } from './ai-fallback';
import { detectLanguage, getLanguageLabel } from '../lib/language-detect';

/**
 * Agente do ZapScript Atende — responde clientes finais de um tenant no WhatsApp.
 *
 * Diferença para o support-agent.ts (suporte interno da FOX): aqui o contexto do
 * negócio, o tom e a base de conhecimento são do TENANT (AtendeConfig/AtendeKnowledgeBase
 * por userId), não fixos da FOX. A resposta vai direto ao cliente final — sem fila de
 * aprovação humana — por isso o gate de confiança é o único freio antes do envio.
 *
 * Rede de fallback multi-provedor (Anthropic → OpenAI → Groq → Gemini) vem de
 * ./ai-fallback — compartilhada com copiloto-agent.ts e voice-command-agent.ts.
 */

const AGENT_MODELS: ModelSpec[] = buildModelChain({
  anthropic: [process.env.ATENDE_AGENT_MODEL || 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-haiku-4-5'],
  openaiModel: process.env.ATENDE_AGENT_MODEL_OPENAI || 'gpt-4o',
  groqModel: process.env.ATENDE_AGENT_MODEL_GROQ || 'llama-3.3-70b-versatile',
  geminiModel: process.env.ATENDE_AGENT_MODEL_GEMINI || 'gemini-2.5-flash',
});

// Abaixo disso, a resposta da IA não é enviada — cai no fallbackMessage do tenant
// e a conversa é marcada 'escalated'. Limiar por nível de confiança escolhido pelo
// dono do negócio (AtendeConfig.confidenceLevel): conservador escala mais (prioriza
// não errar em nome do negócio do cliente), autônomo escala menos (prioriza responder).
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  conservador: 80,
  equilibrado: 60,
  autonomo: 40,
};
const DEFAULT_CONFIDENCE_THRESHOLD = CONFIDENCE_THRESHOLDS.equilibrado;

const TONE_LABELS: Record<string, string> = {
  'profissional-amigavel': 'profissional e amigável: cordial, direto, sem gírias em excesso',
  'formal': 'formal: educado, comedido, sem emojis',
  'descontraido': 'descontraído: leve, pode usar emoji com moderação',
};

function getSystemPrompt(language: string): string {
  const intro = language === 'pt'
    ? 'Você é o atendente virtual de um negócio real, respondendo mensagens de clientes no WhatsApp em nome dele.'
    : language === 'en'
      ? 'You are a virtual customer service assistant for a real business, responding to customer messages on WhatsApp on its behalf.'
      : language === 'es'
        ? 'Eres un asistente de servicio al cliente virtual para un negocio real, respondiendo a mensajes de clientes en WhatsApp en su nombre.'
        : language === 'fr'
          ? 'Vous êtes un assistant de service client virtuel pour une entreprise réelle, répondant aux messages des clients sur WhatsApp en son nom.'
          : 'You are a virtual customer service assistant.';

  return `${intro}

Rules:
- Respond ONLY based on the business context and knowledge base provided below. NEVER invent price, deadline, policy, address or any data not there.
- If the question is not covered by context/base, set "precisa_humano": true and write a short response acknowledging the doubt, without inventing missing information.
- SHORT RESPONSES: 1-3 sentences, real WhatsApp message style. No long intros, no signature, no "Regards,".
- Never mention that you are an AI, robot or "automatic agent" — respond as if you were the business team itself.
- Language: ${language}.

You receive the business context, desired tone of voice, knowledge base (frequently asked questions registered by the business owner) and the customer's message.
Respond ONLY with a valid JSON object, no markdown, in the format:
{
  "resposta": "text ready to send to the customer",
  "confianca": number (0-100, your confidence that the response is correct and complete),
  "precisa_humano": boolean (true if the doubt goes beyond what you know or requires human judgment)
}`;
}

const SYSTEM_PROMPT_PT = getSystemPrompt('pt'); // Default/fallback

const STOPWORDS = new Set([
  'a','o','as','os','de','do','da','dos','das','um','uma','uns','umas','e','ou','que','pra','para',
  'com','sem','em','no','na','nos','nas','por','se','me','meu','minha','tem','ter','vai','voce','você',
  'eu','ele','ela','sao','são','como','mais','muito','ja','já','ai','aí','esse','essa','isso','qual',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? [],
  );
}

/**
 * Seleciona as entradas de KB mais relevantes pra mensagem do cliente, em vez
 * de sempre despejar a base inteira no prompt (caro e menos preciso conforme
 * a base cresce). Scoring simples por overlap de palavras — suficiente pro
 * volume atual (dezenas de FAQs por tenant); troca por embeddings se a base
 * crescer a ponto de o overlap léxico não bastar mais.
 */
function selectRelevantKb<T extends { question: string; answer: string }>(kb: T[], message: string, topK = 12): T[] {
  if (kb.length <= topK) return kb;

  const msgTokens = tokenize(message);
  if (msgTokens.size === 0) return kb.slice(0, topK);

  const scored = kb.map((item) => {
    const itemTokens = tokenize(`${item.question} ${item.answer}`);
    let overlap = 0;
    for (const t of msgTokens) if (itemTokens.has(t)) overlap++;
    return { item, score: overlap };
  });

  scored.sort((a, b) => b.score - a.score);
  // Entre os empatados em score 0 (nenhuma palavra em comum), preserva a ordem
  // original (mais antigas primeiro) em vez de embaralhar por causa do sort.
  return scored.slice(0, topK).map((s) => s.item);
}

export interface AtendeConfigLike {
  businessContext: string | null;
  tone: string;
  confidenceLevel?: string | null;
}

export interface AtendeAgentResult {
  reply: string;
  confidence: number;
  needsHuman: boolean;
}

export async function runAtendeAgent(params: {
  userId: string;
  config: AtendeConfigLike;
  message: string;
  contactName?: string | null;
  history?: string | null;
}): Promise<AtendeAgentResult> {
  const startTime = Date.now();

  const allKb = await prisma.atendeKnowledgeBase.findMany({
    where: { userId: params.userId, active: true },
    orderBy: { createdAt: 'asc' },
    take: 200, // teto de segurança; a seleção por relevância abaixo filtra pro que importa
    select: { question: true, answer: true },
  }).catch(() => [] as { question: string; answer: string }[]);
  const kb = selectRelevantKb(allKb, params.message);

  const kbBlock = kb.length
    ? kb.map((k, i) => `[${i + 1}] P: ${k.question}\nR: ${k.answer}`).join('\n\n')
    : '(negócio ainda não cadastrou perguntas frequentes)';

  // Detectar idioma da mensagem do cliente
  const detectedLang = detectLanguage(params.message);
  const langLabel = getLanguageLabel(detectedLang);
  const systemPrompt = getSystemPrompt(detectedLang);

  const toneLabel = TONE_LABELS[params.config.tone] ?? params.config.tone;

  const userBlock = [
    `Sobre o negócio: ${params.config.businessContext?.trim() || '(não informado)'}`,
    `Tom de voz: ${toneLabel}`,
    params.contactName ? `Nome do cliente: ${params.contactName}` : null,
    params.history ? `Histórico recente da conversa:\n${params.history}` : null,
    `Base de conhecimento (perguntas frequentes cadastradas pelo negócio):\n${kbBlock}`,
    `Mensagem do cliente agora:\n"""${params.message}"""`,
  ].filter(Boolean).join('\n\n');

  const aiStartTime = Date.now();
  const parsed = await callAiWithFallback({
    models: AGENT_MODELS,
    system: systemPrompt, // Idioma dinâmico
    user: userBlock,
    maxTokens: 512,
    userId: params.userId,
    feature: 'atende_reply',
    label: '[Atende]',
  });
  const aiElapsed = Date.now() - aiStartTime;

  const confidence = typeof parsed.confianca === 'number' ? parsed.confianca : 0;
  if (typeof parsed.confianca !== 'number') {
    logger.warn(`[Atende] Confiança inválida retornada pela IA: ${JSON.stringify(parsed.confianca)} (esperado number)`);
  }
  const reply = typeof parsed.resposta === 'string' ? parsed.resposta.trim() : '';
  if (typeof parsed.resposta !== 'string' || !reply) {
    logger.warn(`[Atende] Resposta vazia/inválida retornada pela IA: ${JSON.stringify(parsed.resposta)}`);
  }
  const threshold = CONFIDENCE_THRESHOLDS[params.config.confidenceLevel ?? ''] ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const totalElapsed = Date.now() - startTime;
  if (totalElapsed > 5000) {
    logger.warn(`[Atende] Agente lento: ${totalElapsed}ms total (AI: ${aiElapsed}ms, confidence=${confidence})`);
  }

  return {
    reply,
    confidence,
    needsHuman: !!parsed.precisa_humano || confidence < threshold || !reply,
  };
}
