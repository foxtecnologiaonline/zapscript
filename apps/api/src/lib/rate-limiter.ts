import { redis } from '../services/queue';
import { logger } from './logger';

const CAMPANHAS_RATE_LIMIT = parseInt(process.env.CAMPANHAS_RATE_LIMIT || '50', 10); // msgs/min por tenant

/**
 * Verifica se o usuário está dentro do limite de taxa para disparar campanhas.
 * Usa token bucket em Redis com janela de 60 segundos.
 * Retorna {ok: true} se sob limite, {ok: false, remaining: N} se excedido.
 */
export async function checkCampanhaRateLimit(userId: string, messageCount: number): Promise<{ ok: boolean; remaining?: number }> {
  try {
    const key = `campanhas:${userId}:limit`;
    const current = await redis.incr(key);

    // Na primeira incrementada, seta expiry de 60s para a janela
    if (current === 1) {
      await redis.expire(key, 60);
    }

    const remaining = CAMPANHAS_RATE_LIMIT - current;
    const ok = current + messageCount - 1 <= CAMPANHAS_RATE_LIMIT;

    if (!ok) {
      logger.warn(`[RateLimit] Usuário ${userId} excedeu limite: ${current}/${CAMPANHAS_RATE_LIMIT} msgs/min`);
    }

    return { ok, remaining: Math.max(0, remaining) };
  } catch (error) {
    logger.error(`[RateLimit] Erro ao verificar limite: ${(error as Error).message}`);
    // Em caso de erro no Redis, permite prosseguir (fail-open)
    return { ok: true };
  }
}
