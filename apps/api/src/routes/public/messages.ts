import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { requireApiKey } from '../../lib/apiKeyAuth';
import { ApiError } from '../../lib/apiErrors';
import { sendApiError } from '../../lib/httpErrors';
import { withIdempotency } from '../../lib/idempotency';
import { validateRequest, sendMessageSchema, type SendMessageInput } from '../../lib/validation';
import { acceptOutboundMessage } from '../../services/outbound-send';
import { toPublicMessage } from '../../services/message-log';

/**
 * API pública de MENSAGENS — escrita (item 1) + log (item 5), com idempotência
 * (item 3) e códigos de erro do catálogo (item 6).
 *
 *   POST /public/v1/messages      → aceita o envio (202 queued)
 *   GET  /public/v1/messages      → log paginado por cursor
 *   GET  /public/v1/messages/:id  → uma mensagem
 *
 * Escopos separados: `messages:write` para enviar, `messages:read` para ler.
 */

/** Teto de página. Alto demais vira varredura de tabela por cliente. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'received'];

export default async function publicMessagesRoutes(app: FastifyInstance) {
  // Escrita tem limite próprio, mais apertado que a leitura: cada request vira
  // mensagem no WhatsApp de alguém. 60/min alinha com o teto de 10/s da Graph API.
  const writeRateLimit = { max: 60, timeWindow: '1 minute' };
  const readRateLimit  = { max: 120, timeWindow: '1 minute' };

  // ── POST / — envia (aceita e enfileira) ────────────────────────────────────
  app.post<{ Body: unknown }>(
    '/',
    { preHandler: [requireApiKey(['messages:write'])], config: { rateLimit: writeRateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;

      const v = validateRequest(sendMessageSchema)(req.body);
      if (!v.valid) {
        return sendApiError(reply, 'request.invalid', {
          message: v.error,
          details: { body: req.body },
        });
      }
      // `validateRequest` é tipado com z.ZodSchema<T> (entrada = saída), então o
      // TS não enxerga os defaults/transforms do schema. O cast firma o tipo de
      // SAÍDA, que é o que o zod devolve de fato (type já com default 'text',
      // `to` já só com dígitos).
      const input = v.data as SendMessageInput;

      try {
        const result = await withIdempotency({
          userId,
          scope:   'POST /public/v1/messages',
          headers: req.headers,
          // Hash sobre o corpo JÁ VALIDADO: assim `to` normalizado ("+55 11…"
          // e "5511…") gera a mesma chave automática, e um default aplicado
          // pelo schema não faz duas requisições idênticas parecerem distintas.
          payload: input,
          run: async ({ setResourceId }) => {
            const message = await acceptOutboundMessage({
              userId,
              input,
              source: 'api',
              idempotencyKey: (req.headers['idempotency-key'] as string) || null,
            });
            setResourceId(message.id);
            // 202: aceita, ainda não enviada — o status real vem do webhook
            // (message.sent/delivered/failed) ou de GET /messages/:id.
            return { statusCode: 202, body: { data: message } };
          },
        });

        if (result.replayed) reply.header('X-Idempotent-Replay', 'true');
        if (result.key) reply.header('X-Idempotency-Key', result.key);
        return reply.code(result.statusCode).send(result.body);
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, err);
        throw err;
      }
    },
  );

  // ── GET / — log de mensagens, paginado por cursor ─────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/',
    { preHandler: [requireApiKey(['messages:read'])], config: { rateLimit: readRateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;
      const q = req.query || {};

      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit ?? '', 10) || DEFAULT_LIMIT));

      if (q.status && !STATUSES.includes(q.status)) {
        return sendApiError(reply, 'request.invalid', {
          message: `status inválido: "${q.status}".`,
          details: { allowed: STATUSES },
        });
      }
      if (q.direction && !['inbound', 'outbound'].includes(q.direction)) {
        return sendApiError(reply, 'request.invalid', {
          message: `direction inválido: "${q.direction}".`,
          details: { allowed: ['inbound', 'outbound'] },
        });
      }

      const parseDate = (raw: string | undefined, field: string): Date | undefined => {
        if (!raw) return undefined;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          throw new ApiError('request.invalid', { message: `${field} precisa ser uma data ISO 8601.` });
        }
        return d;
      };

      let since: Date | undefined;
      let until: Date | undefined;
      try {
        since = parseDate(q.since, 'since');
        until = parseDate(q.until, 'until');
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, err);
        throw err;
      }

      const where: Record<string, any> = { userId };
      if (q.status)    where.status    = q.status;
      if (q.direction) where.direction = q.direction;
      if (q.numberId)  where.numberId  = q.numberId;
      if (q.source)    where.source    = q.source;
      if (q.to)        where.toPhone   = String(q.to).replace(/\D/g, '');
      if (since || until) {
        where.queuedAt = { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) };
      }

      // Cursor sobre o id (keyset): `skip` cresceria linearmente e a página 200
      // de um cliente grande ficaria lenta. Pedimos limit+1 para saber se há
      // mais página sem um COUNT(*) extra.
      const rows = await prisma.messageLog.findMany({
        where,
        orderBy: { queuedAt: 'desc' },
        take:    limit + 1,
        ...(q.startingAfter
          ? { cursor: { id: q.startingAfter }, skip: 1 }
          : {}),
      }).catch((err: any) => {
        // Cursor apontando para id inexistente: o Prisma devolve erro, não lista vazia.
        if (err?.code === 'P2025' || /Record.*not found/i.test(err?.message || '')) {
          throw new ApiError('request.invalid', { message: 'startingAfter não corresponde a nenhuma mensagem.' });
        }
        throw err;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        data:    page.map(toPublicMessage),
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    },
  );

  // ── GET /:id — uma mensagem ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireApiKey(['messages:read'])], config: { rateLimit: readRateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;
      const row = await prisma.messageLog.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!row) return sendApiError(reply, 'message.not_found');
      return { data: toPublicMessage(row) };
    },
  );
}
