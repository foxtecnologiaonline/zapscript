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
  const kb = await prisma.atendeKnowledgeBase.findMany({
    where: { userId: params.userId, active: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { question: true, answer: true },
  }).catch(() => [] as { question: string; answer: string }[]);

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
