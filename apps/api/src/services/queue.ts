import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../lib/logger';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  logger.warn('[Redis] ⚠️ REDIS_URL não configurado — fila de transcrição desabilitada');
}

export const redis = new Redis(redisUrl || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('[Redis] ❌ Falha ao conectar após 3 tentativas — desistindo');
      return null; // para de tentar reconectar
    }
    return Math.min(times * 1000, 5000);
  },
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, '[Redis] Erro de conexão');
});

redis.on('connect', () => {
  logger.info('[Redis] ✅ Conectado');
});

export const transcriptionQueue = new Queue('transcriptions', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});
