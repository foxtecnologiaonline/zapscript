import { logger } from '../../lib/logger';
import { assertQuota, QuotaExceededError, recordUsage } from '../core/usage';
import type { LlmClient, LlmRequest } from './llm';
import { retrySuffix } from './prompt';
import { estimateTokens } from './text';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type CallResult<T> =
  | { ok: true; value: T; model: string; tokensIn: number; tokensOut: number; calls: number }
  | { ok: false; kind: 'LLM_ERROR' | 'LLM_INVALID' | 'QUOTA'; calls: number };

/**
 * Chama o LLM com validação da saída; 1 retry se a chamada falhar ou o JSON for inválido.
 * Contabiliza AI_CALLS / AI_TOKENS (estimados quando o provedor não informa) e respeita cota BLOCK.
 */
export async function callJson<T>(orgId: string, llm: LlmClient, req: LlmRequest, parse: (text: string) => Parsed<T>): Promise<CallResult<T>> {
  let tokensIn = 0; let tokensOut = 0; let calls = 0;
  let user = req.user;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await assertQuota(orgId, 'AI_CALLS'); } catch (err) {
      if (err instanceof QuotaExceededError) return { ok: false, kind: 'QUOTA', calls };
    }
    let res;
    try {
      calls++;
      res = await llm.complete({ ...req, user });
    } catch (err: any) {
      await recordUsage(orgId, 'AI_CALLS', 1);
      logger.warn({ label: req.label, attempt, err: String(err?.message ?? err).slice(0, 80) }, '[balcao.ai] chamada ao LLM falhou');
      if (attempt === 1) return { ok: false, kind: 'LLM_ERROR', calls };
      continue;
    }
    const tin = res.inputTokens || estimateTokens(req.system + user);
    const tout = res.outputTokens || estimateTokens(res.text);
    tokensIn += tin; tokensOut += tout;
    await recordUsage(orgId, 'AI_CALLS', 1);
    await recordUsage(orgId, 'AI_TOKENS', tin + tout);
    const parsed = parse(res.text);
    if (parsed.ok) return { ok: true, value: parsed.value, model: res.model, tokensIn, tokensOut, calls };
    user = req.user + retrySuffix(parsed.error);
  }
  return { ok: false, kind: 'LLM_INVALID', calls };
}
