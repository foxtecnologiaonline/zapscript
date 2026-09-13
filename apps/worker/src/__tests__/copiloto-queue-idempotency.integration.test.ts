/**
 * Teste de integração — usa Redis DE VERDADE (não mock), diferente do resto
 * da suíte do Copiloto. Verifica a premissa por trás da correção de
 * idempotência (CopilotoMessage.externalId, ver copiloto.ts processIngest):
 * o dedup por jobId do BullMQ ("copiloto-in-<messageId>") só vale ENQUANTO
 * o registro do job ainda existe no Redis — depois que ele é removido
 * (removeOnComplete, usado em produção com count:500/age:24h — ver
 * apps/api/src/services/queue.ts), adicionar o MESMO jobId de novo processa
 * de novo. Se essa premissa mudasse (ex.: upgrade do BullMQ com outro
 * comportamento), o teste abaixo quebraria e avisaria — é exatamente o tipo
 * de regressão silenciosa que os testes só-com-mock não pegam.
 *
 * Roda contra REDIS_URL quando definida (test.yml sobe um serviço Redis real
 * em CI) ou localhost:6379 por padrão. Se nenhum Redis estiver alcançável
 * (ambiente local sem Redis rodando), o describe inteiro é pulado — nunca
 * quebra a suíte por falta de infra, só perde a cobertura extra.
 */

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_QUEUE = `copiloto-idempotency-test-${Date.now()}`;

async function redisReachable(): Promise<boolean> {
  const client = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1000, lazyConnect: true });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

/** Espera até `pred()` ser true ou estourar o timeout — evita depender de eventos do BullMQ (QueueEvents), fonte comum de flakiness quando o listener não está pronto antes do job terminar. */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: timeout após ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let reachable = false;
beforeAll(async () => { reachable = await redisReachable(); });

describe('BullMQ jobId dedup — premissa da correção de idempotência (v2.1)', () => {
  it('processa o MESMO jobId de novo depois que o job completado é removido (removeOnComplete)', async () => {
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`[integration] Redis inalcançável em ${REDIS_URL} — pulando (sem Redis local/CI, não é falha)`);
      return;
    }

    // Conexões separadas pro Queue e pro Worker — BullMQ recomenda não
    // compartilhar (o Worker usa comandos bloqueantes internamente).
    // "as any": mesmo padrão já usado em copiloto.ts — o pnpm resolve mais de
    // uma cópia de ioredis na árvore (uma direta, outra interna do bullmq) e
    // o TS trata as duas como incompatíveis mesmo sendo a mesma classe em
    // runtime.
    const queueConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const workerConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(TEST_QUEUE, { connection: queueConnection as any });
    let processedCount = 0;

    const worker = new Worker(
      TEST_QUEUE,
      async () => { processedCount++; },
      { connection: workerConnection as any, removeOnComplete: { count: 0 } }, // mesmo espírito do removeOnComplete de produção: some rápido
    );
    await worker.waitUntilReady();

    try {
      const jobId = 'jobid-dedup-check';

      await queue.add('ingest', { n: 1 }, { jobId });
      await waitFor(() => processedCount === 1, 5000);

      // Dá um instante pro removeOnComplete de fato limpar o registro do job
      // (acontece depois do evento 'completed', não é instantâneo).
      await new Promise((r) => setTimeout(r, 300));

      // Mesmo jobId, DEPOIS do job anterior já ter sido removido — isto é
      // exatamente o que o sweep periódico de não lidas (copiloto-backfill.ts)
      // faz sem querer quando reprocessa um chat que continua não lido.
      const job2 = await queue.add('ingest', { n: 2 }, { jobId });
      expect(job2).toBeTruthy(); // BullMQ aceitou um NOVO job com o jobId "usado" — não devolveu o antigo

      // A premissa: os DOIS jobs rodaram. Se isto virar 1 num upgrade futuro
      // do BullMQ, a correção de externalId em processIngest fica redundante
      // (bom) mas este teste avisa a mudança em vez de deixar passar batido.
      await waitFor(() => processedCount === 2, 5000);
      expect(processedCount).toBe(2);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => null);
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
    }
  }, 15000);
});
