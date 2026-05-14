import { Queue } from 'bullmq';
import Redis from 'ioredis';

// ── Redis do worker com retry resiliente ──────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,  // obrigatório para BullMQ Worker
  enableReadyCheck:     false,
  lazyConnect:          false, // conectar imediatamente (worker não pode atrasar o start)
  retryStrategy: (times) => {
    const delay = Math.min(times * 1500, 30_000);
    console.warn(`[Redis/Worker] Reconectando (tentativa ${times}) em ${delay}ms`);
    return delay; // nunca null — worker deve ficar conectado sempre
  },
  reconnectOnError: (err) => {
    const reconnectable = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'];
    return reconnectable.some(code => err.message.includes(code));
  },
});

export const transcriptionQueue = new Queue('transcriptions', {
  connection: redis,
  defaultJobOptions: {
    attempts: 4,
    backoff:  { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 500, age: 24 * 60 * 60 },
    removeOnFail:     { count: 1000, age: 7 * 24 * 60 * 60 },
  },
});
