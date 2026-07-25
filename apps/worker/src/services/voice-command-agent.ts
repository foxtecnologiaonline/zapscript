import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';

/**
 * Comando de Voz Universal — classifica se um áudio que o usuário mandou pro
 * PRÓPRIO número (self-note) é um comando, ou só uma nota pessoal normal.
 *
 * Risco assimétrico: classificar errado uma nota pessoal como comando gera
 * 1 mensagem extra indevida (chato, mas reversível). Deixar passar um comando
 * real como "none" só significa que o usuário repete depois. Por isso o
 * default é sempre "none" e o limiar de confiança é conservador.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODELS = [
  process.env.VOICE_COMMAND_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

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

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Voice command agent: resposta sem JSON');
  return JSON.parse(match[0]);
}

export async function classifyVoiceCommand(rawText: string): Promise<VoiceIntentResult> {
  const fallback: VoiceIntentResult = { intent: 'none', confidence: 0, data: {} };
  if (!rawText || rawText.trim().length < 3) return fallback;

  let lastErr: any;
  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Nota de voz transcrita:\n"""${rawText}"""` }],
      });
      const text = res.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const parsed = extractJson(text);

      const confidence = typeof parsed.confianca === 'number' ? parsed.confianca : 0;
      const intent: VoiceIntent = ['crm_create_lead', 'crm_query', 'atende_add_kb', 'stats_query', 'none']
        .includes(parsed.intent) ? parsed.intent : 'none';

      if (confidence < CONFIDENCE_THRESHOLD) return fallback;

      return { intent, confidence, data: parsed.dados ?? {} };
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[VoiceCommand] Modelo ${model} falhou: ${err.message}`);
    }
  }

  logger.warn(`[VoiceCommand] Classificação falhou em todos os modelos: ${lastErr?.message ?? 'erro desconhecido'} — default 'none'`);
  return fallback;
}
