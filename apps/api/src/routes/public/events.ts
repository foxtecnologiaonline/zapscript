import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { requireApiKey } from '../../lib/apiKeyAuth';
import { ApiError } from '../../lib/apiErrors';
import { sendApiError } from '../../lib/httpErrors';
import { EVENT_TYPES, toEventEnvelope } from '../../services/events';

/**
 * Histórico de eventos (item 2 do escopo ZapScript × Twilio).
 *
 * Esta rota é o que torna o sistema de eventos confiável de verdade: se o
 * endpoint do cliente ficou fora do ar além das tentativas de entrega, ele
 * varre daqui o que perdeu, por tipo e por período, em vez de descobrir o
 * buraco por acidente.
 *
 *   GET /public/v1/events        → eventos paginados por cursor
 *   GET /public/v1/events/types  → catálogo de tipos (para montar a inscrição)
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export default async function publicEventsRoutes(app: FastifyInstance) {
  const rateLimit = { max: 120, timeWindow: '1 minute' };

  // ── GET /types — catálogo ──────────────────────────────────────────────────
  app.get(
    '/types',
    { preHandler: [requireApiKey(['events:read'])], config: { rateLimit } },
    async () => ({ data: EVENT_TYPES }),
  );

  // ── GET / — listagem ──────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/',
    { preHandler: [requireApiKey(['events:read'])], config: { rateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;
      const q = req.query || {};
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit ?? '', 10) || DEFAULT_LIMIT));

      const where: Record<string, any> = { userId };

      if (q.type) {
        // Aceita lista ("message.sent,message.failed") e prefixo ("message.").
        const types = String(q.type).split(',').map((t) => t.trim()).filter(Boolean);
        if (types.length === 1 && types[0].endsWith('.')) {
          where.type = { startsWith: types[0] };
        } else {
          where.type = { in: types };
        }
      }
      if (q.resourceId) where.resourceId = q.resourceId;

      if (q.since || q.until) {
        const parse = (raw: string | undefined, field: string) => {
          if (!raw) return undefined;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) {
            throw new ApiError('request.invalid', { message: `${field} precisa ser uma data ISO 8601.` });
          }
          return d;
        };
        try {
          const since = parse(q.since, 'since');
          const until = parse(q.until, 'until');
          where.createdAt = { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) };
        } catch (err) {
          if (err instanceof ApiError) return sendApiError(reply, err);
          throw err;
        }
      }

      const rows = await prisma.platformEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    limit + 1,
        ...(q.startingAfter ? { cursor: { id: q.startingAfter }, skip: 1 } : {}),
      }).catch((err: any) => {
        if (err?.code === 'P2025' || /Record.*not found/i.test(err?.message || '')) {
          throw new ApiError('request.invalid', { message: 'startingAfter não corresponde a nenhum evento.' });
        }
        throw err;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        data:       page.map(toEventEnvelope),
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    },
  );
}
