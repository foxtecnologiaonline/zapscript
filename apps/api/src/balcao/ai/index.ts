import type { FastifyInstance } from 'fastify';
import { registerJob } from '../core/scheduler';
import { startAiEngine, sweepIdleBotConversations } from './bot';
import { runCurationJob } from './curation';
import { runKbReviewJob } from './kb';
import { registerRoutes } from './routes';

export { setLlmClient, getLlmClient } from './llm';
export type { LlmClient, LlmRequest, LlmResult } from './llm';
export { startAiEngine, stopAiEngine, processInbound } from './bot';

/**
 * Frente de IA — registrada em balcao/index.ts com prefixo '/', logo as rotas são /balcao/ai/* e /balcao/kb/*.
 * Em NODE_ENV=test o motor NÃO se liga sozinho (outras frentes não podem disparar o bot em seus testes);
 * os testes desta frente chamam startAiEngine()/processInbound() explicitamente.
 */
export default async function plugin(app: FastifyInstance): Promise<void> {
  await registerRoutes(app);
  if (process.env.NODE_ENV !== 'test' || process.env.BV_AI_AUTOSTART === 'on') startAiEngine();

  registerJob('balcao.ai.idle_sweep', { intervalMs: 60_000, lockTtlSec: 55 }, async () => { await sweepIdleBotConversations(); });
  registerJob('balcao.ai.kb_review', { intervalMs: 24 * 3600_000, lockTtlSec: 600 }, async () => { await runKbReviewJob(); });
  registerJob('balcao.ai.curation', { intervalMs: 24 * 3600_000, lockTtlSec: 3600 }, async () => { await runCurationJob(); });
}
