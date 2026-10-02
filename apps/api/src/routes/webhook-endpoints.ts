import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/apiErrors';
import { sendApiError } from '../lib/httpErrors';
import { isSafeWebhookUrl } from '../lib/url-safety';
import { resolveTeamScope, roleAtLeast } from '../lib/teamScope';
import {
  validateRequest, webhookEndpointCreateSchema, webhookEndpointUpdateSchema,
} from '../lib/validation';
import {
  EVENT_TYPES, generateWebhookSecret, revealWebhookSecret, isKnownEventType,
  invalidateListenerCache, toEventEnvelope,
} from '../services/events';
import { webhooksQueue } from '../services/queue';

/**
 * Endpoints de webhook no painel (item 2 do escopo ZapScript × Twilio).
 *
 * Substitui, sem apagar, a tela do WebhookConfig antigo (uma URL por conta,
 * sem seleção de eventos, sem histórico, sem reentrega). As rotas antigas
 * (/webhook-config) continuam de pé para quem já as usa — e o endpoint que
 * nasce daquela configuração aparece aqui com `signatureScheme: 'legacy'`.
 *
 * Criar/alterar/remover exige papel admin: um endpoint de webhook recebe
 * conteúdo de mensagem dos clientes do dono, então apontá-lo para outro lugar
 * é decisão de administração da conta, não de atendente.
 */

/** Teto de endpoints por conta. Cada evento é entregue a TODOS os inscritos. */
const MAX_ENDPOINTS = 10;

function publicEndpoint(row: any, opts: { secret?: string } = {}) {
  return {
    id:              row.id,
    url:             row.url,
    description:     row.description,
    events:          row.events,
    active:          row.active,
    signatureScheme: row.signatureScheme,
    health: {
      consecutiveFailures: row.consecutiveFailures,
      lastSuccessAt:       row.lastSuccessAt,
      lastFailureAt:       row.lastFailureAt,
      disabledAt:          row.disabledAt,
      disabledReason:      row.disabledReason,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Só na criação (e no reveal explícito): o segredo em claro não volta numa
    // listagem, igual a uma chave de API.
    ...(opts.secret ? { secret: opts.secret } : {}),
  };
}

export default async function webhookEndpointsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  /** Dono dos dados + exigência de papel para escrita. */
  async function scopeForWrite(userId: string) {
    const scope = await resolveTeamScope(userId);
    if (!roleAtLeast(scope.role, 'admin')) {
      throw new ApiError('auth.scope_missing', {
        message: 'Só admin ou dono da conta pode configurar webhooks.',
      });
    }
    return scope;
  }

  // ── GET /event-types — catálogo (para montar a tela de inscrição) ─────────
  app.get('/event-types', auth, async () => ({ eventTypes: EVENT_TYPES }));

  // ── GET / — lista endpoints ───────────────────────────────────────────────
  app.get('/', auth, async (req: any) => {
    const { ownerId } = await resolveTeamScope(req.user.sub);
    const rows = await prisma.webhookEndpoint.findMany({
      where:   { userId: ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return { endpoints: rows.map((r: any) => publicEndpoint(r)) };
  });

  // ── POST / — cria endpoint ────────────────────────────────────────────────
  app.post<{ Body: unknown }>(
    '/',
    { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      let ownerId: string;
      try {
        ({ ownerId } = await scopeForWrite(req.user.sub));
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, err);
        throw err;
      }

      const v = validateRequest(webhookEndpointCreateSchema)(req.body);
      if (!v.valid) return sendApiError(reply, 'request.invalid', { message: v.error });
      const input = v.data as { url: string; description?: string; events: string[] };

      const unknown = input.events.filter((e) => e !== '*' && !e.endsWith('.*') && !isKnownEventType(e));
      if (unknown.length > 0) {
        return sendApiError(reply, 'webhook.event_unknown', {
          message: `Tipo(s) de evento desconhecido(s): ${unknown.join(', ')}.`,
          details: { unknown, allowed: EVENT_TYPES },
        });
      }

      const safe = await isSafeWebhookUrl(input.url);
      if (!safe.ok) {
        return sendApiError(reply, 'webhook.url_blocked', { message: safe.error });
      }

      const count = await prisma.webhookEndpoint.count({ where: { userId: ownerId } });
      if (count >= MAX_ENDPOINTS) {
        return sendApiError(reply, 'webhook.limit_reached', {
          message: `Limite de ${MAX_ENDPOINTS} endpoints por conta atingido.`,
        });
      }

      const { secret, encrypted } = generateWebhookSecret();
      const row = await prisma.webhookEndpoint.create({
        data: {
          userId:          ownerId,
          url:             input.url,
          description:     input.description ?? null,
          events:          input.events,
          secret:          encrypted,
          signatureScheme: 'v1',
        },
      });
      await invalidateListenerCache(ownerId);

      return reply.code(201).send({ endpoint: publicEndpoint(row, { secret }) });
    },
  );

  // ── PATCH /:id — altera endpoint ──────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: unknown }>('/:id', auth, async (req: any, reply) => {
    let ownerId: string;
    try {
      ({ ownerId } = await scopeForWrite(req.user.sub));
    } catch (err) {
      if (err instanceof ApiError) return sendApiError(reply, err);
      throw err;
    }

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });
    if (!existing) return sendApiError(reply, 'webhook.endpoint_not_found');

    const v = validateRequest(webhookEndpointUpdateSchema)(req.body);
    if (!v.valid) return sendApiError(reply, 'request.invalid', { message: v.error });
    const input = v.data as {
      url?: string; description?: string | null; events?: string[]; active?: boolean;
    };

    if (input.events) {
      const unknown = input.events.filter((e) => e !== '*' && !e.endsWith('.*') && !isKnownEventType(e));
      if (unknown.length > 0) {
        return sendApiError(reply, 'webhook.event_unknown', {
          message: `Tipo(s) de evento desconhecido(s): ${unknown.join(', ')}.`,
          details: { unknown, allowed: EVENT_TYPES },
        });
      }
    }
    if (input.url) {
      const safe = await isSafeWebhookUrl(input.url);
      if (!safe.ok) return sendApiError(reply, 'webhook.url_blocked', { message: safe.error });
    }

    const row = await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: {
        ...(input.url         !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.events      !== undefined ? { events: input.events } : {}),
        // Reativar limpa o circuit breaker: sem isso, um endpoint desativado
        // por 15 falhas voltaria já a uma falha de ser desligado de novo.
        ...(input.active      !== undefined
          ? input.active
            ? { active: true, consecutiveFailures: 0, disabledAt: null, disabledReason: null }
            : { active: false, disabledAt: new Date(), disabledReason: 'Desativado no painel' }
          : {}),
      },
    });
    await invalidateListenerCache(ownerId);

    return { endpoint: publicEndpoint(row) };
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    let ownerId: string;
    try {
      ({ ownerId } = await scopeForWrite(req.user.sub));
    } catch (err) {
      if (err instanceof ApiError) return sendApiError(reply, err);
      throw err;
    }

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });
    if (!existing) return sendApiError(reply, 'webhook.endpoint_not_found');

    await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
    await invalidateListenerCache(ownerId);
    return { ok: true };
  });

  // ── GET /:id/secret — revela o segredo (para reconfigurar a validação) ────
  app.get<{ Params: { id: string } }>('/:id/secret', auth, async (req: any, reply) => {
    let ownerId: string;
    try {
      ({ ownerId } = await scopeForWrite(req.user.sub));
    } catch (err) {
      if (err instanceof ApiError) return sendApiError(reply, err);
      throw err;
    }

    const row = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });
    if (!row) return sendApiError(reply, 'webhook.endpoint_not_found');

    try {
      return { secret: revealWebhookSecret(row.secret) };
    } catch {
      return sendApiError(reply, 'internal.error', {
        message: 'Não foi possível ler o segredo deste endpoint. Crie um endpoint novo.',
      });
    }
  });

  // ── GET /:id/deliveries — histórico de entregas ───────────────────────────
  app.get<{ Params: { id: string }; Querystring: { limit?: string; status?: string } }>(
    '/:id/deliveries',
    auth,
    async (req: any, reply) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id: req.params.id, userId: ownerId },
      });
      if (!endpoint) return sendApiError(reply, 'webhook.endpoint_not_found');

      const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 25));
      const status = req.query?.status;
      if (status && !['pending', 'succeeded', 'failed'].includes(status)) {
        return sendApiError(reply, 'request.invalid', {
          message: `status inválido: "${status}".`,
          details: { allowed: ['pending', 'succeeded', 'failed'] },
        });
      }

      const rows = await prisma.webhookDelivery.findMany({
        where:   { endpointId: endpoint.id, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take:    limit,
        include: { event: true },
      });

      return {
        deliveries: rows.map((d: any) => ({
          id:             d.id,
          status:         d.status,
          attempts:       d.attempts,
          responseStatus: d.responseStatus,
          responseBody:   d.responseBody,
          error:          d.errorCode ? { code: d.errorCode, message: d.errorMessage } : null,
          nextRetryAt:    d.nextRetryAt,
          deliveredAt:    d.deliveredAt,
          createdAt:      d.createdAt,
          event:          toEventEnvelope(d.event),
        })),
      };
    },
  );

  // ── POST /:id/deliveries/:deliveryId/retry — reentrega manual ─────────────
  app.post<{ Params: { id: string; deliveryId: string } }>(
    '/:id/deliveries/:deliveryId/retry',
    { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      let ownerId: string;
      try {
        ({ ownerId } = await scopeForWrite(req.user.sub));
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, err);
        throw err;
      }

      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id: req.params.id, userId: ownerId },
      });
      if (!endpoint) return sendApiError(reply, 'webhook.endpoint_not_found');

      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: req.params.deliveryId, endpointId: endpoint.id },
      });
      if (!delivery) return sendApiError(reply, 'request.not_found', { message: 'Entrega não encontrada.' });
      if (delivery.status === 'succeeded') {
        return sendApiError(reply, 'request.conflict', {
          message: 'Esta entrega já foi concluída com sucesso.',
        });
      }

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data:  { status: 'pending', nextRetryAt: null, errorCode: null, errorMessage: null },
      });

      // jobId distinto do original (que já foi consumido) — sem isso o BullMQ
      // trataria a reentrega como duplicata e ela nunca rodaria.
      await webhooksQueue.add(
        'deliver',
        { deliveryId: delivery.id },
        { jobId: `retry:${delivery.id}:${Date.now()}` },
      );

      return { ok: true, deliveryId: delivery.id };
    },
  );
}
