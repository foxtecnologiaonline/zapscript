import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '../lib/logger';
import { logAiUsage } from '../lib/aiUsage';

/**
 * Rede de fallback multi-provedor compartilhada pelos agentes do worker
 * (Atende, Comando de Voz, Copiloto).
 *
 * Anthropic é sempre a primeira escolha — é o que cada agente foi calibrado/
 * prompt-tuned em cima. OpenAI, Groq e Gemini só entram se TODA a cadeia
 * Anthropic falhar (rate limit, outage, sem crédito): rede de segurança,
 * nunca escolha por qualidade. Groq e Gemini são compatíveis com a API da
 * OpenAI (mesmo client, troca só a baseURL) — mesmo padrão já usado em
 * services/whisper.ts para transcrição.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;
// Gemini expõe uma camada de compatibilidade com a API da OpenAI — mesmo
// client, sem precisar de um SDK novo (@google/generative-ai) só pra isso.
const gemini = process.env.GEMINI_API_KEY
  ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' })
  : null;

export type Provider = 'anthropic' | 'openai' | 'groq' | 'gemini';
export type ModelSpec = { provider: Provider; model: string };

const OPENAI_COMPAT_CLIENTS: Record<Exclude<Provider, 'anthropic'>, OpenAI | null> = { openai, groq, gemini };

/** Remove entradas duplicadas (mesmo provider+model) preservando a ordem — e entradas null (provider sem API key). */
export function dedupeSpecs(specs: (ModelSpec | null)[]): ModelSpec[] {
  const seen = new Set<string>();
  const out: ModelSpec[] = [];
  for (const s of specs) {
    if (!s) continue;
    const key = `${s.provider}:${s.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Monta a cadeia padrão de um agente: modelo(s) Anthropic primeiro, depois
 * OpenAI/Groq/Gemini só se a API key estiver configurada (senão a entrada é
 * descartada — nunca tenta um provedor sem key).
 */
export function buildModelChain(params: {
  anthropic: string[]; // ordem de preferência, já incluindo overrides via env
  openaiModel?: string;
  groqModel?: string;
  geminiModel?: string;
}): ModelSpec[] {
  return dedupeSpecs([
    ...params.anthropic.map((model) => ({ provider: 'anthropic' as const, model })),
    openai && params.openaiModel ? { provider: 'openai' as const, model: params.openaiModel } : null,
    groq && params.groqModel ? { provider: 'groq' as const, model: params.groqModel } : null,
    gemini && params.geminiModel ? { provider: 'gemini' as const, model: params.geminiModel } : null,
  ]);
}

function textOfAnthropic(res: Anthropic.Message): string {
  return res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
}

async function callOpenAiCompatible(
  client: OpenAI, model: string, system: string, user: string, maxTokens: number,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const res = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return {
    text: res.choices[0]?.message?.content || '',
    inputTokens: res.usage?.prompt_tokens,
    outputTokens: res.usage?.completion_tokens,
  };
}

function extractJson(text: string, label: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`${label}: resposta sem JSON`);
  return JSON.parse(match[0]);
}

/**
 * Percorre a cadeia de modelos (Anthropic → OpenAI → Groq → Gemini) e devolve
 * o JSON parseado da primeira resposta que: (a) a chamada não lançou erro, e
 * (b) o texto continha um objeto JSON válido. Uma resposta sem JSON também
 * conta como falha desse modelo — tenta o próximo da cadeia, não só erros de
 * rede/API.
 */
export async function callAiWithFallback(params: {
  models: ModelSpec[];
  system: string;
  user: string;
  maxTokens: number;
  userId?: string;   // omitido => não loga AiUsageLog (ex.: voice-command-agent, sem contexto de usuário)
  feature: string;
  label: string;     // prefixo do log, ex. '[Atende]', '[Copiloto]', '[VoiceCommand]'
}): Promise<any> {
  let lastErr: any;
  for (const spec of params.models) {
    try {
      let text: string;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      if (spec.provider === 'anthropic') {
        const res = await claude.messages.create({
          model: spec.model,
          max_tokens: params.maxTokens,
          system: params.system,
          messages: [{ role: 'user', content: params.user }],
        });
        text = textOfAnthropic(res);
        inputTokens = res.usage?.input_tokens;
        outputTokens = res.usage?.output_tokens;
      } else {
        const client = OPENAI_COMPAT_CLIENTS[spec.provider];
        if (!client) throw new Error(`${spec.provider} sem API key configurada`);
        const r = await callOpenAiCompatible(client, spec.model, params.system, params.user, params.maxTokens);
        text = r.text;
        inputTokens = r.inputTokens;
        outputTokens = r.outputTokens;
      }
      const parsed = extractJson(text, params.label);
      if (params.userId) logAiUsage(params.userId, params.feature, spec.model, inputTokens, outputTokens);
      return parsed;
    } catch (err: any) {
      lastErr = err;
      logger.warn(`${params.label} Modelo ${spec.provider}:${spec.model} falhou (${params.feature}): ${err.message}`);
    }
  }
  throw new Error(`${params.label} todos os modelos falharam (${params.feature}): ${lastErr?.message ?? 'erro desconhecido'}`);
}
