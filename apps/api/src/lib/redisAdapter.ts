import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Cria um cliente Redis dedicado para o Socket.IO adapter.
// NÃO pode ser o mesmo do BullMQ (que tem maxRetriesPerRequest:null e enableReadyCheck:false,
// requisitos que conflitam com o uso normal do adapter).
function makeAdapterClient(label: string) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 1500, 30_000),
  });
  client.on('error',   (err) => logger.warn({ err: err.message }, `[Redis/${label}] erro`));
  client.on('connect', ()    => logger.info(`[Redis/${label}] conectado`));
  return client;
}

// pub → escreve eventos; sub → recebe eventos (o adapter exige dois clientes separados)
export const pubClient = makeAdapterClient('pub');
export const subClient = makeAdapterClient('sub');
