import type { Job } from 'bullmq';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Dead-letter queue — job que ESGOTOU as tentativas do BullMQ.
 *
 * Antes disto, o job que estourava os attempts ficava em 'failed' no Redis e
 * era apagado pelo removeOnFail (7 dias) sem ninguém ser avisado e sem jeito
 * de reprocessar. Na fila 'transcriptions' isso é áudio de cliente que
 * simplesmente nunca voltou, e o dono do número nem fica sabendo.
 *
 * Aqui o job vira linha em FailedJob: visível no admin (GET /admin/failed-jobs)
 * e reprocessável (POST /admin/failed-jobs/:id/replay).
 */

/**
 * Chaves que NÃO vão pro banco.
 *
 * `audioBase64`/`mediaBase64` são o áudio inteiro em base64 — guardar isso em
 * JSONB estoura a linha e duplica dado pessoal que o pipeline apaga de
 * propósito. `messageData` é o objeto cru da Evolution, que em alguns tipos de
 * mídia também vem com o binário embutido.
 *
 * O replay continua possível quando a origem é recuperável por referência
 * (storageKey, messageId/instanceName) — que é o caso das filas de áudio.
 */
const STRIPPED_KEYS = ['audioBase64', 'mediaBase64', 'buffer', 'messageData'];

/** Teto do payload serializado (100 KB). Acima disso guarda só as chaves curtas. */
const MAX_PAYLOAD_BYTES = 100_000;

function sanitizePayload(data: any): { payload: any; trimmed: boolean } {
  if (!data || typeof data !== 'object') return { payload: {}, trimmed: false };

  let trimmed = false;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (STRIPPED_KEYS.includes(k)) { trimmed = true; continue; }
    out[k] = v;
  }

  // Rede de segurança: se ainda assim ficou grande (payload inesperado), corta
  // tudo que não for escalar curto em vez de gravar um JSONB gigante.
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_PAYLOAD_BYTES) {
    trimmed = true;
    for (const [k, v] of Object.entries(out)) {
      const isShortScalar =
        (typeof v === 'string' && v.length <= 200) ||
        typeof v === 'number' || typeof v === 'boolean' || v === null;
      if (!isShortScalar) delete out[k];
    }
  }

  return { payload: out, trimmed };
}

/**
 * Grava o job esgotado. Só deve ser chamada quando attempts >= maxAttempts —
 * gravar todo 'failed' encheria a tabela de retry transitório.
 *
 * Nunca lança: uma falha ao registrar a falha não pode derrubar o handler.
 */
export async function recordFailedJob(queue: string, job: Job | undefined, err: Error): Promise<void> {
  if (!job) return;

  const attempts    = job.attemptsMade ?? 0;
  const maxAttempts = job.opts?.attempts ?? 1;
  if (attempts < maxAttempts) return;   // ainda vai tentar de novo

  try {
    const { payload, trimmed } = sanitizePayload(job.data);
    const bullJobId = job.id != null ? String(job.id) : null;

    const data = {
      queue,
      jobName:        job.name ?? 'unknown',
      bullJobId,
      userId:         typeof (job.data as any)?.userId === 'string' ? (job.data as any).userId : null,
      payload,
      payloadTrimmed: trimmed,
      errorMessage:   (err?.message || 'erro desconhecido').slice(0, 1000),
      attempts,
    };

    // O evento 'failed' pode chegar duplicado (reconexão do worker); a unique
    // (queue, bullJobId) garante uma linha só. Sem bullJobId não há como
    // deduplicar, então cria direto.
    if (bullJobId) {
      await prisma.failedJob.upsert({
        where:  { queue_bullJobId: { queue, bullJobId } },
        create: data,
        update: { errorMessage: data.errorMessage, attempts, failedAt: new Date() },
      });
    } else {
      await prisma.failedJob.create({ data });
    }

    logger.warn(`[DLQ] Job esgotado registrado — fila ${queue}, job ${bullJobId ?? '(sem id)'}`);
  } catch (e: any) {
    logger.error(`[DLQ] Falha ao registrar job esgotado da fila ${queue}: ${e.message}`);
  }
}
