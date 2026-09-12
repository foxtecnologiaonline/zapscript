import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '../lib/logger';

/**
 * Rede de fallback multi-provedor pro Agente de Suporte (support-agent.ts).
 * Cópia irmã de apps/worker/src/services/ai-fallback.ts — api e worker são
 * pacotes/imagens Docker separados, sem código compartilhado em runtime além
 * de packages/database e packages/modules, por isso não dá pra importar
 * direto do worker.
 *
 * Anthropic é sempre a primeira escolha; OpenAI, Groq e Gemini só entram se
 * TODA a cadeia Anthropic falhar (rate limit, outage, sem crédito) — rede de
 * segurança, nunca escolha por qualidade. Groq e Gemini são compatíveis com a
 * API da OpenAI (mesmo client, troca só a baseURL).
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;
const gemini = process.env.GEMINI_API_KEY
  ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' })
  : null;

export type Provider = 'anthropic' | 'openai' | 'groq' | 'gemini';
export type ModelSpec = { provider: Provider; model: string };

const OPENAI_COMPAT_CLIENTS: Record<Exclude<Provider, 'anthropic'>, OpenAI | null> = { openai, groq, gemini };

// Kill-switch operacional: "AI_SKIP_PROVIDERS=anthropic" (ou "anthropic,groq"
// etc.) tira um provedor da cadeia inteira sem precisar de deploy — só editar
// /root/.env e `docker compose restart api worker`. Espelha a mesma variável
// em apps/worker/src/services/ai-fallback.ts.
const SKIPPED_PROVIDERS = new Set(
  (process.env.AI_SKIP_PROVIDERS || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean),
);

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

export function buildModelChain(params: {
  anthropic: string[];
  openaiModel?: string;
  groqModel?: string;
  geminiModel?: string;
}): ModelSpec[] {
  return dedupeSpecs([
    ...(SKIPPED_PROVIDERS.has('anthropic') ? [] : params.anthropic.map((model) => ({ provider: 'anthropic' as const, model }))),
    openai && params.openaiModel && !SKIPPED_PROVIDERS.has('openai') ? { provider: 'openai' as const, model: params.openaiModel } : null,
    groq && params.groqModel && !SKIPPED_PROVIDERS.has('groq') ? { provider: 'groq' as const, model: params.groqModel } : null,
    gemini && params.geminiModel && !SKIPPED_PROVIDERS.has('gemini') ? { provider: 'gemini' as const, model: params.geminiModel } : null,
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
 * o JSON parseado da primeira resposta bem-sucedida (chamada OK + texto com
 * JSON válido). Sem logAiUsage aqui — o support-agent.ts é interno da FOX,
 * não tem userId de tenant pra atribuir o custo.
 */
export async function callAiWithFallback(params: {
  models: ModelSpec[];
  system: string;
  user: string;
  maxTokens: number;
  label: string;
}): Promise<any> {
  let lastErr: any;
  for (const spec of params.models) {
    try {
      let text: string;
      if (spec.provider === 'anthropic') {
        const res = await claude.messages.create({
          model: spec.model,
          max_tokens: params.maxTokens,
          // Bloco de cache no prompt de sistema — mesmo texto grande e estável
          // em toda chamada da mesma feature. ~90% de desconto no prefixo
          // cacheado a partir do 2º hit dentro do TTL (5min por padrão).
          system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: params.user }],
        });
        text = textOfAnthropic(res);
      } else {
        const client = OPENAI_COMPAT_CLIENTS[spec.provider];
        if (!client) throw new Error(`${spec.provider} sem API key configurada`);
        const r = await callOpenAiCompatible(client, spec.model, params.system, params.user, params.maxTokens);
        text = r.text;
      }
      return extractJson(text, params.label);
    } catch (err: any) {
      lastErr = err;
      logger.warn(`${params.label} Modelo ${spec.provider}:${spec.model} falhou: ${err.message}`);
    }
  }
  throw new Error(`${params.label} todos os modelos falharam: ${lastErr?.message ?? 'erro desconhecido'}`);
}
