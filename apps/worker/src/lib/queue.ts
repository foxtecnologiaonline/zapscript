import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Suprime o aviso de eviction policy do BullMQ (Upstash free tier usa optimistic-volatile).
// Não é um erro — é limitação conhecida do plano gratuito. Não afeta o funcionamento.
const _origWarn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Eviction policy is')) return;
  _origWarn(...args);
};

// ── Redis do worker com retry resiliente ──────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,  // obrigatório para BullMQ Worker
  enableReadyCheck:     false,
  lazyConnect:          false, // conectar imediatamente (worker não pode atrasar o start)
  // Keepalive: evita que o Upstash feche conexões ociosas (importante em baixo volume)
  keepAlive:            15_000,      // TCP keepalive a cada 15s
  connectTimeout:       10_000,      // timeout de conexão inicial
  commandTimeout:       30_000,      // timeout por comando (evita travamento em job lento)
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
  connection: redis as any,
  defaultJobOptions: {
    attempts: 4,
    backoff:  { type: 'exponential', delay: 5_000 },
    // Em escala (2000 números), manter histórico maior para diagnóstico
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },  // últimas 2k ou 48h
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 }, // últimas 5k ou 7 dias
  },
});
