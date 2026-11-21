import { redis } from './queue';
import { logger } from './logger';

/**
 * Teto de envios por segundo POR NÚMERO (campanhas Meta).
 *
 * O `limiter` do Worker('campanhas') é global — soma todos os clientes. Duas
 * campanhas de donos diferentes competiam pela mesma cota de 10 msg/s. Aqui cada
 * número tem a sua janela de 1s no Redis (INCR + EXPIRE), e o teto global do
 * Worker continua valendo como cinto de segurança por cima.
 *
 * Fail-open: se o Redis falhar, deixa enviar. Travar o disparo inteiro por causa
 * de um limitador auxiliar seria pior do que passar do teto por alguns instantes
 * (o teto global do Worker segue protegendo).
 */
export const PER_NUMBER_MAX_PER_SEC = parseInt(process.env.CAMPANHAS_PER_NUMBER_MAX_PER_SEC || '5', 10);

export async function acquireSendSlot(numberId: string, maxPerSec: number = PER_NUMBER_MAX_PER_SEC): Promise<boolean> {
  try {
    const key = `campanhas:rl:${numberId}:${Math.floor(Date.now() / 1000)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2); // janela de 1s + folga de clock skew
    return count <= maxPerSec;
  } catch (err: any) {
    logger.warn(`[Campanhas] limitador por número indisponível (fail-open): ${err.message}`);
    return true;
  }
}
