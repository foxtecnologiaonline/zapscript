/**
 * Integração com BullMQ + Redis REAIS (não mock) para os dois comportamentos que
 * os testes unitários, por mockarem a fila, nunca conseguiriam provar:
 *
 *  1. `jobId` composto de campanha/missão é ACEITO pelo BullMQ (o formato antigo
 *     `campanhaId:contatoId` lançava "Custom Id cannot contain :" — nenhuma
 *     campanha conseguia enfileirar contatos).
 *  2. Estouro do teto por número: `moveToDelayed + DelayedError` reagenda o job
 *     SEM contar tentativa de retry e SEM emitir 'failed' — senão o contato iria
 *     para 'failed' só por excesso de ritmo.
 *
 * Mesmo padrão do copiloto-queue-idempotency.integration.test.ts: usa REDIS_URL
 * (ou localhost:6379); sem Redis alcançável o describe é pulado, nunca quebra.
 */
import { Queue, Worker, DelayedError, Job } from 'bullmq';
import IORedis from 'ioredis';
import { campanhaSendJobId, mktfastSendJobId } from '../lib/queue-job-id';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SUFFIX = Date.now();

async function redisReachable(): Promise<boolean> {
  const client = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1000, lazyConnect: true });
  try { await client.connect(); await client.ping(); return true; } catch { return false; } finally { client.disconnect(); }
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: timeout após ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let reachable = false;
beforeAll(async () => { reachable = await redisReachable(); });

function skipIfNoRedis(): boolean {
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(`[integration] Redis inalcançável em ${REDIS_URL} — pulando (sem Redis local/CI, não é falha)`);
    return true;
  }
  return false;
}

describe('fila de campanhas com BullMQ real', () => {
  it('addBulk aceita os jobIds gerados pelos helpers (e REJEITA o formato antigo com ":")', async () => {
    if (skipIfNoRedis()) return;
    const conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(`camp-it-ids-${SUFFIX}`, { connection: conn as any });
    try {
      // O bug original, reproduzido contra o BullMQ de verdade:
      await expect(queue.addBulk([{ name: 'send', data: {}, opts: { jobId: 'campanhaX:contatoY' } }]))
        .rejects.toThrow('Custom Id cannot contain :');

      const jobs = await queue.addBulk([
        { name: 'send', data: { campanhaId: 'cmabc', contatoId: 'cm001' }, opts: { jobId: campanhaSendJobId('cmabc', 'cm001'), delay: 60_000 } },
        { name: 'send', data: { campanhaId: 'cmabc', contatoId: 'cm002' }, opts: { jobId: campanhaSendJobId('cmabc', 'cm002'), delay: 60_000 } },
      ]);
      expect(jobs.map((j) => j.id)).toEqual(['camp-cmabc-cm001', 'camp-cmabc-cm002']);

      // Idempotência preservada: mesmo jobId de novo devolve o MESMO job (não duplica).
      const again = await queue.addBulk([{ name: 'send', data: {}, opts: { jobId: campanhaSendJobId('cmabc', 'cm001'), delay: 60_000 } }]);
      expect(again[0].id).toBe('camp-cmabc-cm001');
      expect(await queue.getJobCounts('delayed')).toEqual({ delayed: 2 });

      // getJob (usado em releaseFinishedJobIds) acha pelo mesmo helper.
      expect((await queue.getJob(campanhaSendJobId('cmabc', 'cm002')))?.id).toBe('camp-cmabc-cm002');

      // Fila de missões (mktfast) idem.
      const m = await queue.add('send', {}, { jobId: mktfastSendJobId('m1', 'e1'), delay: 60_000 });
      expect(m.id).toBe('mkt-m1-e1');
    } finally {
      await queue.obliterate({ force: true }).catch(() => null);
      await queue.close();
      conn.disconnect();
    }
  }, 20000);

  it('teto por número: moveToDelayed + DelayedError reagenda sem gastar retry e sem emitir "failed"', async () => {
    if (skipIfNoRedis()) return;
    const name = `camp-it-delay-${SUFFIX}`;
    const qc = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const wc = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(name, { connection: qc as any });
    let calls = 0;
    let failedEvents = 0;
    let lastAttemptsMade = -1;

    // Mesma forma de chamada de produção: o Worker entrega (job, token) ao processor.
    const processor = async (job: Job, token?: string) => {
      calls++;
      if (calls === 1) {
        await job.moveToDelayed(Date.now() + 300, token);
        throw new DelayedError();
      }
      lastAttemptsMade = job.attemptsMade;
      return { ok: true };
    };
    const worker = new Worker(name, processor, { connection: wc as any });
    worker.on('failed', () => { failedEvents++; });
    await worker.waitUntilReady();

    try {
      // attempts: 2 — se o reagendamento gastasse tentativa, a 2ª já seria a última.
      const job = await queue.add('send', { n: 1 }, { jobId: campanhaSendJobId('c', 'k'), attempts: 2, backoff: { type: 'fixed', delay: 50 } });
      await waitFor(() => calls === 2, 8000);
      await waitFor(() => lastAttemptsMade !== -1, 2000);
      await new Promise((r) => setTimeout(r, 200));

      expect(calls).toBe(2);              // rodou de novo depois do atraso
      expect(failedEvents).toBe(0);       // nunca falhou
      expect(lastAttemptsMade).toBe(0);   // retry NÃO foi consumido
      expect(await (await queue.getJob(job.id!))!.getState()).toBe('completed');
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => null);
      await queue.close();
      qc.disconnect();
      wc.disconnect();
    }
  }, 20000);
});
