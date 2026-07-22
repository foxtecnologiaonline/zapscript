import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../lib/logger';

// Suprime o aviso de eviction policy do BullMQ quando o Redis (Upstash free tier)
// usa "optimistic-volatile" em vez de "noeviction". Não é um erro — é limitação do plano.
const _origWarn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Eviction policy is')) return;
  _origWarn(...args);
};

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  logger.warn('[Redis] ⚠️ REDIS_URL não configurado — fila de conversão desabilitada');
}

// ── Redis com reconexão resiliente ────────────────────────────────────────────
// NUNCA dar return null — BullMQ precisa de conexão persistente.
// Exponential backoff até 30s, retry infinito (Upstash pode blitar por rate limit).
export const redis = new Redis(redisUrl || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,  // obrigatório para BullMQ
  enableReadyCheck:     false,
  lazyConnect:          true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 1500, 30_000); // 1.5s → 3s → ... → 30s
    logger.warn(`[Redis] Reconectando (tentativa ${times}) em ${delay}ms`);
    return delay; // nunca retorna null — reconecta indefinidamente
  },
  reconnectOnError: (err) => {
    // Reconectar em erros de rede (ECONNRESET, ETIMEDOUT, EPIPE)
    const reconnectable = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'];
    return reconnectable.some(code => err.message.includes(code));
  },
});

redis.on('error',        (err) => logger.error({ err: err.message }, '[Redis] Erro de conexão'));
redis.on('connect',      ()    => logger.info('[Redis] ✅ Conectado'));
redis.on('reconnecting', (ms:number) => logger.warn(`[Redis] Reconectando em ${ms}ms...`));
redis.on('ready',        ()    => logger.info('[Redis] ✅ Pronto'));

// ── Fila de conversões ───────────────────────────────────────────────────────
export const transcriptionQueue = new Queue('transcriptions', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 4,                              // 4 tentativas (era 3)
    backoff:  { type: 'exponential', delay: 5_000 }, // 5s → 10s → 20s → 40s
    removeOnComplete: { count: 500, age: 24 * 60 * 60 },     // últimas 500 ou 24h
    removeOnFail:     { count: 1000, age: 7 * 24 * 60 * 60 }, // últimas 1000 ou 7 dias
  },
});

// ── Fila de disparo de campanhas (ZapScript Campanhas) ───────────────────────
// Um job por destinatário — o worker reconfere o status da campanha antes de
// enviar (pausa/cancelamento não removem jobs já enfileirados, só os ignoram).
export const campanhasQueue = new Queue('campanhas', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 },
  },
});

// ── Fila de respostas automáticas (ZapScript Atende) ──────────────────────────
export const atendeQueue = new Queue('atende-replies', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 5_000 }, // 5s → 10s → 20s
    removeOnComplete: { count: 500, age: 24 * 60 * 60 },
    removeOnFail:     { count: 1000, age: 7 * 24 * 60 * 60 },
  },
});

// ── Fila de geração de legendas (ZapScript Legendas) ──────────────────────────
export const legendaQueue = new Queue('legendas', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 2,
    backoff:  { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 500, age: 24 * 60 * 60 },
    removeOnFail:     { count: 1000, age: 7 * 24 * 60 * 60 },
  },
});

// ── Fila de disparo de campanhas (ZapScript Campanhas) ───────────────────────
// Um job por destinatário — o worker reconfere o status da campanha antes de
// enviar (pausa/cancelamento não removem jobs já enfileirados, só os ignoram).
export const campanhasQueue = new Queue('campanhas', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 },
  },
});
