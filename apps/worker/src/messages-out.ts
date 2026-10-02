import { Worker, Job } from 'bullmq';
import { redis, messagesOutQueue } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { captureJobFailure, captureWorkerError } from './lib/sentry';
import { recordFailedJob } from './lib/dlq';
import { ApiError, isApiError, mapProviderError } from './lib/apiErrors';
import { markMessageSent, markMessageFailed } from './services/message-log';
import { sendOutbound, type OutboundSpec } from './services/message-gateway';

/**
 * Fila 'messages-out' — envio da API de escrita (item 1 do escopo
 * ZapScript × Twilio).
 *
 * A API aceita a mensagem, grava um MessageLog em 'queued' e enfileira aqui.
 * Este worker é o único lugar que de fato chama o provedor.
 *
 * Duas decisões que valem a leitura:
 *
 *  1. **Não relançamos erro definitivo.** O BullMQ só deve retentar o que tem
 *     chance de dar certo (throttle, indisponibilidade, timeout — o que o
 *     catálogo marca como `retryable`). Relançar um `template.param_mismatch`
 *     gastaria 3 tentativas para colher exatamente o mesmo erro e ainda
 *     poluiria o DLQ com um bug do cliente, não um incidente nosso.
 *
 *  2. **Guarda de duplicidade antes de tudo.** Se a linha já tem
 *     providerMessageId, a mensagem JÁ saiu — um job reprocessado (restart com
 *     lock expirado, replay de DLQ) não pode enviar de novo. No WhatsApp, isso
 *     seria mensagem duplicada no celular do contato final.
 */

export interface OutboundJobData extends Omit<OutboundSpec, 'userId' | 'numberId' | 'to'> {
  messageLogId: string;
  userId: string;
  numberId: string;
  to: string;
}

type JobOutcome = { skipped: true; reason: string } | { skipped?: false; providerMessageId: string | null };

export async function processOutboundMessageJob(job: Job<OutboundJobData>): Promise<JobOutcome> {
  const { messageLogId } = job.data;

  const row = await prisma.messageLog.findUnique({ where: { id: messageLogId } });
  if (!row) {
    // Log apagado (retenção, exclusão de conta): nada a enviar, e falhar aqui
    // só reenfileiraria para sempre.
    return { skipped: true, reason: `MessageLog ${messageLogId} não existe mais` };
  }
  if (row.providerMessageId) {
    return { skipped: true, reason: 'mensagem já enviada (providerMessageId presente)' };
  }
  if (row.status !== 'queued') {
    return { skipped: true, reason: `MessageLog está em "${row.status}", não em queued` };
  }

  const attempts = (job.attemptsMade ?? 0) + 1;
  const maxAttempts = job.opts?.attempts ?? 3;

  try {
    const result = await sendOutbound({
      userId:     job.data.userId,
      numberId:   job.data.numberId,
      to:         job.data.to,
      type:       job.data.type,
      text:       job.data.text,
      previewUrl: job.data.previewUrl,
      media:      job.data.media,
      template:   job.data.template,
    });

    await markMessageSent(row.id, result.providerMessageId, { attempts });
    logger.info(`[MessagesOut] ✅ ${row.id} enviada via ${result.channel} — ${result.providerMessageId ?? 'sem id'}`);
    return { providerMessageId: result.providerMessageId };
  } catch (err) {
    const apiErr: ApiError = isApiError(err) ? (err as ApiError) : mapProviderError(err);
    const willRetry = apiErr.retryable && attempts < maxAttempts;

    if (willRetry) {
      // Segue 'queued': o cliente que consultar vê que ainda está em andamento,
      // e o errorCode atual explica por que ainda não saiu.
      await prisma.messageLog.update({
        where: { id: row.id },
        data: { attempts, errorCode: apiErr.code, errorMessage: apiErr.message.slice(0, 1000) },
      }).catch(() => null);
      logger.warn(`[MessagesOut] ${row.id} falhou (${apiErr.code}) — tentativa ${attempts}/${maxAttempts}, vai retentar`);
      throw apiErr; // deixa o BullMQ agendar o backoff
    }

    await markMessageFailed(row.id, apiErr, { attempts });
    logger.error(`[MessagesOut] ❌ ${row.id} falhou definitivamente: ${apiErr.code} — ${apiErr.message}`);
    return { skipped: true, reason: apiErr.code };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.MESSAGES_OUT_CONCURRENCY || '4', 10);

export const messagesOutWorker = new Worker<OutboundJobData>('messages-out', processOutboundMessageJob, {
  connection: redis as any,
  concurrency: CONCURRENCY,
  // Mesmo teto de segurança das campanhas: 10 chamadas/seg à Graph API.
  limiter: { max: 10, duration: 1_000 },
});

messagesOutWorker.on('completed', (job, result: any) => {
  if (result?.skipped) {
    logger.warn(`[MessagesOut] Job ${job.id} ignorado — ${result.reason}`);
  }
});

messagesOutWorker.on('failed', (job, err) => {
  captureJobFailure('messages-out', job, err);
  const attempts    = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 3;
  logger.error(`[MessagesOut] Job ${job?.id} falhou (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
  // DLQ só na exaustão — o evento 'failed' dispara a cada tentativa.
  if (job && attempts >= maxAttempts) {
    void recordFailedJob('messages-out', job, err);
    // O status final no MessageLog é responsabilidade do processor, mas se o
    // job morreu por algo fora dele (lock perdido, OOM) a linha ficaria presa
    // em 'queued' para sempre. Fecha aqui.
    void markMessageFailed(job.data?.messageLogId, err, { attempts })
      .catch(() => null);
  }
});

messagesOutWorker.on('error', (err) => {
  captureWorkerError('messages-out', err);
  logger.error('[MessagesOut] Erro interno', { err: err.message });
});

/**
 * Rede de segurança: reenfileira mensagens presas em 'queued'.
 *
 * Quando isso acontece: a API gravou o MessageLog e caiu (ou o Redis recusou)
 * antes de enfileirar o job; ou o Redis perdeu a fila. Sem este sweep, a
 * mensagem fica em 'queued' para sempre e o cliente nunca sabe por quê.
 *
 * Só pega linhas paradas há mais de STUCK_AFTER_MINUTES, para não competir com
 * o job legítimo que está no backoff.
 */
const STUCK_AFTER_MINUTES = Math.max(2, Number(process.env.MESSAGES_OUT_STUCK_MINUTES || 5));

export async function recoverStuckQueuedMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000);
  const stuck = await prisma.messageLog.findMany({
    where: {
      direction: 'outbound',
      status:    'queued',
      source:    'api',
      queuedAt:  { lt: cutoff },
      providerMessageId: null,
    },
    orderBy: { queuedAt: 'asc' },
    take: 100,
  }).catch((err: any) => {
    logger.warn(`[MessagesOut] sweep de presas falhou na consulta: ${err?.message}`);
    return [] as any[];
  });

  let requeued = 0;
  for (const row of stuck) {
    // Sem o payload original não há como reconstruir template/mídia: só texto
    // é recuperável a partir da própria linha. O resto é marcado como falha
    // com código próprio, em vez de ficar pendurado.
    if (row.type !== 'text' || !row.body || !row.numberId) {
      await markMessageFailed(row.id, new ApiError('internal.error', {
        message: 'Envio não foi enfileirado e não pôde ser reconstruído — reenvie a mensagem.',
      }), { attempts: row.attempts });
      continue;
    }

    await messagesOutQueue.add(
      'send',
      {
        messageLogId: row.id,
        userId:       row.userId,
        numberId:     row.numberId,
        to:           row.toPhone,
        type:         'text',
        text:         row.body,
      },
      // jobId determinístico: se o job original ainda existir no Redis, o
      // BullMQ descarta este em vez de criar um segundo envio.
      { jobId: `recover:${row.id}` },
    ).then(() => { requeued++; }).catch((err: any) => {
      logger.warn(`[MessagesOut] falha ao reenfileirar ${row.id}: ${err?.message}`);
    });
  }

  if (requeued > 0) logger.info(`[MessagesOut] ${requeued} mensagem(ns) presa(s) reenfileirada(s)`);
  return requeued;
}

// unref(): o sweep não pode segurar o processo num shutdown (nem travar a
// saída do Jest ao importar este módulo num teste).
setInterval(() => { void recoverStuckQueuedMessages(); }, 5 * 60 * 1000).unref();

logger.info(`Worker de saída da API pública iniciado (messages-out, concorrência ${CONCURRENCY})`);
