import { logger } from '../lib/logger';
import { buildModelChain, callAiWithFallback, type ModelSpec } from './ai-fallback';

/**
 * Comando de Voz Universal — classifica se um áudio que o usuário mandou pro
 * PRÓPRIO número (self-note) é um comando, ou só uma nota pessoal normal.
 *
 * Risco assimétrico: classificar errado uma nota pessoal como comando gera
 * 1 mensagem extra indevida (chato, mas reversível). Deixar passar um comando
 * real como "none" só significa que o usuário repete depois. Por isso o
 * default é sempre "none" e o limiar de confiança é conservador.
 *
 * Rede de fallback multi-provedor (Anthropic → OpenAI → Groq → Gemini) vem de
 * ./ai-fallback — compartilhada com atende-agent.ts e copiloto-agent.ts.
 */

const AGENT_MODELS: ModelSpec[] = buildModelChain({
  anthropic: [process.env.VOICE_COMMAND_AGENT_MODEL || 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-haiku-4-5'],
  openaiModel: process.env.VOICE_COMMAND_AGENT_MODEL_OPENAI || 'gpt-4o-mini',
  groqModel: process.env.VOICE_COMMAND_AGENT_MODEL_GROQ || 'llama-3.3-70b-versatile',
  geminiModel: process.env.VOICE_COMMAND_AGENT_MODEL_GEMINI || 'gemini-2.5-flash',
});

// Mais conservador que o Atende (60) — aqui o custo de falso positivo é agir
// sem o usuário ter pedido, então exige mais certeza antes de disparar ação.
const CONFIDENCE_THRESHOLD = 70;

export type VoiceIntent = 'crm_create_lead' | 'crm_query' | 'atende_add_kb' | 'stats_query' | 'none';

export interface VoiceIntentResult {
  intent: VoiceIntent;
  confidence: number;
  data: {
    nome?: string;
    telefone?: string;
    empresa?: string;
    valor?: number;
    observacao?: string;
    pergunta?: string;
    resposta?: string;
  };
}

const SYSTEM_PROMPT = `Você classifica uma nota de voz que um usuário mandou para o PRÓPRIO número de WhatsApp (self-note, tipo "recado pra mim mesmo").

A GRANDE MAIORIA dessas notas é só o usuário pensando alto, um lembrete pessoal, um desabafo — NÃO um comando. Só classifique como comando quando a intenção for claramente uma instrução direta e acionável, no padrão de um dos 4 tipos abaixo. Na dúvida, classifique como "none".

Tipos possíveis:

1. "crm_create_lead" — usuário pede para criar/cadastrar um novo lead/contato no funil de vendas (CRM). Ex.: "cria um lead pro João, telefone 11 98888-7777, empresa Acme, negócio de 5 mil reais", "anota um contato novo: Maria da Padaria Central".
   → extrair em "dados": nome (obrigatório para confiar no intent), telefone, empresa, valor (número, em reais, sem símbolo), observacao (qualquer detalhe extra relevante).

2. "crm_query" — usuário pergunta sobre o estado do funil/CRM. Ex.: "quantos leads eu tenho", "como tá meu funil essa semana", "quantos negócios eu fechei esse mês".
   → "dados": { "pergunta": a pergunta limpa, sem o comando em si }.

3. "atende_add_kb" — usuário quer ensinar uma resposta pronta para o atendimento automático (Atende) responder sozinho da próxima vez. Ex.: "adiciona na base de conhecimento: quando perguntarem o horário de funcionamento, responde que é de segunda a sexta das 9h às 18h".
   → extrair em "dados": pergunta (a pergunta que o cliente faz) e resposta (o que o Atende deve responder). Os DOIS são obrigatórios para confiar no intent — se só um estiver claro, use confiança baixa.

4. "stats_query" — usuário pergunta sobre o próprio uso do ZapScript (áudios usados, minutos restantes, plano). Ex.: "quantos áudios eu já usei esse mês", "quanto falta da minha cota".
   → "dados": {} (vazio, não precisa extrair nada).

5. "none" — qualquer outra coisa: recado pessoal, desabafo, lembrete solto, pensamento em voz alta, ou pedido ambíguo demais para agir com segurança.
   → "dados": {}.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "intent": "crm_create_lead" | "crm_query" | "atende_add_kb" | "stats_query" | "none",
  "confianca": number (0-100, sua confiança de que classificou certo),
  "dados": { ... campos do tipo escolhido, conforme acima ... }
}`;

export async function classifyVoiceCommand(rawText: string): Promise<VoiceIntentResult> {
  const fallback: VoiceIntentResult = { intent: 'none', confidence: 0, data: {} };
  if (!rawText || rawText.trim().length < 3) return fallback;

  try {
    const parsed = await callAiWithFallback({
      models: AGENT_MODELS,
      system: SYSTEM_PROMPT,
      user: `Nota de voz transcrita:\n"""${rawText}"""`,
      maxTokens: 400,
      feature: 'voice_command',
      label: '[VoiceCommand]',
    });

    const confidence = typeof parsed.confianca === 'number' ? parsed.confianca : 0;
    const intent: VoiceIntent = ['crm_create_lead', 'crm_query', 'atende_add_kb', 'stats_query', 'none']
      .includes(parsed.intent) ? parsed.intent : 'none';

    if (confidence < CONFIDENCE_THRESHOLD) return fallback;

    return { intent, confidence, data: parsed.dados ?? {} };
  } catch (err: any) {
    logger.warn(`[VoiceCommand] Classificação falhou em todos os modelos: ${err.message} — default 'none'`);
    return fallback;
  }
}
