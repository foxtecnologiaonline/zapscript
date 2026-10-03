import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Métricas de plataforma (item 7 do escopo ZapScript × Twilio).
 *
 * Lê as tabelas que a API pública v1 de fato produz — OutboundMessage (saída),
 * InboundMessage (entrada) e WebhookDelivery (entrega de evento). Antes disto, o
 * que existia de "métrica" era contagem de campanha (sentCount) e de
 * transcrição: nada sobre falha por motivo, nada sobre saúde de webhook.
 *
 * Uma decisão que vale explicitar: **não existe taxa de entrega aqui**. O envio
 * da v1 sai pela Evolution, que confirma "aceitei para envio", não "o aparelho
 * recebeu" — `OutboundMessage.status` vai de `queued` a `sent` ou `failed` e
 * para aí. Publicar um `deliveryRate` calculado sobre isso seria apresentar
 * "aceito pelo provedor" como "entregue ao destinatário", que é justamente a
 * confusão que o item 7 existe para desfazer. Quando o envio por Cloud API
 * entrar na API pública (que tem recibo de entrega e leitura), a taxa entra com
 * ele.
 *
 * Tudo é agregado no banco (groupBy / date_trunc), nunca carregando linhas para
 * somar em memória: um cliente com 200 mil mensagens no período derrubaria o
 * processo.
 */

export type Granularity = 'hour' | 'day';

export interface MetricsWindow {
  since: Date;
  until: Date;
  granularity: Granularity;
  numberId?: string | null;
}

/** Janela padrão: últimos 7 dias, por dia. */
export function resolveWindow(raw: {
  since?: string; until?: string; granularity?: string; numberId?: string;
}): MetricsWindow {
  const until = raw.until ? new Date(raw.until) : new Date();
  const since = raw.since ? new Date(raw.since) : new Date(until.getTime() - 7 * 86_400_000);

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error('since/until precisam ser datas ISO 8601.');
  }
  if (since >= until) throw new Error('since precisa ser anterior a until.');

  // Teto de 92 dias: acima disso a série diária passa de 90 pontos e a query
  // varre índice demais para uma resposta que ninguém lê inteira.
  if (until.getTime() - since.getTime() > 92 * 86_400_000) {
    throw new Error('O período máximo é de 92 dias.');
  }

  const granularity: Granularity = raw.granularity === 'hour' ? 'hour' : 'day';
  if (granularity === 'hour' && until.getTime() - since.getTime() > 8 * 86_400_000) {
    throw new Error('Com granularity=hour o período máximo é de 8 dias.');
  }

  return { since, until, granularity, numberId: raw.numberId || null };
}

function outboundWhere(userId: string, w: MetricsWindow): Prisma.OutboundMessageWhereInput {
  return {
    userId,
    createdAt: { gte: w.since, lte: w.until },
    ...(w.numberId ? { numberId: w.numberId } : {}),
  };
}

async function groupCount<T extends string>(
  model: any, field: T, where: any,
): Promise<Record<string, number>> {
  const rows = await model.groupBy({ by: [field], where, _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows as any[]) out[String(r[field])] = r._count._all;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Saída
// ─────────────────────────────────────────────────────────────────────────────

export interface OutboundMetrics {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  /** Enviadas ÷ (enviadas + falhas). null quando não há base. */
  sentRate: number | null;
  failureRate: number | null;
  /** Falhas por CÓDIGO do catálogo — não pela frase do provedor. */
  topErrorCodes: Array<{ code: string; count: number }>;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 100 : null);

export async function getOutboundMetrics(userId: string, w: MetricsWindow): Promise<OutboundMetrics> {
  const where = outboundWhere(userId, w);

  const [byStatus, bySource, errorRows] = await Promise.all([
    groupCount(prisma.outboundMessage, 'status', where),
    groupCount(prisma.outboundMessage, 'source', where),
    prisma.outboundMessage.groupBy({
      by:      ['errorCode'],
      where:   { ...where, errorCode: { not: null } },
      _count:  { _all: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take:    10,
    }),
  ]);

  const sent   = byStatus.sent   ?? 0;
  const failed = byStatus.failed ?? 0;
  // `queued` fica fora da base: ainda vai ser tentada, contá-la como falha
  // mostraria uma taxa pior que a real a cada pico de volume.
  const terminal = sent + failed;

  return {
    total:         Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    bySource,
    sentRate:      pct(sent, terminal),
    failureRate:   pct(failed, terminal),
    topErrorCodes: (errorRows as any[]).map((r) => ({ code: String(r.errorCode), count: r._count._all })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entrada
// ─────────────────────────────────────────────────────────────────────────────

export interface InboundMetrics {
  total: number;
  byType: Record<string, number>;
  byChannel: Record<string, number>;
}

export async function getInboundMetrics(userId: string, w: MetricsWindow): Promise<InboundMetrics> {
  const where: Prisma.InboundMessageWhereInput = {
    userId,
    receivedAt: { gte: w.since, lte: w.until },
    ...(w.numberId ? { numberId: w.numberId } : {}),
  };
  const [byType, byChannel] = await Promise.all([
    groupCount(prisma.inboundMessage, 'type', where),
    groupCount(prisma.inboundMessage, 'channel', where),
  ]);
  return {
    total: Object.values(byType).reduce((a, b) => a + b, 0),
    byType,
    byChannel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Série temporal
// ─────────────────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  bucket: string;
  queued: number;
  sent: number;
  failed: number;
  received: number;
}

/**
 * Série por período. SQL cru porque o Prisma não expõe `date_trunc` no groupBy —
 * e fazer isso no Node exigiria trazer todas as linhas.
 *
 * `granularity` nunca vem do cliente direto para a query: resolveWindow já o
 * reduziu a 'hour' | 'day', e o literal é escolhido aqui dentro.
 *
 * Saída e entrada vêm em UMA query (FULL JOIN sobre o bucket) em vez de duas +
 * costura no Node: evita buraco quando um lado tem bucket que o outro não tem.
 */
export async function getMessageSeries(userId: string, w: MetricsWindow): Promise<SeriesPoint[]> {
  const trunc = w.granularity === 'hour' ? 'hour' : 'day';
  const numeroOut = w.numberId ? Prisma.sql`AND o."numberId" = ${w.numberId}` : Prisma.empty;
  const numeroIn  = w.numberId ? Prisma.sql`AND i."numberId" = ${w.numberId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    WITH saida AS (
      SELECT date_trunc(${trunc}, o."createdAt") AS bucket,
             COUNT(*) FILTER (WHERE o."status" = 'queued') AS queued,
             COUNT(*) FILTER (WHERE o."status" = 'sent')   AS sent,
             COUNT(*) FILTER (WHERE o."status" = 'failed') AS failed
        FROM "OutboundMessage" o
       WHERE o."userId" = ${userId}
         AND o."createdAt" >= ${w.since} AND o."createdAt" <= ${w.until}
         ${numeroOut}
       GROUP BY 1
    ),
    entrada AS (
      SELECT date_trunc(${trunc}, i."receivedAt") AS bucket, COUNT(*) AS received
        FROM "InboundMessage" i
       WHERE i."userId" = ${userId}
         AND i."receivedAt" >= ${w.since} AND i."receivedAt" <= ${w.until}
         ${numeroIn}
       GROUP BY 1
    )
    SELECT COALESCE(s.bucket, e.bucket) AS bucket,
           COALESCE(s.queued, 0)   AS queued,
           COALESCE(s.sent, 0)     AS sent,
           COALESCE(s.failed, 0)   AS failed,
           COALESCE(e.received, 0) AS received
      FROM saida s
      FULL OUTER JOIN entrada e ON e.bucket = s.bucket
     ORDER BY 1 ASC
  `);

  return rows.map((r) => ({
    bucket:   new Date(r.bucket).toISOString(),
    queued:   Number(r.queued ?? 0),
    sent:     Number(r.sent ?? 0),
    failed:   Number(r.failed ?? 0),
    received: Number(r.received ?? 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Webhooks
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookMetrics {
  /** WebhookDelivery tem uma linha por TENTATIVA — este é o total de tentativas. */
  attempts: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  byEvent: Record<string, number>;
  /** Distribuição dos status HTTP devolvidos pelo endpoint do cliente. */
  byHttpStatus: Record<string, number>;
}

export async function getWebhookMetrics(userId: string, w: MetricsWindow): Promise<WebhookMetrics> {
  const where: Prisma.WebhookDeliveryWhereInput = {
    userId,
    createdAt: { gte: w.since, lte: w.until },
  };

  const [bySuccess, byEvent, byHttp] = await Promise.all([
    groupCount(prisma.webhookDelivery, 'success', where),
    groupCount(prisma.webhookDelivery, 'event', where),
    prisma.webhookDelivery.groupBy({
      by:     ['httpStatus'],
      where:  { ...where, httpStatus: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const succeeded = bySuccess['true']  ?? 0;
  const failed    = bySuccess['false'] ?? 0;

  const byHttpStatus: Record<string, number> = {};
  for (const r of byHttp as any[]) byHttpStatus[String(r.httpStatus)] = r._count._all;

  return {
    attempts: succeeded + failed,
    succeeded,
    failed,
    successRate: pct(succeeded, succeeded + failed),
    byEvent,
    byHttpStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agregado
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformMetrics {
  period: { since: string; until: string; granularity: Granularity; numberId: string | null };
  outbound: OutboundMetrics;
  inbound: InboundMetrics;
  webhooks: WebhookMetrics;
  series: SeriesPoint[];
}

export async function getPlatformMetrics(userId: string, w: MetricsWindow): Promise<PlatformMetrics> {
  const [outbound, inbound, webhooks, series] = await Promise.all([
    getOutboundMetrics(userId, w),
    getInboundMetrics(userId, w),
    getWebhookMetrics(userId, w),
    getMessageSeries(userId, w),
  ]);
  return {
    period: {
      since:       w.since.toISOString(),
      until:       w.until.toISOString(),
      granularity: w.granularity,
      numberId:    w.numberId ?? null,
    },
    outbound, inbound, webhooks, series,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Exposição para operação (Prometheus)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Métricas GLOBAIS da plataforma no formato de exposição do Prometheus — para o
 * nosso lado (operação), não para o cliente. Agregadas, sem nenhum
 * identificador de usuário: cardinalidade de série por tenant explodiria o
 * Prometheus, e seria dado de cliente num sistema de observabilidade.
 */
export async function renderPrometheusMetrics(): Promise<string> {
  const since = new Date(Date.now() - 24 * 3_600_000);

  const [byStatus, byErrorCode, bySuccess, inbound, presas] = await Promise.all([
    prisma.outboundMessage.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.outboundMessage.groupBy({
      by: ['errorCode'],
      where: { createdAt: { gte: since }, errorCode: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take: 20,
    }),
    prisma.webhookDelivery.groupBy({ by: ['success'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.inboundMessage.groupBy({ by: ['channel'], where: { receivedAt: { gte: since } }, _count: { _all: true } }),
    // O sinal mais acionável do conjunto: envio aceito que não saiu em 10
    // minutos significa fila parada ou worker fora do ar.
    prisma.outboundMessage.count({
      where: { status: 'queued', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    }),
  ]);

  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines: string[] = [];

  lines.push('# HELP zapscript_outbound_24h Envios pela API pública nas últimas 24h, por status.');
  lines.push('# TYPE zapscript_outbound_24h gauge');
  for (const r of byStatus as any[]) {
    lines.push(`zapscript_outbound_24h{status="${esc(String(r.status))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_outbound_errors_24h Falhas de envio nas últimas 24h, por código do catálogo.');
  lines.push('# TYPE zapscript_outbound_errors_24h gauge');
  for (const r of byErrorCode as any[]) {
    lines.push(`zapscript_outbound_errors_24h{code="${esc(String(r.errorCode))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_inbound_24h Mensagens recebidas nas últimas 24h, por canal.');
  lines.push('# TYPE zapscript_inbound_24h gauge');
  for (const r of inbound as any[]) {
    lines.push(`zapscript_inbound_24h{channel="${esc(String(r.channel))}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_webhook_attempts_24h Tentativas de entrega de webhook nas últimas 24h.');
  lines.push('# TYPE zapscript_webhook_attempts_24h gauge');
  for (const r of bySuccess as any[]) {
    lines.push(`zapscript_webhook_attempts_24h{success="${r.success ? 'true' : 'false'}"} ${r._count._all}`);
  }

  lines.push('# HELP zapscript_outbound_stuck_queued Envios em queued há mais de 10 minutos.');
  lines.push('# TYPE zapscript_outbound_stuck_queued gauge');
  lines.push(`zapscript_outbound_stuck_queued ${presas}`);

  return lines.join('\n') + '\n';
}
