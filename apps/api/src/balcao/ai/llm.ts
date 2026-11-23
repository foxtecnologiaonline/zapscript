import { estimateTokens } from './text';

/**
 * Fronteira com o LLM. TODO o código de IA do Balcão fala só com `LlmClient` (injetável): testes usam um fake e
 * nenhuma chamada de rede acontece. A implementação padrão reutiliza a cadeia de fallback existente do ZapScript
 * (Anthropic → OpenAI → Groq → Gemini, `services/ai-fallback.ts`).
 *
 * Variáveis de ambiente (documentadas em docs/balcao/api-ai.md):
 *   BV_LLM_MODEL_FAST    modelo barato/rápido (chatbot, sugestão ao atendente)      padrão claude-haiku-4-5
 *   BV_LLM_MODEL_STRONG  modelo maior (curadoria, resumos)                          padrão claude-sonnet-5
 *   BV_LLM_MODEL_FAST_OPENAI / _GROQ / _GEMINI e BV_LLM_MODEL_STRONG_* — modelos dos provedores de reserva
 *   BV_LLM_DISABLED=1    desliga o LLM (o bot escala tudo para humanos)
 */
export type LlmTier = 'fast' | 'strong';

export interface LlmRequest {
  tier: LlmTier;
  system: string;
  user: string;
  maxTokens: number;
  /** Rótulo para logs/métricas (ex.: 'bv.bot'). Nunca inclua conteúdo de mensagens. */
  label: string;
}

export interface LlmResult {
  /** Texto bruto devolvido (esperado: um objeto JSON). */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResult>;
}

export const llmModels = {
  fast: () => process.env.BV_LLM_MODEL_FAST || 'claude-haiku-4-5',
  strong: () => process.env.BV_LLM_MODEL_STRONG || 'claude-sonnet-5',
};

/** Implementação de produção: delega para `callAiWithFallback` (import tardio — não carrega SDKs nos testes). */
export class FallbackLlmClient implements LlmClient {
  async complete(req: LlmRequest): Promise<LlmResult> {
    if (process.env.BV_LLM_DISABLED === '1') throw new Error('llm.disabled');
    if (process.env.NODE_ENV === 'test') throw new Error('llm.not_configured_in_test');
    const { buildModelChain, callAiWithFallback } = await import('../../services/ai-fallback');
    const t = req.tier === 'fast' ? 'FAST' : 'STRONG';
    const primary = llmModels[req.tier]();
    const models = buildModelChain({
      anthropic: [primary],
      openaiModel: process.env[`BV_LLM_MODEL_${t}_OPENAI`] || (req.tier === 'fast' ? 'gpt-4o-mini' : 'gpt-4o'),
      groqModel: process.env[`BV_LLM_MODEL_${t}_GROQ`] || 'llama-3.3-70b-versatile',
      geminiModel: process.env[`BV_LLM_MODEL_${t}_GEMINI`] || (req.tier === 'fast' ? 'gemini-2.5-flash' : 'gemini-2.5-pro'),
    });
    if (!models.length) throw new Error('llm.no_provider');
    const json = await callAiWithFallback({ models, system: req.system, user: req.user, maxTokens: req.maxTokens, label: `[${req.label}]` });
    const text = JSON.stringify(json);
    // callAiWithFallback não devolve uso/modelo efetivo: estimamos tokens e registramos o modelo preferencial.
    return { text, model: primary, inputTokens: estimateTokens(req.system + req.user), outputTokens: estimateTokens(text) };
  }
}

let client: LlmClient = new FallbackLlmClient();
export const getLlmClient = (): LlmClient => client;
/** Troca o cliente (testes injetam um fake). Retorna o anterior. */
export function setLlmClient(c: LlmClient): LlmClient { const prev = client; client = c; return prev; }

/** Extrai o primeiro objeto JSON de um texto (tolera cercas ```json e prosa ao redor). */
export function extractJsonObject(text: string): unknown {
  const t = (text ?? '').trim();
  try { return JSON.parse(t); } catch { /* tenta extrair */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* segue */ } }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('llm.no_json');
}
