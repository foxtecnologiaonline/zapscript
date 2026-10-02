import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { captureJobFailure, captureWorkerError } from './lib/sentry';
import { recordFailedJob } from './lib/dlq';
import { ApiError, mapProviderError } from './lib/apiErrors';
import { isSafeWebhookUrl } from './lib/url-safety';
import { buildSignature, revealWebhookSecret, toEventEnvelope } from './services/events';
import { RESPONSE_SNIPPET_MAX } from './services/message-log';

/**
 * Fila 'webhooks' — entrega dos eventos de plataforma (item 2 do escopo
 * ZapScript × Twilio).
 *
 * O que o webhook antigo não tinha e aqui existe: retry com backoff, histórico
 * por entrega, e um circuit breaker que desativa endpoint morto em vez de
 * tentar para sempre.
 *
 * Headers de cada entrega:
 *   X-ZapScript-Event        tipo do evento (ex.: message.delivered)
 *   X-ZapScript-Event-Id     id do evento (dedup do lado do cliente)
 *   X-ZapScript-Delivery-Id  id desta entrega
 *   X-ZapScript-Attempt      tentativa (1-based)
 *   X-ZapScript-Signature    t=<unix>,v1=<hmac>  (ou sha256=<hmac> no legado)
 */

/** Tempo máximo esperando o endpoint do cliente. */
const TIMEOUT_MS = Math.max(2_000, Number(process.env.WEBHOOK_TIMEOUT_MS || 10_000));

/**
 * Falhas consecutivas que desativam o endpoint. 15 com o backoff da fila
 * (30s → ~8min) é mais de uma hora de indisponibilidade antes de desligar —
 * manutenção normal do cliente não derruba a integração dele.
 */
const DISABLE_AFTER_FAILURES = Math.max(3, Number(process.env.WEBHOOK_DISABLE_AFTER || 15));

export interface DeliveryJobData {
  deliveryId: string;
}

type Outcome = { skipped: true; reason: string } | { skipped?: false; status: number };

export async function processWebhookDeliveryJob(job: Job<DeliveryJobData>): Promise<Outcome> {
  const { deliveryId } = job.data;

  const delivery = await prisma.webhookDelivery.findUnique({
    where:   { id: deliveryId },
    include: { endpoint: true, event: true },
  });
  if (!delivery)             return { skipped: true, reason: `entrega ${deliveryId} não existe mais` };
  if (delivery.status === 'succeeded') return { skipped: true, reason: 'já entregue' };
  if (!delivery.endpoint.active)       return { skipped: true, reason: 'endpoint desativado' };

  const attempt     = (job.attemptsMade ?? 0) + 1;
  const maxAttempts = job.opts?.attempts ?? 6;

  // Revalida a URL salva antes de cada fetch (defesa em profundidade): o DNS do
  // host do cliente pode ter passado a apontar para a rede interna DEPOIS do
  // cadastro — é o DNS rebinding na prática.
  const safe = await isSafeWebhookUrl(delivery.endpoint.url);
  if (!safe.ok) {
    await failDelivery(delivery, attempt, {
      errorCode:    'webhook.url_blocked',
      errorMessage: safe.error || 'URL bloqueada',
      final:        true,
    });
    await disableEndpoint(delivery.endpointId, `URL bloqueada: ${safe.error}`);
    return { skipped: true, reason: 'webhook.url_blocked' };
  }

  const envelope = toEventEnvelope(delivery.event);
  const body = JSON.stringify(envelope);

  let secret: string;
  try {
    secret = revealWebhookSecret(delivery.endpoint.secret);
  } catch (err: any) {
    // Segredo ilegível (ENCRYPTION_KEY trocada sem rotação): assinar com lixo
    // faria o cliente recusar silenciosamente para sempre. Melhor falhar alto.
    await failDelivery(delivery, attempt, {
      errorCode:    'internal.error',
      errorMessage: `Segredo do endpoint ilegível: ${err?.message}`,
      final:        true,
    });
    return { skipped: true, reason: 'segredo ilegível' };
  }

  try {
    const res = await fetch(delivery.endpoint.url, {
      method:  'POST',
      headers: {
        'Content-Type':             'application/json',
        'User-Agent':               'ZapScript-Webhooks/1.0',
        'X-ZapScript-Event':        envelope.type,
        'X-ZapScript-Event-Id':     envelope.id,
        'X-ZapScript-Delivery-Id':  delivery.id,
        'X-ZapScript-Attempt':      String(attempt),
        'X-ZapScript-Signature':    buildSignature(delivery.endpoint.signatureScheme, secret, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const snippet = await res.text()
      .then((t) => t.slice(0, RESPONSE_SNIPPET_MAX))
      .catch(() => null);

    if (res.ok) {
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status:         'succeeded',
            attempts:       attempt,
            responseStatus: res.status,
            responseBody:   snippet,
            errorCode:      null,
            errorMessage:   null,
            nextRetryAt:    null,
            deliveredAt:    new Date(),
          },
        }),
        prisma.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data:  { consecutiveFailures: 0, lastSuccessAt: new Date() },
        }),
      ]);
      logger.info(`[Webhooks] ✅ ${envelope.type} entregue em ${delivery.endpoint.url} (${res.status})`);
      return { status: res.status };
    }

    // 410 Gone é o jeito padrão de o cliente dizer "não me mande mais":
    // retentar 6 vezes seria insistir contra um pedido explícito.
    const isGone = res.status === 410;
    const final = isGone || attempt >= maxAttempts;

    await failDelivery(delivery, attempt, {
      errorCode:      'webhook.delivery_failed',
      errorMessage:   `HTTP ${res.status}`,
      responseStatus: res.status,
      responseBody:   snippet,
      final,
    });

    if (isGone) {
      await disableEndpoint(delivery.endpointId, 'O endpoint respondeu 410 Gone');
      return { skipped: true, reason: 'endpoint respondeu 410' };
    }

    await bumpEndpointFailure(delivery.endpointId);
    if (final) return { skipped: true, reason: `HTTP ${res.status} após ${attempt} tentativa(s)` };

    // Relança para o BullMQ agendar o backoff.
    throw new ApiError('webhook.delivery_failed', { message: `HTTP ${res.status}` });
  } catch (err: any) {
    if (err instanceof ApiError && err.code === 'webhook.delivery_failed' && err.message.startsWith('HTTP ')) {
      throw err; // já contabilizado acima
    }

    const apiErr = mapProviderError(err, { fallback: 'webhook.delivery_failed' });
    const final = attempt >= maxAttempts;

    await failDelivery(delivery, attempt, {
      errorCode:    apiErr.code,
      errorMessage: apiErr.message,
      final,
    });
    await bumpEndpointFailure(delivery.endpointId);

    if (final) {
      logger.error(`[Webhooks] ❌ ${envelope.type} desistiu após ${attempt} tentativas: ${apiErr.message}`);
      return { skipped: true, reason: apiErr.code };
    }
    throw apiErr;
  }
}

async function failDelivery(
  delivery: { id: string },
  attempt: number,
  opts: {
    errorCode: string; errorMessage: string;
    responseStatus?: number; responseBody?: string | null; final: boolean;
  },
) {
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status:         opts.final ? 'failed' : 'pending',
      attempts:       attempt,
      errorCode:      opts.errorCode,
      errorMessage:   opts.errorMessage.slice(0, 1000),
      ...(opts.responseStatus !== undefined ? { responseStatus: opts.responseStatus } : {}),
      ...(opts.responseBody   !== undefined ? { responseBody: opts.responseBody } : {}),
      // Espelha o backoff exponencial da fila (30s × 2^(n-1)), só para o
      // cliente ver no painel quando será a próxima tentativa.
      nextRetryAt:    opts.final ? null : new Date(Date.now() + 30_000 * Math.pow(2, attempt - 1)),
    },
  }).catch((err: any) => {
    logger.warn(`[Webhooks] falha ao gravar status da entrega ${delivery.id}: ${err?.message}`);
  });
}

/** Conta a falha e, no limite, desativa o endpoint (circuit breaker). */
async function bumpEndpointFailure(endpointId: string) {
  const updated = await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data:  { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date() },
  }).catch(() => null);

  if (updated && updated.consecutiveFailures >= DISABLE_AFTER_FAILURES) {
    await disableEndpoint(
      endpointId,
      `${updated.consecutiveFailures} falhas consecutivas — reative no painel depois de corrigir o endpoint`,
    );
  }
}

async function disableEndpoint(endpointId: string, reason: string) {
  await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data:  { active: false, disabledAt: new Date(), disabledReason: reason.slice(0, 500) },
  }).then(() => {
    logger.warn(`[Webhooks] endpoint ${endpointId} desativado: ${reason}`);
  }).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.WEBHOOKS_CONCURRENCY || '5', 10);

export const webhooksWorker = new Worker<DeliveryJobData>('webhooks', processWebhookDeliveryJob, {
  connection:  redis as any,
  concurrency: CONCURRENCY,
});

webhooksWorker.on('completed', (job, result: any) => {
  if (result?.skipped) logger.warn(`[Webhooks] Job ${job.id} ignorado — ${result.reason}`);
});

webhooksWorker.on('failed', (job, err) => {
  const attempts    = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 6;
  logger.warn(`[Webhooks] Job ${job?.id} falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
  // Endpoint de cliente fora do ar é rotina, não incidente nosso: só vai para
  // Sentry/DLQ na exaustão, senão o alerta vira ruído a cada manutenção deles.
  if (job && attempts >= maxAttempts) {
    captureJobFailure('webhooks', job, err);
    void recordFailedJob('webhooks', job, err);
  }
});

webhooksWorker.on('error', (err) => {
  captureWorkerError('webhooks', err);
  logger.error('[Webhooks] Erro interno', { err: err.message });
});

logger.info(`Worker de webhooks iniciado (concorrência ${CONCURRENCY})`);
