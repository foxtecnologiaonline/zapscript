import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { redis, webhooksQueue } from './queue';
import { encryptStr, decryptStr } from './encryption';

/**
 * Sistema de eventos de saída (item 2 do escopo ZapScript × Twilio).
 *
 * O que existia: UM webhook por usuário (WebhookConfig), sem seleção de tipos,
 * sem histórico e sem reentrega — se o endpoint do cliente estivesse fora do ar
 * naquele segundo, o evento sumia. Era, na prática, um "fire and forget" com
 * botão de teste.
 *
 * O que passa a existir:
 *   • PlatformEvent     — o fato fica GRAVADO, haja webhook ou não. O cliente
 *                         pode varrer GET /public/v1/events depois de uma queda
 *                         em vez de perder o que aconteceu.
 *   • WebhookEndpoint   — N endpoints, cada um assinando os tipos que quer.
 *   • WebhookDelivery   — uma linha por (evento, endpoint), com tentativas,
 *                         status HTTP e resposta do endpoint.
 *   • Fila 'webhooks'   — entrega com retry exponencial (6 tentativas, até ~8min)
 *                         e circuit breaker que desativa endpoint morto.
 *
 * Copiado byte a byte em apps/worker/src/services/events.ts. Logging só com
 * string (os dois loggers têm assinaturas diferentes) e import de fila por
 * `./queue` (ver o shim em apps/worker/src/services/queue.ts).
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Catálogo de eventos — API pública: não renomeie um tipo já publicado.
// ─────────────────────────────────────────────────────────────────────────────
export const EVENT_TYPES = [
  // Ciclo de vida de mensagem (o que quem vem do Twilio espera encontrar)
  'message.queued',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'message.received',
  // Produto
  'transcription.completed',
  'transcription.failed',
  'campaign.started',
  'campaign.completed',
  'conversation.escalated',
  'contact.opted_out',
] as const;

export type EventType = typeof EVENT_TYPES[number];

export function isKnownEventType(type: string): boolean {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * O endpoint assina `['*']` (tudo, inclusive tipos futuros) ou tipos exatos.
 * Também aceitamos prefixo com curinga (`message.*`) porque é o que todo
 * integrador tenta escrever na primeira vez.
 */
export function endpointSubscribes(events: string[], type: string): boolean {
  if (!events || events.length === 0) return false;
  for (const pattern of events) {
    if (pattern === '*' || pattern === type) return true;
    if (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

export interface EventEnvelope {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, any>;
}

export function toEventEnvelope(row: {
  id: string; type: string; createdAt: Date; data: any;
}): EventEnvelope {
  return {
    id:        row.id,
    type:      row.type,
    createdAt: new Date(row.createdAt).toISOString(),
    data:      (row.data ?? {}) as Record<string, any>,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Assinatura HMAC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Esquema v1: `t=<unix>,v1=<hmac_sha256("<t>.<body>")>`.
 *
 * O timestamp entra no HMAC de propósito: sem ele, quem capturou uma entrega
 * válida pode reenviá-la ao endpoint do cliente para sempre, com assinatura
 * boa. Com ele, o cliente recusa o que for antigo (recomendamos 5 min).
 */
export function signV1(secret: string, body: string, timestampSeconds?: number): string {
  const t = timestampSeconds ?? Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

/** Esquema legado (WebhookConfig antigo): `sha256=<hmac_sha256(body)>`. */
export function signLegacy(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function buildSignature(scheme: string, secret: string, body: string): string {
  return scheme === 'legacy' ? signLegacy(secret, body) : signV1(secret, body);
}

/** Segredo novo, em claro (mostrado 1x ao cliente) + a forma de persistir. */
export function generateWebhookSecret(): { secret: string; encrypted: string } {
  const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
  return { secret, encrypted: encryptStr(secret) };
}

export function revealWebhookSecret(encrypted: string): string {
  return decryptStr(encrypted);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Emissão
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Migração preguiçosa do WebhookConfig antigo para WebhookEndpoint.
 *
 * Quem já tinha webhook configurado não pode parar de receber porque o sistema
 * novo entrou. O endpoint migrado nasce com `signatureScheme='legacy'`, isto é,
 * com o MESMO formato de assinatura (`sha256=<hmac(body)>`) que a integração
 * do cliente já valida, e inscrito em tudo (`['*']`) — era o comportamento de
 * fato do config antigo.
 *
 * Há no máximo um endpoint legado por usuário: as rotas de /webhook-config
 * atualizam esse mesmo registro (ver routes/webhook-config.ts).
 */
export async function ensureLegacyEndpointMigrated(userId: string): Promise<void> {
  const config = await prisma.webhookConfig.findUnique({ where: { userId } }).catch(() => null);
  if (!config || !config.active) return;

  const existing = await prisma.webhookEndpoint.findFirst({
    where: { userId, signatureScheme: 'legacy' },
  }).catch(() => null);
  if (existing) return;

  await prisma.webhookEndpoint.create({
    data: {
      userId,
      url:             config.url,
      // Reaproveita o segredo JÁ criptografado — regerar quebraria a validação
      // que o cliente tem em produção hoje.
      secret:          config.secret,
      description:     'Webhook configurado no painel (formato legado)',
      events:          ['*'],
      active:          true,
      signatureScheme: 'legacy',
    },
  }).then(() => {
    logger.info(`[Events] WebhookConfig legado migrado para endpoint — usuário ${userId}`);
  }).catch((err: any) => {
    logger.warn(`[Events] falha ao migrar WebhookConfig legado (${userId}): ${err?.message}`);
  });
}

/**
 * TTL do cache de "este usuário tem endpoint ativo?". Curto porque é a
 * diferença entre receber e não receber eventos logo depois de configurar o
 * primeiro webhook.
 */
const ENDPOINT_PRESENCE_TTL = 60;

/**
 * Existe alguém escutando os eventos deste usuário?
 *
 * Por que isto importa: campanha de 10 mil contatos geraria 10 mil
 * PlatformEvent + entregas. Para quem nunca configurou webhook, essas linhas
 * não serviriam a ninguém — o que aconteceu já está no MessageLog, que é a
 * fonte de verdade da mensagem. Então só gravamos evento quando há endpoint
 * ativo (ou o WebhookConfig legado, que vira endpoint na primeira emissão).
 *
 * Cacheado por 60s em Redis: senão seria uma query por mensagem enviada.
 */
async function hasActiveListener(userId: string): Promise<boolean> {
  const key = `events:listener:${userId}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached === '1') return true;
  if (cached === '0') return false;

  const [endpoints, legacy] = await Promise.all([
    prisma.webhookEndpoint.count({ where: { userId, active: true } }).catch(() => 0),
    prisma.webhookConfig.count({ where: { userId, active: true } }).catch(() => 0),
  ]);
  const present = endpoints > 0 || legacy > 0;
  await redis.set(key, present ? '1' : '0', 'EX', ENDPOINT_PRESENCE_TTL).catch(() => null);
  return present;
}

/** Invalida o cache acima — chamado ao criar/alterar/remover endpoint. */
export async function invalidateListenerCache(userId: string): Promise<void> {
  await redis.del(`events:listener:${userId}`).catch(() => null);
}

export interface EmitEventArgs {
  userId: string;
  type: EventType | string;
  data: Record<string, any>;
  resourceId?: string | null;
}

/**
 * Grava o evento e enfileira a entrega para cada endpoint inscrito.
 *
 * NUNCA lança. É chamada de dentro do caminho de envio de mensagem: uma falha
 * ao registrar evento não pode transformar um envio bem-sucedido em erro para o
 * cliente. Em troca, toda falha aqui aparece no log com `[Events]`.
 *
 * Devolve o id do evento, ou null se nem o evento foi gravado.
 */
export async function emitEvent(args: EmitEventArgs): Promise<string | null> {
  try {
    if (!(await hasActiveListener(args.userId))) return null;

    const event = await prisma.platformEvent.create({
      data: {
        userId:     args.userId,
        type:       args.type,
        resourceId: args.resourceId ?? null,
        data:       args.data as any,
      },
    });

    await ensureLegacyEndpointMigrated(args.userId);

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId: args.userId, active: true },
    });
    const targets = endpoints.filter((e: any) => endpointSubscribes(e.events, args.type));

    if (targets.length === 0) return event.id;

    for (const endpoint of targets) {
      // A linha de entrega nasce antes do job: se o Redis estiver fora, o
      // cliente ainda vê em GET /webhook-endpoints/:id/deliveries que a
      // entrega existe e está pendente — em vez de nada.
      const delivery = await prisma.webhookDelivery.create({
        data: { endpointId: endpoint.id, eventId: event.id, status: 'pending' },
      }).catch((err: any) => {
        // P2002 = já existe entrega deste evento neste endpoint (emissão
        // duplicada). É exatamente o que a unique protege: não entregar 2x.
        if (err?.code !== 'P2002') {
          logger.warn(`[Events] falha ao criar entrega (${endpoint.id}): ${err?.message}`);
        }
        return null;
      });
      if (!delivery) continue;

      await webhooksQueue.add(
        'deliver',
        { deliveryId: delivery.id },
        { jobId: delivery.id }, // idempotente no Redis também
      ).catch((err: any) => {
        logger.warn(`[Events] falha ao enfileirar entrega ${delivery.id}: ${err?.message}`);
      });
    }

    return event.id;
  } catch (err: any) {
    logger.error(`[Events] emitEvent(${args.type}) falhou: ${err?.message}`);
    return null;
  }
}

/**
 * Retenção dos eventos e entregas. Chamado no sweep periódico da API.
 * EVENT_RETENTION_DAYS=0 desliga.
 */
export async function purgeOldEvents(): Promise<number> {
  const days = Number(process.env.EVENT_RETENTION_DAYS ?? 30);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  // WebhookDelivery tem FK com onDelete: Cascade para PlatformEvent — apagar o
  // evento leva as entregas, sem segundo deleteMany.
  const { count } = await prisma.platformEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count > 0) logger.info(`[Events] ${count} evento(s) acima de ${days} dias purgado(s)`);
  return count;
}
