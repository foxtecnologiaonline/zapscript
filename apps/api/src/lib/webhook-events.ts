import crypto from 'crypto';
import { prisma } from './prisma';
import { webhooksQueue } from '../services/queue';
import { logger } from './logger';

/**
 * Catálogo de eventos de webhook da API pública v1 e produtor da fila de
 * entrega. Quem dispara evento (rota, serviço, worker) NÃO faz fetch direto:
 * chama `enqueueWebhook` e segue a vida. A entrega em si (assinatura, POST,
 * retry, log) é responsabilidade única do consumidor da fila
 * `webhooks` — ver apps/worker/src/webhooks.ts.
 *
 * Por que fila e não fire-and-forget: o `fetch` solto que existia antes não
 * tinha retry nenhum. Um soluço de 2s na URL do integrador perdia o evento
 * para sempre — e no caso de uso que originou isso (paciente respondendo
 * "SIM" para confirmar consulta) o evento perdido é uma consulta que ninguém
 * confirmou. A fila dá 5 tentativas com backoff exponencial de graça.
 */

export const WEBHOOK_EVENTS = {
  /** Mensagem de TEXTO recebida de um contato num número do usuário. */
  MESSAGE_RECEIVED: 'message.received',
  /** Mudança de status de um envio feito via POST /public/v1/messages. */
  MESSAGE_STATUS: 'message.status',
  /** Transcrição de áudio concluída (evento histórico, anterior à v1). */
  TRANSCRIPTION_COMPLETED: 'transcription.completed',
} as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[keyof typeof WEBHOOK_EVENTS];

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = Object.values(WEBHOOK_EVENTS);

/** Nome do job na fila — um só; o evento vai no payload. */
export const WEBHOOK_JOB = 'deliver';

export interface WebhookJobData {
  userId: string;
  event: WebhookEvent;
  /** Corpo do campo `data` do payload final (o envelope é montado no worker). */
  data: Record<string, unknown>;
  /** ISO-8601 do momento do FATO (não da tentativa de entrega). */
  occurredAt: string;
  /**
   * Id desta entrega, gerado AQUI (no enfileiramento) e não no disparo.
   *
   * Isso é essencial e não é detalhe: o header X-ZapScript-Delivery é o que o
   * integrador usa para deduplicar, e a fila pode reentregar o mesmo evento
   * até 5 vezes (ex.: nosso POST chegou, mas a resposta se perdeu no caminho).
   * Se o id fosse sorteado a cada tentativa, o receptor veria 5 entregas
   * distintas e processaria a mesma resposta do contato 5 vezes — ou seja, a
   * deduplicação que a documentação promete não funcionaria.
   */
  deliveryId: string;
}

/**
 * Enfileira um evento, se e somente se o usuário tem webhook ativo E assinou
 * este evento. Dois motivos para checar aqui, antes de enfileirar:
 *   1. a esmagadora maioria dos usuários não tem webhook — enfileirar para
 *      todos encheria o Redis de job que só seria descartado no consumidor;
 *   2. `message.received` passa no caminho quente de toda mensagem de texto
 *      recebida (evolution-webhook), então o custo aqui precisa ser 1 SELECT
 *      indexado por userId e nada mais.
 *
 * Nunca lança: é chamada em caminho fire-and-forget e não pode derrubar o
 * fluxo principal (resposta do bot do Atende, ACK do webhook da Evolution).
 */
export async function enqueueWebhook(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  occurredAt: Date = new Date(),
): Promise<boolean> {
  try {
    const config = await (prisma as any).webhookConfig.findUnique({
      where:  { userId },
      select: { active: true, events: true },
    });
    if (!config?.active) return false;

    // `events` pode vir null/undefined em linha criada antes da migration que
    // adicionou a coluna — nesse caso vale o default histórico.
    const subscribed: string[] = Array.isArray(config.events) && config.events.length
      ? config.events
      : [WEBHOOK_EVENTS.TRANSCRIPTION_COMPLETED];
    if (!subscribed.includes(event)) return false;

    const job: WebhookJobData = {
      userId, event, data,
      occurredAt: occurredAt.toISOString(),
      deliveryId: crypto.randomUUID(),
    };
    await webhooksQueue.add(WEBHOOK_JOB, job);
    return true;
  } catch (err: any) {
    logger.warn({ err: err?.message, event, userId }, '[Webhook] Falha ao enfileirar evento');
    return false;
  }
}
