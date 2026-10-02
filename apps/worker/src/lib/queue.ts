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

// Comando de Voz Universal: baixo volume (só self-notes), sem necessidade de
// histórico longo — falha aqui nunca deve reprocessar a transcrição original.
export const voiceCommandQueue = new Queue('voice-commands', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 2,
    backoff:  { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 500, age: 48 * 60 * 60 },
    removeOnFail:     { count: 1_000, age: 7 * 24 * 60 * 60 },
  },
});

// Produtor da fila 'campanhas' do lado do worker — usado pelo agendador
// (campanhas-scheduler.ts) para enfileirar o disparo quando scheduledAt
// chega, sem depender da API estar de pé no momento exato. Mesmas opções
// de job da fila declarada em apps/api/src/services/queue.ts (mesmo nome
// de fila, mesmo Redis — os dois processos produzem para ela).
export const campanhasQueue = new Queue('campanhas', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 },
  },
});

// Fila do MKT-Fast (missões de divulgação) — worker consome (processMissionJob,
// modules/mktfast.ts) e também produz (mktfast-scheduler.ts, missão agendada).
// Ver apps/api/src/services/queue.ts (mesmo nome de fila, mesmo Redis).
export const mktfastQueue = new Queue('mktfast', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 1_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 2_000, age: 7 * 24 * 60 * 60 },
  },
});

// ── Fila de saída da API pública (messages-out) ───────────────────────────────
// Declarada aqui também porque o worker PRODUZ para ela (reenfileira o envio
// de um MessageLog ainda em queued no sweep de recuperação). Mesmas opções da
// declaração em apps/api/src/services/queue.ts — se divergirem, o job
// reenfileirado teria política de retry diferente do original.
// Toda escrita de /public/v1/messages passa por aqui (item 1 do escopo
// ZapScript × Twilio). Por que assíncrono em vez de enviar na requisição:
//   • o retry fica com o BullMQ (e o job esgotado cai no DLQ, igual ao resto),
//     em vez de exigir que o cliente retente e arrisque duplicar;
//   • a resposta do HTTP não fica presa ao tempo da Graph API;
//   • o ciclo de vida (queued → sent → delivered → read) vira evento de
//     webhook, que é exatamente o modelo que quem vem do Twilio espera.
// attempts=3 com backoff longo: erro de envio costuma ser throttle do número,
// que não melhora em 5 segundos. O processor só deixa retentar erro marcado
// como retryable no catálogo (ver modules/messages-out.ts).
export const messagesOutQueue = new Queue('messages-out', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 15_000 }, // 15s → 30s → 60s
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 },
  },
});

// ── Fila de entrega de webhooks de saída (item 2) ────────────────────────────
// Um job por par (evento, endpoint). attempts=6 com backoff exponencial longo
// (30s → 1m → 2m → 4m → 8m): endpoint de cliente cai e volta, e desistir em 3
// tentativas rápidas perderia evento por manutenção de 5 minutos do lado dele.
export const webhooksQueue = new Queue('webhooks', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 6,
    backoff:  { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 2_000, age: 48 * 60 * 60 },
    removeOnFail:     { count: 5_000, age: 7 * 24 * 60 * 60 },
  },
});
