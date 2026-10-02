import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { ApiError, isApiError, mapProviderError } from '../lib/apiErrors';
import { emitEvent } from './events';

/**
 * Log unificado de mensagens (item 5 do escopo ZapScript × Twilio).
 *
 * Antes disto a resposta para "esta mensagem saiu?" dependia de saber POR ONDE
 * ela saiu: campanha vivia em CampanhaContato, resposta automática em
 * AtendeMessage, aviso em Aviso, cobrança em CobrancaEnvio — e envio por API
 * não ficava registrado em lugar nenhum. O MessageLog é a tabela única: toda
 * mensagem que entra ou sai da plataforma passa a ter uma linha com status,
 * id do provedor e CÓDIGO de erro do nosso catálogo (não a frase da Meta).
 *
 * Duas regras que valem para tudo neste arquivo:
 *
 *  1. O log NUNCA derruba o envio. Se a gravação falha, logamos um warn e
 *     seguimos — a mensagem já está no WhatsApp do destinatário, falhar aqui
 *     só transformaria um sucesso em erro 500 para o cliente. Por isso o
 *     try/catch envolve TODA a função e não é um `.catch()` encadeado: os
 *     chamadores usam `void logSentOutbound(...)`, então uma exceção SÍNCRONA
 *     (não só uma promise rejeitada) viraria unhandled rejection e mataria o
 *     processo do worker. A exceção é logQueuedOutbound, que propaga de
 *     propósito: a rota de escrita precisa do id da linha para responder.
 *  2. Toda transição de status emite o evento de plataforma correspondente
 *     (message.sent, message.delivered, …). Fica aqui, e não em cada chamador,
 *     porque assim é impossível um caminho de envio novo esquecer de emitir —
 *     era exatamente o que acontecia com o webhook antigo, que só o pipeline
 *     de transcrição disparava.
 *  3. Logging só com string (sem `logger.info(obj, msg)`): este arquivo é
 *     COPIADO byte a byte para apps/worker/src/services/message-log.ts (os
 *     Dockerfiles de api e worker não compartilham packages/*), e os dois
 *     loggers têm assinaturas diferentes. Um teste falha se as cópias
 *     divergirem.
 */

/** Teto do texto guardado. Mensagem de WhatsApp vai até 4096; mídia tem legenda curta. */
export const BODY_MAX_CHARS = 4096;
/** Teto do corpo de resposta de webhook guardado em WebhookDelivery. */
export const RESPONSE_SNIPPET_MAX = 512;

export type MessageDirection = 'outbound' | 'inbound';
export type MessageChannel = 'meta' | 'evolution';
export type MessageType = 'text' | 'template' | 'image' | 'audio' | 'video' | 'document' | 'sticker';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

/** Quem originou o envio — permite filtrar "só o que saiu pela API" nas métricas. */
export type MessageSource =
  | 'api' | 'campanha' | 'atende' | 'aviso' | 'cobranca'
  | 'copiloto' | 'zapscreve' | 'transcricao' | 'suporte' | 'sistema';

/**
 * Ordem do ciclo de vida. Serve para NÃO regredir status: a Meta entrega
 * `delivered` e `read` por webhooks independentes e eles chegam fora de ordem
 * com frequência — sem isto, um `delivered` atrasado apagaria o `read`.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  queued: 0, received: 1, sent: 1, delivered: 2, read: 3, failed: 4,
};

export function isStatusProgress(from: string, to: MessageStatus): boolean {
  // 'failed' sempre vence (é terminal e é o que o cliente precisa ver).
  if (to === 'failed') return from !== 'failed';
  const current = STATUS_RANK[from as MessageStatus];
  return current === undefined ? true : STATUS_RANK[to] > current;
}

export function truncateBody(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > BODY_MAX_CHARS ? text.slice(0, BODY_MAX_CHARS) : text;
}

/** Só dígitos — é como o WhatsApp identifica o número em todos os canais. */
export function normalizePhone(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

export interface MessageLogInput {
  userId: string;
  numberId?: string | null;
  channel: MessageChannel;
  source: MessageSource;
  sourceId?: string | null;
  toPhone: string;
  fromPhone?: string | null;
  type: MessageType;
  body?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  mediaUrl?: string | null;
  idempotencyKey?: string | null;
}

function baseData(input: MessageLogInput) {
  return {
    userId:           input.userId,
    numberId:         input.numberId ?? null,
    channel:          input.channel,
    source:           input.source,
    sourceId:         input.sourceId ?? null,
    toPhone:          normalizePhone(input.toPhone),
    fromPhone:        input.fromPhone ? normalizePhone(input.fromPhone) : null,
    type:             input.type,
    body:             truncateBody(input.body),
    templateName:     input.templateName ?? null,
    templateLanguage: input.templateLanguage ?? null,
    mediaUrl:         input.mediaUrl ?? null,
    idempotencyKey:   input.idempotencyKey ?? null,
  };
}

/**
 * Registra uma saída AINDA NÃO ENVIADA (status 'queued'). É o primeiro passo da
 * API de escrita: a linha nasce antes do job da fila, para que o id devolvido
 * ao cliente já exista e ele possa consultar o status depois.
 */
export async function logQueuedOutbound(input: MessageLogInput) {
  const row = await prisma.messageLog.create({
    data: { ...baseData(input), direction: 'outbound', status: 'queued' },
  });
  void emitEvent({
    userId: row.userId, type: 'message.queued',
    resourceId: row.id, data: { message: toPublicMessage(row) },
  });
  return row;
}

/**
 * Registra uma saída que JÁ ACONTECEU (status 'sent'). Para os caminhos
 * síncronos que existiam antes da fila de saída (campanhas, atende, avisos):
 * eles enviam e depois contam o que fizeram.
 */
export async function logSentOutbound(
  input: MessageLogInput & { providerMessageId?: string | null },
) {
  // try/catch em volta de TUDO, não `.catch()` encadeado: o chamador invoca com
  // `void` (fire-and-forget), então uma exceção SÍNCRONA aqui — não só uma
  // promise rejeitada — viraria unhandled rejection e derrubaria o processo
  // depois de a mensagem já ter sido enviada.
  try {
    const row = await prisma.messageLog.create({
      data: {
        ...baseData(input),
        direction:         'outbound',
        status:            'sent',
        providerMessageId: input.providerMessageId ?? null,
        sentAt:            new Date(),
        attempts:          1,
      },
    });
    void emitEvent({
      userId: row.userId, type: 'message.sent',
      resourceId: row.id, data: { message: toPublicMessage(row) },
    });
    return row;
  } catch (err: any) {
    logger.warn(`[MessageLog] falha ao registrar envio (${input.source}): ${err?.message}`);
    return null;
  }
}

/** Registra uma mensagem recebida (inbound). Estado terminal 'received'. */
export async function logInbound(
  input: MessageLogInput & { providerMessageId?: string | null },
) {
  try {
    const row = await prisma.messageLog.create({
      data: {
        ...baseData(input),
        direction:         'inbound',
        status:            'received',
        providerMessageId: input.providerMessageId ?? null,
      },
    });
    void emitEvent({
      userId: row.userId, type: 'message.received',
      resourceId: row.id, data: { message: toPublicMessage(row) },
    });
    return row;
  } catch (err: any) {
    logger.warn(`[MessageLog] falha ao registrar recebimento: ${err?.message}`);
    return null;
  }
}

/** Marca uma saída como enviada, guardando o id do provedor (wamid). */
export async function markMessageSent(
  id: string,
  providerMessageId: string | null,
  opts: { attempts?: number } = {},
) {
  try {
    const row = await prisma.messageLog.update({
      where: { id },
      data: {
        status:            'sent',
        providerMessageId: providerMessageId,
        sentAt:            new Date(),
        errorCode:         null,
        errorMessage:      null,
        ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      },
    });
    void emitEvent({
      userId: row.userId, type: 'message.sent',
      resourceId: row.id, data: { message: toPublicMessage(row) },
    });
    return row;
  } catch (err: any) {
    logger.warn(`[MessageLog] falha ao marcar ${id} como sent: ${err?.message}`);
    return null;
  }
}

/**
 * Marca uma saída como falha, traduzindo o erro do provedor para um código do
 * catálogo. É este código que vai para o cliente (API e webhook) — a frase da
 * Meta fica só em errorMessage, para o suporte.
 */
export async function markMessageFailed(
  id: string,
  err: unknown,
  opts: { provider?: 'meta' | 'evolution'; attempts?: number } = {},
) {
  const apiErr: ApiError = isApiError(err)
    ? (err as ApiError)
    : mapProviderError(err, { provider: opts.provider });

  try {
    const row = await prisma.messageLog.update({
      where: { id },
      data: {
        status:       'failed',
        errorCode:    apiErr.code,
        errorMessage: apiErr.message.slice(0, 1000),
        failedAt:     new Date(),
        ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      },
    });
    void emitEvent({
      userId: row.userId, type: 'message.failed',
      resourceId: row.id, data: { message: toPublicMessage(row) },
    });
    return row;
  } catch (dbErr: any) {
    logger.warn(`[MessageLog] falha ao marcar ${id} como failed: ${dbErr?.message}`);
    return null;
  }
}

/**
 * Aplica um status vindo do provedor (delivered/read/failed) correlacionando
 * pelo id dele. Ignora regressão de status — os webhooks da Meta chegam fora
 * de ordem e um `delivered` atrasado não pode apagar um `read`.
 *
 * Devolve a linha atualizada, ou null quando não há correlação (mensagem
 * enviada antes do log existir) ou quando o status era regressão.
 */
export async function applyProviderStatus(
  providerMessageId: string,
  status: MessageStatus,
  opts: { errorCode?: string | null; errorMessage?: string | null } = {},
) {
  if (!providerMessageId) return null;

  try {
    const row = await prisma.messageLog.findFirst({
      where:   { providerMessageId },
      orderBy: { queuedAt: 'desc' },
    });
    if (!row) return null;
    if (!isStatusProgress(row.status, status)) return null;

    const timestampField =
      status === 'delivered' ? { deliveredAt: new Date() }
      : status === 'read'    ? { readAt: new Date() }
      : status === 'failed'  ? { failedAt: new Date() }
      : {};

    const updated = await prisma.messageLog.update({
      where: { id: row.id },
      data: {
        status,
        ...timestampField,
        ...(opts.errorCode     !== undefined ? { errorCode: opts.errorCode } : {}),
        ...(opts.errorMessage  !== undefined ? { errorMessage: opts.errorMessage?.slice(0, 1000) ?? null } : {}),
      },
    });
    void emitEvent({
      userId: updated.userId, type: `message.${status}`,
      resourceId: updated.id, data: { message: toPublicMessage(updated) },
    });
    return updated;
  } catch (err: any) {
    logger.warn(`[MessageLog] falha ao aplicar status ${status} em ${providerMessageId}: ${err?.message}`);
    return null;
  }
}

/** Representação pública de uma mensagem (API e payload de evento). */
export interface PublicMessage {
  id: string;
  direction: string;
  channel: string;
  source: string;
  status: string;
  to: string;
  from: string | null;
  type: string;
  body: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  mediaUrl: string | null;
  numberId: string | null;
  providerMessageId: string | null;
  error: { code: string; message: string | null } | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

/**
 * Serializa para o formato público. Existe para que o shape exposto não seja
 * "o que o Prisma devolveu": campos internos (attempts, idempotencyKey,
 * sourceId, updatedAt) não vazam, e `error` vem como objeto com o código do
 * catálogo em vez de duas colunas soltas.
 */
export function toPublicMessage(row: any): PublicMessage {
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return {
    id:                row.id,
    direction:         row.direction,
    channel:           row.channel,
    source:            row.source,
    status:            row.status,
    to:                row.toPhone,
    from:              row.fromPhone ?? null,
    type:              row.type,
    body:              row.body ?? null,
    templateName:      row.templateName ?? null,
    templateLanguage:  row.templateLanguage ?? null,
    mediaUrl:          row.mediaUrl ?? null,
    numberId:          row.numberId ?? null,
    providerMessageId: row.providerMessageId ?? null,
    error:             row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? null } : null,
    queuedAt:          iso(row.queuedAt) as string,
    sentAt:            iso(row.sentAt),
    deliveredAt:       iso(row.deliveredAt),
    readAt:            iso(row.readAt),
    failedAt:          iso(row.failedAt),
  };
}

/**
 * Retenção do log. Chamado no sweep periódico da API.
 * MESSAGE_LOG_RETENTION_DAYS=0 desliga a purga (guarda para sempre).
 */
export async function purgeOldMessageLogs(): Promise<number> {
  const days = Number(process.env.MESSAGE_LOG_RETENTION_DAYS ?? 90);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const { count } = await prisma.messageLog.deleteMany({ where: { queuedAt: { lt: cutoff } } });
  if (count > 0) logger.info(`[MessageLog] ${count} linha(s) acima de ${days} dias purgada(s)`);
  return count;
}
