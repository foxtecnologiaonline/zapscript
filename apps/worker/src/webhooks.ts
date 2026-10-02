import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { decryptStr } from './services/encryption';
import { buildWebhookHeaders } from './lib/webhook-signature';
import { isSafeWebhookUrl } from './lib/webhook-url-guard';

/**
 * Consumidor da fila `webhooks` — o ÚNICO lugar do sistema que assina e
 * entrega um webhook de saída. Antes existiam três implementações soltas
 * (worker/index.ts, /webhook-config/test e o que fosse surgindo), e elas já
 * tinham divergido: o worker assinava com `config.secret` cru, que está
 * CRIPTOGRAFADO em repouso. Resultado: a assinatura do evento real nunca
 * validava no receptor, enquanto o endpoint de teste assinava certo — ou seja,
 * "no teste funciona, em produção não", o sintoma mais difícil de diagnosticar
 * que existe. Centralizar aqui é o que impede isso de voltar.
 *
 * Responsabilidades: montar o envelope, revalidar a URL (anti-SSRF no momento
 * do disparo, não só no cadastro), assinar com o secret EM CLARO, fazer o POST
 * e registrar a tentativa em WebhookDelivery. O retry é da fila (5 tentativas,
 * backoff exponencial) — lançar aqui é o jeito correto de pedir reentrega.
 */

const WEBHOOK_TIMEOUT_MS = 8_000;

export interface WebhookJobData {
  userId: string;
  event: string;
  data: Record<string, unknown>;
  occurredAt: string;
}

async function logDelivery(args: {
  userId: string; event: string; url: string;
  success: boolean; httpStatus?: number; attempt: number; error?: string;
}): Promise<void> {
  // O log é observabilidade, nunca o motivo de um evento falhar.
  await (prisma as any).webhookDelivery.create({
    data: {
      userId:     args.userId,
      event:      args.event,
      url:        args.url,
      success:    args.success,
      httpStatus: args.httpStatus ?? null,
      attempt:    args.attempt,
      error:      args.error?.slice(0, 500) ?? null,
    },
  }).catch(() => null);
}

export async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { userId, event, data, occurredAt } = job.data;
  const attempt = (job.attemptsMade ?? 0) + 1;

  const config = await (prisma as any).webhookConfig.findUnique({ where: { userId } });

  // Config apagada/desativada depois do enfileiramento, ou evento removido da
  // assinatura: descarta sem erro — reentregar não mudaria nada.
  if (!config?.active) {
    logger.info(`[Webhook] ${event}: config inativa/ausente (user ${userId}) — descartado`);
    return;
  }
  const subscribed: string[] = Array.isArray(config.events) && config.events.length
    ? config.events
    : ['transcription.completed'];
  if (!subscribed.includes(event)) {
    logger.info(`[Webhook] ${event}: não assinado por ${userId} — descartado`);
    return;
  }

  // Revalidação anti-SSRF no disparo: entre o cadastro e agora, o DNS do host
  // pode ter passado a apontar para IP interno (DNS rebinding). Falha aqui é
  // definitiva — reentregar bateria no mesmo IP interno.
  const safe = await isSafeWebhookUrl(config.url);
  if (!safe.ok) {
    logger.warn(`[Webhook] ${event}: URL recusada na revalidação (${safe.error}) — user ${userId}`);
    await logDelivery({ userId, event, url: config.url, success: false, attempt, error: `URL recusada: ${safe.error}` });
    return;
  }

  const deliveryId = crypto.randomUUID();
  // `timestamp` vai DENTRO do corpo assinado — é assim que o receptor rejeita
  // payload velho (replay) sem precisar de um segundo esquema de assinatura.
  const payload = { event, timestamp: occurredAt, data };
  const rawBody = JSON.stringify(payload);

  // decryptStr: o secret está criptografado em repouso. A própria decryptStr
  // devolve o valor como está se não estiver no formato iv:tag:data, então
  // linhas legadas em plaintext continuam funcionando.
  const headers = buildWebhookHeaders({
    secretPlain: decryptStr(config.secret),
    rawBody,
    event,
    deliveryId,
    timestamp: occurredAt,
  });

  let res: Response;
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers,
      body:   rawBody,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (err: any) {
    const msg = err?.message ?? 'erro de rede';
    await logDelivery({ userId, event, url: config.url, success: false, attempt, error: msg });
    // Lança: rede/timeout é exatamente o caso que merece retry da fila.
    throw new Error(`[Webhook] ${event} → ${config.url} falhou (tentativa ${attempt}): ${msg}`);
  }

  await logDelivery({
    userId, event, url: config.url,
    success: res.ok, httpStatus: res.status, attempt,
    error: res.ok ? undefined : `HTTP ${res.status}`,
  });

  if (res.ok) {
    logger.info(`[Webhook] ✅ ${event} → ${config.url} (${res.status}, entrega ${deliveryId})`);
    return;
  }

  // 4xx (exceto 408/429) é erro do receptor que retry não conserta — payload
  // que ele rejeita agora vai rejeitar igual daqui a 160s. Não gasta tentativa.
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  if (permanent) {
    logger.warn(`[Webhook] ${event} → ${config.url}: HTTP ${res.status} (permanente) — sem retry`);
    return;
  }

  throw new Error(`[Webhook] ${event} → ${config.url} devolveu HTTP ${res.status} (tentativa ${attempt})`);
}

export const webhooksWorker = new Worker('webhooks', processWebhookJob, {
  connection:  redis as any,
  concurrency: 5,
});

webhooksWorker.on('failed', (job, err) => {
  logger.warn('[Webhook] Job falhou', { jobId: job?.id, err: err?.message });
});
