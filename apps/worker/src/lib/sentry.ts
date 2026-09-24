import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';
import { logger } from './logger';

/**
 * Sentry do worker.
 *
 * A API já reportava (Sentry.init em apps/api/src/index.ts), mas o worker —
 * que é onde o pipeline realmente quebra (ffmpeg, Whisper, filas, envio ao
 * WhatsApp) — não reportava nada: falha virava uma linha de log e sumia.
 *
 * Mesma configuração da API (DSN opcional: sem SENTRY_DSN tudo vira no-op,
 * que é o caso em dev e nos testes).
 */

let enabled = false;

export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  enabled = true;
  logger.info('[Sentry] ✅ Ativo no worker');
}

/**
 * Um job só vira evento no Sentry quando ESGOTA as tentativas.
 *
 * Sem isso, cada retry transitório (Whisper com 429, Evolution fora do ar)
 * viraria um evento — a fila de transcrição sozinha tem attempts:4, então o
 * volume seria 4x o de falhas reais e o alerta perderia utilidade.
 */
export function captureJobFailure(queue: string, job: Job | undefined, err: Error): void {
  if (!enabled) return;

  const attempts    = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 1;
  if (attempts < maxAttempts) return;   // ainda vai tentar de novo

  Sentry.withScope((scope) => {
    scope.setTag('queue', queue);
    scope.setTag('job_name', job?.name ?? 'unknown');
    scope.setLevel('error');
    // CUIDADO: job.data carrega PII (telefone, nome do contato, áudio em
    // base64, texto transcrito). Nada disso vai pro Sentry — só os campos
    // que identificam O QUE falhou, não QUEM. userId é id interno
    // pseudonimizado e é o que permite correlacionar com o banco.
    scope.setContext('job', {
      id:       job?.id ?? null,
      queue,
      attempts,
      maxAttempts,
      userId:   (job?.data as any)?.userId ?? null,
      source:   (job?.data as any)?.source ?? null,
    });
    Sentry.captureException(err);
  });
}

/** Erro interno do próprio Worker (conexão, lock, evento solto) — sempre reporta. */
export function captureWorkerError(queue: string, err: Error): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('queue', queue);
    scope.setTag('kind', 'worker_internal');
    Sentry.captureException(err);
  });
}

/**
 * Esvazia a fila de envio antes do process.exit() do graceful shutdown —
 * sem isto os eventos ainda em buffer (justamente os do momento do deploy)
 * são descartados.
 */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!enabled) return;
  try { await Sentry.close(timeoutMs); } catch { /* nunca travar o shutdown */ }
}
