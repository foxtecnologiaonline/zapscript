import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireApiKey } from '../lib/apiKeyAuth';
import { getUserPlan } from '../lib/planGate';
import { validateRequest, publicSendMessageSchema } from '../lib/validation';
import { sendOutboundMessage, serializeOutboundMessage } from '../services/outbound-message';
import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENTS, WebhookEvent } from '../lib/webhook-events';
import { isSafeWebhookUrl } from '../lib/webhook-url-guard';
import { encryptStr, decryptStr } from '../services/encryption';
import crypto from 'crypto';

/**
 * API pública ZapScript v1 — autenticação por header `X-Api-Key`
 * (ver lib/apiKeyAuth.ts), nunca pelo JWT de sessão do dashboard.
 *
 * Desenhada para integração servidor-a-servidor, no mesmo espírito da API da
 * Twilio: um recurso `messages` com id durável e status consultável, webhooks
 * assinados para os eventos de entrada, e escopos por chave. Cada chave só
 * enxerga/age sobre os dados do usuário que a criou.
 *
 * Fluxo completo de uma integração (ex.: confirmação de consulta):
 *   1. POST /public/v1/webhooks      → assina 'message.received', guarda o secret
 *   2. POST /public/v1/messages      → manda "Confirma sua consulta? SIM/NÃO"
 *   3. recebe 'message.received'     → valida HMAC, casa pelo telefone
 *   4. GET  /public/v1/messages/:id  → (opcional) confere a entrega
 */
export default async function publicApiRoutes(app: FastifyInstance) {
  const rateLimit = { max: 60, timeWindow: '1 minute' };
  // Envio tem limite próprio e mais baixo que leitura: cada chamada vira uma
  // mensagem de WhatsApp de verdade para uma pessoa de verdade, e um laço
  // acidental no integrador viraria spam em nome do cliente (e risco de ban
  // do número na Meta, que é dano irreversível).
  const sendRateLimit = { max: 30, timeWindow: '1 minute' };

  /** Só dígitos — aceita "+55 11 99999-9999" e devolve "5511999999999". */
  function normalizePhone(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  // ── GET /public/v1/me — checagem de conexão (útil para Zapier "Test") ──
  app.get('/me', { preHandler: [requireApiKey([])], config: { rateLimit } }, async (req: any) => {
    const userId = req.apiKeyUserId;
    // Devolve escopos e eventos disponíveis: o integrador descobre sozinho o
    // que a chave dele pode fazer, em vez de descobrir por 403 em produção.
    const [plan, webhook] = await Promise.all([
      getUserPlan(userId),
      (prisma as any).webhookConfig.findUnique({
        where:  { userId },
        select: { url: true, events: true, active: true },
      }),
    ]);
    return {
      ok:     true,
      plan,
      scopes: req.apiKeyScopes ?? [],
      webhook: webhook
        ? { url: webhook.url, active: webhook.active, events: webhook.events ?? [] }
        : null,
      availableEvents: ALL_WEBHOOK_EVENTS,
    };
  });

  // ── GET /public/v1/numbers — números disponíveis para envio ──────────────
  // O integrador precisa de um `numberId` para mandar mensagem; sem este
  // endpoint ele teria que pegar o id na mão no dashboard.
  app.get(
    '/numbers',
    { preHandler: [requireApiKey(['messages:send'])], config: { rateLimit } },
    async (req: any) => {
      const numbers = await prisma.whatsappNumber.findMany({
        where:   { userId: req.apiKeyUserId },
        orderBy: { createdAt: 'asc' },
        select:  { id: true, phoneNumber: true, status: true, zapiInstanceId: true, createdAt: true },
      });
      return {
        data: numbers.map((n) => ({
          id:          n.id,
          phoneNumber: n.phoneNumber,
          status:      n.status,
          // Não expõe o id da instância da Evolution (detalhe interno de infra),
          // só se está conectado o suficiente para enviar.
          connected:   !!n.zapiInstanceId,
          createdAt:   n.createdAt,
        })),
      };
    }
  );

  // ── POST /public/v1/messages — enviar mensagem ────────────────────────────
  app.post<{ Body: any }>(
    '/messages',
    { preHandler: [requireApiKey(['messages:send'])], config: { rateLimit: sendRateLimit } },
    async (req: any, reply) => {
      const v = validateRequest(publicSendMessageSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const to = normalizePhone(v.data.to);
      if (to.length < 10 || to.length > 15) {
        return reply.code(400).send({ error: 'to deve ter entre 10 e 15 dígitos (com DDI e DDD).' });
      }

      // Header `Idempotency-Key` também é aceito, além do campo no body — é
      // onde a maioria das APIs (Stripe, entre outras) coloca, então é onde o
      // integrador vai procurar primeiro.
      const headerKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

      const result = await sendOutboundMessage({
        userId:         req.apiKeyUserId,
        numberId:       v.data.numberId,
        to,
        body:           v.data.body,
        idempotencyKey: v.data.idempotencyKey ?? headerKey ?? null,
        source:         'public_api',
      });

      if (result.kind === 'error') {
        return reply.code(result.code).send({ error: result.error });
      }
      // 200 (não 201) no replay: nada foi criado nesta chamada.
      return reply
        .code(result.kind === 'replayed' ? 200 : 201)
        .send(serializeOutboundMessage(result.message));
    }
  );

  // ── GET /public/v1/messages/:id — status de um envio ──────────────────────
  app.get<{ Params: { id: string } }>(
    '/messages/:id',
    { preHandler: [requireApiKey(['messages:read'])], config: { rateLimit } },
    async (req: any, reply) => {
      const message = await (prisma as any).outboundMessage.findFirst({
        where: { id: req.params.id, userId: req.apiKeyUserId },
      });
      if (!message) return reply.code(404).send({ error: 'Mensagem não encontrada.' });
      return serializeOutboundMessage(message);
    }
  );

  // ── GET /public/v1/messages — histórico de envios ─────────────────────────
  app.get<{ Querystring: { limit?: string; status?: string } }>(
    '/messages',
    { preHandler: [requireApiKey(['messages:read'])], config: { rateLimit } },
    async (req: any) => {
      const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 50));
      const status = req.query?.status;
      const messages = await (prisma as any).outboundMessage.findMany({
        where:   { userId: req.apiKeyUserId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take:    limit,
      });
      return { data: messages.map(serializeOutboundMessage) };
    }
  );

  // ── POST /public/v1/webhooks — assinar eventos ────────────────────────────
  // Equivalente ao /webhook-config do dashboard, mas autenticado por API key:
  // o integrador se configura sozinho, sem precisar de uma sessão de browser.
  app.post<{ Body: { url: string; events?: string[] } }>(
    '/webhooks',
    { preHandler: [requireApiKey(['webhooks:manage'])], config: { rateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId;
      const { url } = req.body ?? {};
      if (!url) return reply.code(400).send({ error: 'url é obrigatória.' });

      const safe = await isSafeWebhookUrl(url);
      if (!safe.ok) return reply.code(400).send({ error: safe.error });

      const rawEvents = req.body?.events;
      let events: WebhookEvent[];
      if (rawEvents === undefined) {
        events = [WEBHOOK_EVENTS.MESSAGE_RECEIVED];
      } else if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
        return reply.code(400).send({ error: 'events deve ser um array com ao menos 1 evento.' });
      } else {
        const unknown = rawEvents.filter((e: any) => !ALL_WEBHOOK_EVENTS.includes(e));
        if (unknown.length) {
          return reply.code(400).send({
            error: `Evento(s) desconhecido(s): ${unknown.join(', ')}. Válidos: ${ALL_WEBHOOK_EVENTS.join(', ')}.`,
          });
        }
        events = Array.from(new Set(rawEvents)) as WebhookEvent[];
      }

      const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
      if (existing) {
        const updated = await (prisma as any).webhookConfig.update({
          where: { userId },
          data:  { url, events, active: true, updatedAt: new Date() },
        });
        // O secret não muda num update — quem já o guardou continua validando.
        // Devolvido aqui porque esta chamada é autenticada por API key (o
        // integrador é o dono legítimo do secret) e evita que ele precise
        // abrir o dashboard só para recuperá-lo.
        return {
          id:     updated.id,
          url:    updated.url,
          events: updated.events,
          active: updated.active,
          secret: decryptStr(updated.secret),
        };
      }

      const rawSecret = crypto.randomBytes(32).toString('hex');
      const created = await (prisma as any).webhookConfig.create({
        data: { userId, url, secret: encryptStr(rawSecret), events, active: true },
      });
      return reply.code(201).send({
        id:     created.id,
        url:    created.url,
        events: created.events,
        active: created.active,
        secret: rawSecret,
      });
    }
  );

  // ── GET /public/v1/webhooks/deliveries — depuração de entregas ────────────
  app.get<{ Querystring: { limit?: string } }>(
    '/webhooks/deliveries',
    { preHandler: [requireApiKey(['webhooks:manage'])], config: { rateLimit } },
    async (req: any) => {
      const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 25));
      const deliveries = await (prisma as any).webhookDelivery.findMany({
        where:   { userId: req.apiKeyUserId },
        orderBy: { createdAt: 'desc' },
        take:    limit,
        select:  { id: true, event: true, url: true, success: true, httpStatus: true, attempt: true, error: true, createdAt: true },
      });
      return { data: deliveries };
    }
  );

  // ── GET /public/v1/conversations — conversas do Atende ──
  app.get<{ Querystring: { limit?: string } }>(
    '/conversations',
    { preHandler: [requireApiKey(['conversations:read'])], config: { rateLimit } },
    async (req: any) => {
      const userId = req.apiKeyUserId;
      const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 50));

      const conversations = await prisma.atendeConversation.findMany({
        where:   { userId },
        orderBy: { lastMessageAt: 'desc' },
        take:    limit,
        select: {
          id: true, contactPhone: true, contactName: true, status: true,
          humanTakeover: true, lastMessageAt: true, createdAt: true, numberId: true,
        },
      });
      return { data: conversations };
    }
  );

  // ── GET /public/v1/contacts — funil de CRM ──
  app.get<{ Querystring: { limit?: string } }>(
    '/contacts',
    { preHandler: [requireApiKey(['contacts:read'])], config: { rateLimit } },
    async (req: any) => {
      const userId = req.apiKeyUserId;
      const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 50));

      const contacts = await prisma.crmContact.findMany({
        where:   { userId },
        orderBy: { lastActivityAt: 'desc' },
        take:    limit,
        select: {
          id: true, name: true, phone: true, email: true, company: true, value: true,
          tags: true, stageId: true, source: true, lastActivityAt: true, closedAt: true, createdAt: true,
        },
      });
      return { data: contacts };
    }
  );
}
