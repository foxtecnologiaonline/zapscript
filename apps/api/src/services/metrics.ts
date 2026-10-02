import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Métricas de plataforma (item 7 do escopo ZapScript × Twilio).
 *
 * Fica por último no escopo por dependência: só faz sentido depois que a API
 * de escrita (item 1), os eventos (item 2) e o log de mensagens (item 5)
 * começaram a produzir dado. Antes disso, o que existia de "métrica" era
 * contagem de campanha (sentCount) e de transcrição — nada sobre entrega,
 * nada sobre erro por motivo, nada sobre saúde de webhook.
 *
 * Tudo é agregado no banco (groupBy / date_trunc), nunca carregando linhas
 * para somar em memória: um cliente com 200 mil mensagens no período derrubaria
 * o processo.
 */

export type Granularity = 'hour' | 'day';

export interface MetricsWindow {
  since: Date;
  until: Date;
  granularity: Granularity;
  numberId?: string | null;
}

/** Janela padrão: últimos 7 dias por dia. */
export function resolveWindow(raw: {
  since?: string; until?: string; granularity?: string; numberId?: string;
}): MetricsWindow {
  const until = raw.until ? new Date(raw.until) : new Date();
  const since = raw.since
    ? new Date(raw.since)
    : new Date(until.getTime() - 7 * 86_400_000);

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error('since/until precisam ser datas ISO 8601.');
  }
  if (since >= until) throw new Error('since precisa ser anterior a until.');

  // Teto de 92 dias: acima disso a série diária passa de 90 pontos e a query
  // começa a varrer índice demais para uma resposta que ninguém lê inteira.
  if (until.getTime() - since.getTime() > 92 * 86_400_000) {
    throw new Error('O período máximo é de 92 dias.');
  }

  const granularity: Granularity = raw.granularity === 'hour' ? 'hour' : 'day';
  if (granularity === 'hour' && until.getTime() - since.getTime() > 8 * 86_400_000) {
    throw new Error('Com granularity=hour o período máximo é de 8 dias.');
  }

  return { since, until, granularity, numberId: raw.numberId || null };
}

function messageWhere(userId: string, w: MetricsWindow): Prisma.MessageLogWhereInput {
  return {
    userId,
    queuedAt: { gte: w.since, lte: w.until },
    ...(w.numberId ? { numberId: w.numberId } : {}),
  };
}

async function countBy(
  userId: string, w: MetricsWindow, field: 'status' | 'direction' | 'channel' | 'source',
): Promise<Record<string, number>> {
  const rows = await prisma.messageLog.groupBy({
    by:     [field] as any,
    where:  messageWhere(userId, w),
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows as any[]) out[String(r[field])] = r._count._all;
  return out;
}

export interface SeriesPoint {
  bucket: string;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  received: number;
}

/**
 * Série temporal por status. SQL cru porque o Prisma não expõe `date_trunc`
 * no groupBy — e fazer isso no Node exigiria trazer todas as linhas.
 *
 * `granularity` nunca vem do cliente direto para a query: `resolveWindow` já o
 * reduziu a 'hour' | 'day', e o literal é escolhido aqui dentro.
 */
export async function getMessageSeries(userId: string, w: MetricsWindow): Promise<SeriesPoint[]> {
  const trunc = w.granularity === 'hour' ? 'hour' : 'day';
  const numberFilter = w.numberId
    ? Prisma.sql`AND "numberId" = ${w.numberId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    SELECT
      date_trunc(${trunc}, "queuedAt") AS bucket,
      COUNT(*) FILTER (WHERE "status" = 'queued')    AS queued,
      COUNT(*) FILTER (WHERE "status" = 'sent')      AS sent,
      COUNT(*) FILTER (WHERE "status" = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE "status" = 'read')      AS read,
      COUNT(*) FILTER (WHERE "status" = 'failed')    AS failed,
      COUNT(*) FILTER (WHERE "status" = 'received')  AS received
    FROM "MessageLog"
    WHERE "userId" = ${userId}
      AND "queuedAt" >= ${w.since}
      AND "queuedAt" <= ${w.until}
      ${numberFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  return rows.map((r) => ({
    bucket:    new Date(r.bucket).toISOString(),
    queued:    Number(r.queued ?? 0),
    sent:      Number(r.sent ?? 0),
    delivered: Number(r.delivered ?? 0),
    read:      Number(r.read ?? 0),
    failed:    Number(r.failed ?? 0),
    received:  Number(r.received ?? 0),
  }));
}

/** Erros mais frequentes, por CÓDIGO do catálogo — não por frase do provedor. */
export async function getTopErrorCodes(
  userId: string, w: MetricsWindow, limit = 10,
): Promise<Array<{ code: string; count: number }>> {
  const rows = await prisma.messageLog.groupBy({
    by:      ['errorCode'],
    where:   { ...messageWhere(userId, w), errorCode: { not: null } },
    _count:  { _all: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take:    limit,
  });
  return (rows as any[]).map((r) => ({ code: String(r.errorCode), count: r._count._all }));
}

export interface MessageMetrics {
  total: number;
  byStatus: Record<string, number>;
  byDirection: Record<string, number>;
  byChannel: Record<string, number>;
  bySource: Record<string, number>;
  /** Entregues ÷ saídas que chegaram ao provedor. null quando não há base. */
  deliveryRate: number | null;
  failureRate: number | null;
  readRate: number | null;
  series: SeriesPoint[];
  topErrorCodes: Array<{ code: string; count: number }>;
}

export async function getMessageMetrics(userId: string, w: MetricsWindow): Promise<MessageMetrics> {
  const [byStatus, byDirection, byChannel, bySource, series, topErrorCodes] = await Promise.all([
    countBy(userId, w, 'status'),
    countBy(userId, w, 'direction'),
    countBy(userId, w, 'channel'),
    countBy(userId, w, 'source'),
    getMessageSeries(userId, w),
    getTopErrorCodes(userId, w),
  ]);

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const sent      = byStatus.sent      ?? 0;
  const delivered = byStatus.delivered ?? 0;
  const read      = byStatus.read      ?? 0;
  const failed    = byStatus.failed    ?? 0;

  // Status é o ESTADO ATUAL, não um acumulado: uma mensagem lida conta só em
  // `read`. Então "chegou ao provedor" = sent + delivered + read + failed, e
  // "foi entregue" = delivered + read (quem leu, recebeu).
  const outboundTerminal = sent + delivered + read + failed;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 100 : null);

  return {
    total,
    byStatus,
    byDirection,
    byChannel,
    bySource,
    deliveryRate: pct(delivered + read, outboundTerminal),
    failureRate:  pct(failed, outboundTerminal),
    readRate:     pct(read, delivered + read),
    series,
    topErrorCodes,
  };
}

export interface WebhookMetrics {
  endpoints: { total: number; active: number; disabled: number };
  deliveries: { total: number; succeeded: number; failed: number; pending: number };
  successRate: number | null;
}

export async function getWebhookMetrics(userId: string, w: MetricsWindow): Promise<WebhookMetrics> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where:  { userId },
    select: { id: true, active: true },
  });
  const ids = endpoints.map((e) => e.id);

  const byStatus = ids.length === 0 ? [] : await prisma.webhookDelivery.groupBy({
    by:     ['status'],
    where:  { endpointId: { in: ids }, createdAt: { gte: w.since, lte: w.until } },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const r of byStatus as any[]) counts[String(r.status)] = r._count._all;

  const succeeded = counts.succeeded ?? 0;
  const failed    = counts.failed ?? 0;
  const pending   = counts.pending ?? 0;
  const total     = succeeded + failed + pending;

  return {
    endpoints: {
      total:    endpoints.length,
      active:   endpoints.filter((e) => e.active).length,
      disabled: endpoints.filter((e) => !e.active).length,
    },
    deliveries: { total, succeeded, failed, pending },
    // Pendentes ficam fora da base: ainda vão ser tentadas, contá-las como
    // falha mostraria uma taxa pior que a realidade a cada pico de volume.
    successRate: succeeded + failed > 0
      ? Math.round((succeeded / (succeeded + failed)) * 10_000) / 100
      : null,
  };
}

export interface EventMetrics {
  total: number;
  byType: Record<string, number>;
}

export async function getEventMetrics(userId: string, w: MetricsWindow): Promise<EventMetrics> {
  const rows = await prisma.platformEvent.groupBy({
    by:     ['type'],
    where:  { userId, createdAt: { gte: w.since, lte: w.until } },
    _count: { _all: true },
  });
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of rows as any[]) {
    byType[String(r.type)] = r._count._all;
    total += r._count._all;
  }
  return { total, byType };
}

export interface PlatformMetrics {
  period: { since: string; until: string; granularity: Granularity; numberId: string | null };
  messages: MessageMetrics;
  webhooks: WebhookMetrics;
  events: EventMetrics;
}

export async function getPlatformMetrics(userId: string, w: MetricsWindow): Promise<PlatformMetrics> {
  const [messages, webhooks, events] = await Promise.all([
    getMessageMetrics(userId, w),
    getWebhookMetrics(userId, w),
    getEventMetrics(userId, w),
  ]);
  return {
    period: {
      since:       w.since.toISOString(),
      until:       w.until.toISOString(),
      granularity: w.granularity,
      numberId:    w.numberId ?? null,
    },
    messages,
    webhooks,
    events,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Exposição para operação (Prometheus)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Métricas GLOBAIS da plataforma no formato de exposição do Prometheus — para
 * o nosso lado (dashboard de operação), não para o cliente. Agregadas por
 * status/canal, sem nenhum identificador de usuário: cardinalidade de série
 * por tenant explodiria o Prometheus, e seria dado de cliente num sistema de
 * observabilidade.
 */
export async function renderPrometheusMetrics(): Promise<string> {
  const since = new Date(Date.now() - 24 * 3_600_000);

  const [byStatus, byChannel, byErrorCode, deliveries, stuck] = await Promise.all([
    prisma.messageLog.groupBy({ by: ['status'],  where: { queuedAt: { gte: since } }, _count: { _all: true } }),
    prisma.messageLog.groupBy({ by: ['channel'], where: { queuedAt: { gte: since } }, _count: { _all: true } }),
    prisma.messageLog.groupBy({
      by: ['errorCode'],
      where: { queuedAt: { gte: since }, errorCode: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take: 20,
    }),
    prisma.webhookDelivery.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.messageLog.count({
      where: { status: 'queued', queuedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    }),
  ]);

  const lines: string[] = [];
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  lines.push('# HELP zapscript_messages_24h Mensagens nas últimas 24h, por status.');
  lines.push('# TYPE zapscript_messages_24h gauge');
  for (const r of byStatus as any[]) {
    lines.push(`zapscript_messages_24h{status="${esc(String(r.status))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_messages_by_channel_24h Mensagens nas últimas 24h, por canal.');
  lines.push('# TYPE zapscript_messages_by_channel_24h gauge');
  for (const r of byChannel as any[]) {
    lines.push(`zapscript_messages_by_channel_24h{channel="${esc(String(r.channel))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_message_errors_24h Falhas de mensagem nas últimas 24h, por código do catálogo.');
  lines.push('# TYPE zapscript_message_errors_24h gauge');
  for (const r of byErrorCode as any[]) {
    lines.push(`zapscript_message_errors_24h{code="${esc(String(r.errorCode))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_webhook_deliveries_24h Entregas de webhook nas últimas 24h, por status.');
  lines.push('# TYPE zapscript_webhook_deliveries_24h gauge');
  for (const r of deliveries as any[]) {
    lines.push(`zapscript_webhook_deliveries_24h{status="${esc(String(r.status))}"} ${r._count._all}`);
  }

  // O sinal mais acionável do conjunto: mensagem aceita que não saiu em 10min
  // significa fila parada ou worker fora do ar.
  lines.push('# HELP zapscript_messages_stuck_queued Mensagens em queued há mais de 10 minutos.');
  lines.push('# TYPE zapscript_messages_stuck_queued gauge');
  lines.push(`zapscript_messages_stuck_queued ${stuck}`);

  return lines.join('\n') + '\n';
}
