/**
 * clear-failed-queue.mjs
 * Remove todos os jobs falhos da fila BullMQ 'transcriptions'
 *
 * Uso:
 *   node scripts/clear-failed-queue.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Tenta usar BullMQ do worker (já instalado)
let Queue;
try {
  Queue = require('../apps/worker/node_modules/bullmq/dist/cjs/classes/queue.js').Queue;
} catch {
  Queue = require('../node_modules/bullmq/dist/cjs/classes/queue.js').Queue;
}

let IORedis;
try {
  IORedis = require('../apps/worker/node_modules/ioredis/built/index.js').default;
} catch {
  IORedis = require('../node_modules/ioredis/built/index.js').default;
}

const REDIS_URL = 'rediss://default:gQAAAAAAAYm2AAIgcDEzMTNmYWNlN2U1NTA0MGQyOWExNmY0N2U3OTI4OTA4ZQ@lasting-spider-100790.upstash.io:6379';

async function main() {
  console.log('🔌 Conectando ao Upstash Redis...');

  const redis = new IORedis(REDIS_URL, {
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  await redis.connect();
  console.log('✅ Redis conectado');

  const queue = new Queue('transcriptions', { connection: redis });

  const failed = await queue.getFailed(0, 9999);
  console.log(`\n📋 ${failed.length} job(s) falho(s) encontrado(s)\n`);

  let removed = 0;
  for (const job of failed) {
    try {
      await job.remove();
      console.log(`  🗑️  [${job.id}] ${job.name} — removido`);
      removed++;
    } catch (e) {
      console.log(`  ⚠️  [${job.id}] falha ao remover: ${e.message}`);
    }
  }

  await queue.close();
  await redis.quit();

  console.log(`\n✅ Concluído! ${removed}/${failed.length} jobs removidos.`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
