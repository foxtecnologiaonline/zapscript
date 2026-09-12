import { sendText } from './evolution';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Enviar mensagem via Evolution com retry automático (exponential backoff).
 *
 * Estratégia:
 * 1. Tenta enviar 3x
 * 2. Entre tentativas: espera 100ms, 200ms
 * 3. Atualiza BD com status (pending → sent/failed)
 * 4. Registra failure reason para debugging
 */
export async function sendTextWithRetry(
  zapiInstanceId: string,
  contactPhone: string,
  message: string,
  messageId?: string, // Se provided, atualiza status no BD
): Promise<{ success: boolean; attempts: number; lastError?: Error }> {
  const MAX_ATTEMPTS = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await sendText(zapiInstanceId, contactPhone, message);

      // Sucesso: atualizar BD se messageId foi provided
      if (messageId) {
        await prisma.atendeMessage.update({
          where: { id: messageId },
          data: {
            status: 'sent',
            failureReason: null,
            failureAttempts: attempt, // Quantas tentativas levou
          },
        }).catch((err) => {
          logger.warn({ err: err.message, messageId }, '[Retry] Falha ao atualizar status do envio bem-sucedido');
        });
      }

      return { success: true, attempts: attempt + 1 };
    } catch (err: any) {
      lastError = err;
      logger.warn(
        { err: err.message, attempt: attempt + 1, phone: contactPhone },
        '[Retry] Falha ao enviar mensagem',
      );

      // Último attempt falhou: registrar no BD
      if (attempt === MAX_ATTEMPTS - 1) {
        if (messageId) {
          const failureReason = err.message || 'unknown_error';
          await prisma.atendeMessage.update({
            where: { id: messageId },
            data: {
              status: 'failed',
              failureReason,
              failureAttempts: attempt + 1,
            },
          }).catch((dbErr) => {
            logger.error({ err: dbErr.message, messageId }, '[Retry] Falha ao marcar mensagem como failed');
          });
        }
        break; // Não tenta mais
      }

      // Exponential backoff entre tentativas
      const delayMs = 100 * Math.pow(2, attempt); // 100ms, 200ms
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { success: false, attempts: MAX_ATTEMPTS, lastError };
}

/**
 * Tentar novamente todas as mensagens com status 'pending'.
 * Executar periodicamente (cada 5min) ou via manual trigger.
 *
 * Uso:
 * ```
 * // Cron job
 * * /5 * * * * curl https://api.zapscript.me/internal/atende/retry-pending
 * ```
 */
export async function retryPendingMessages(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  const pending = await prisma.atendeMessage.findMany({
    where: {
      status: 'pending',
      failureAttempts: { lt: 5 }, // Max 5 tentativas no total (não deixa retry infinito)
    },
    include: {
      conversation: {
        include: { number: true },
      },
    },
  });

  let succeeded = 0;
  let failed = 0;

  for (const msg of pending) {
    if (!msg.conversation?.number?.zapiInstanceId) {
      logger.warn({ messageId: msg.id }, '[Retry] Conversa sem zapi instance, skipping');
      continue;
    }

    const result = await sendTextWithRetry(
      msg.conversation.number.zapiInstanceId,
      msg.conversation.contactPhone,
      msg.content,
      msg.id,
    );

    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  logger.info(
    { retried: pending.length, succeeded, failed },
    '[Retry] Batch retry completed',
  );

  return { retried: pending.length, succeeded, failed };
}
