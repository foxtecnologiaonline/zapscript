import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Agente do ZapScript Atende — responde clientes finais de um tenant no WhatsApp.
 *
 * Diferença para o support-agent.ts (suporte interno da FOX): aqui o contexto do
 * negócio, o tom e a base de conhecimento são do TENANT (AtendeConfig/AtendeKnowledgeBase
 * por userId), não fixos da FOX. A resposta vai direto ao cliente final — sem fila de
 * aprovação humana — por isso o gate de confiança é o único freio antes do envio.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Telemetria de custo (não crítica): nunca deve travar ou atrasar a resposta ao cliente. */
export function logAiUsage(userId: string, feature: string, model: string, inputTokens?: number, outputTokens?: number): void {
  prisma.aiUsageLog.create({
    data: { userId, feature, model, inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 },
  }).catch((err: any) => logger.warn(`[Atende] Falha ao registrar AiUsageLog: ${err.message}`));
}

const AGENT_MODELS = [
  process.env.ATENDE_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

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

const SYSTEM_PROMPT = `Você é o atendente virtual de um negócio real, respondendo mensagens de clientes no WhatsApp em nome dele.

Regras inegociáveis:
- Responda SOMENTE com base no contexto do negócio e na base de conhecimento fornecidos pelo usuário abaixo. NUNCA invente preço, prazo, política, endereço ou qualquer dado que não esteja lá.
- Se a pergunta não estiver coberta pelo contexto/base, defina "precisa_humano": true e escreva uma resposta curta reconhecendo a dúvida, sem inventar a informação que falta.
- RESPOSTAS CURTAS: 1 a 3 frases, estilo mensagem real de WhatsApp. Sem introduções longas, sem assinatura, sem "Att,".
- Nunca mencione que você é uma IA, um robô ou um "agente automático" — responda como se fosse a própria equipe do negócio.
- Idioma: português brasileiro.

Você recebe o contexto do negócio, o tom de voz desejado, a base de conhecimento (perguntas frequentes cadastradas pelo dono do negócio) e a mensagem do cliente.
Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "resposta": "texto pronto para enviar ao cliente",
  "confianca": number (0-100, sua confiança de que a resposta está correta e completa),
  "precisa_humano": boolean (true se a dúvida foge do que você sabe ou exige julgamento humano)
}`;

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Agente Atende: resposta sem JSON');
  return JSON.parse(match[0]);
}

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

  const toneLabel = TONE_LABELS[params.config.tone] ?? params.config.tone;

  const userBlock = [
    `Sobre o negócio: ${params.config.businessContext?.trim() || '(não informado)'}`,
    `Tom de voz: ${toneLabel}`,
    params.contactName ? `Nome do cliente: ${params.contactName}` : null,
    params.history ? `Histórico recente da conversa:\n${params.history}` : null,
    `Base de conhecimento (perguntas frequentes cadastradas pelo negócio):\n${kbBlock}`,
    `Mensagem do cliente agora:\n"""${params.message}"""`,
  ].filter(Boolean).join('\n\n');

  let lastErr: any;
  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userBlock }],
      });
      const text = res.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const parsed = extractJson(text);

      logAiUsage(params.userId, 'atende_reply', model, res.usage?.input_tokens, res.usage?.output_tokens);

      const confidence = typeof parsed.confianca === 'number' ? parsed.confianca : 0;
      const reply = typeof parsed.resposta === 'string' ? parsed.resposta.trim() : '';
      const threshold = CONFIDENCE_THRESHOLDS[params.config.confidenceLevel ?? ''] ?? DEFAULT_CONFIDENCE_THRESHOLD;

      return {
        reply,
        confidence,
        needsHuman: !!parsed.precisa_humano || confidence < threshold || !reply,
      };
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[Atende] Modelo ${model} falhou: ${err.message}`);
    }
  }

  throw new Error(`Agente Atende falhou em todos os modelos: ${lastErr?.message ?? 'erro desconhecido'}`);
}
