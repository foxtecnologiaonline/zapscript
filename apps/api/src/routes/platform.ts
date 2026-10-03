import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { resolveTeamScope } from '../lib/teamScope';
import { sendError } from '../lib/apiResponse';
import { errorDocUrl } from '../lib/apiErrors';
import { getPlatformMetrics, resolveWindow } from '../services/metrics';

/**
 * Leitura da plataforma no painel (itens 5, 6 e 7 do escopo ZapScript × Twilio).
 *
 * A API pública v1 já expõe o envio e o status por X-Api-Key. O que faltava era
 * o dono conseguir ver isso SEM ser cliente de API: quando um contato diz "não
 * recebi", a resposta estava espalhada entre a tela de campanhas, a de conversas
 * e nada. Aqui está em um lugar, com o CÓDIGO do erro, não só a frase do
 * provedor.
 *
 *   GET /platform/metrics             agregados do período (item 7)
 *   GET /platform/outbound            envios (OutboundMessage)
 *   GET /platform/inbound             recebidas (InboundMessage, item 5)
 *   GET /platform/webhook-deliveries  tentativas de entrega de evento
 *   GET /platform/error-codes         catálogo de códigos (item 6)
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function parseLimit(raw: string | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(1, parseInt(raw ?? '', 10) || DEFAULT_LIMIT));
}

/**
 * Paginação por cursor (keyset) e não por offset: `skip` cresce linearmente e a
 * página 200 de uma conta movimentada ficaria lenta. Pedimos limit+1 para saber
 * se há próxima página sem um COUNT(*) extra.
 */
async function paginate<T extends { id: string }>(
  model: any, args: { where: any; orderBy: any; limit: number; startingAfter?: string },
): Promise<{ rows: T[]; hasMore: boolean; nextCursor: string | null }> {
  const rows: T[] = await model.findMany({
    where:   args.where,
    orderBy: args.orderBy,
    take:    args.limit + 1,
    ...(args.startingAfter ? { cursor: { id: args.startingAfter }, skip: 1 } : {}),
  });
  const hasMore = rows.length > args.limit;
  const page = hasMore ? rows.slice(0, args.limit) : rows;
  return { rows: page, hasMore, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export default async function platformRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /metrics ──────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/metrics', auth,
    async (req: any, reply) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      let window;
      try {
        window = resolveWindow(req.query || {});
      } catch (err: any) {
        return sendError(reply, 'request.invalid', { message: err?.message });
      }
      return { metrics: await getPlatformMetrics(ownerId, window) };
    },
  );

  // ── GET /outbound ─────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/outbound', auth,
    async (req: any, reply) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      const q = req.query || {};

      if (q.status && !['queued', 'sent', 'failed'].includes(q.status)) {
        return sendError(reply, 'request.invalid', {
          message: `status inválido: "${q.status}".`,
          details: { allowed: ['queued', 'sent', 'failed'] },
        });
      }

      const where: Record<string, any> = { userId: ownerId };
      if (q.status)   where.status = q.status;
      if (q.numberId) where.numberId = q.numberId;
      if (q.to)       where.to = { contains: String(q.to).replace(/\D/g, '') };
      if (q.search)   where.body = { contains: String(q.search), mode: 'insensitive' };

      const { rows, hasMore, nextCursor } = await paginate<any>(prisma.outboundMessage, {
        where, orderBy: { createdAt: 'desc' },
        limit: parseLimit(q.limit), startingAfter: q.startingAfter,
      });

      return {
        messages: rows.map((m) => ({
          id: m.id, to: m.to, body: m.body, status: m.status, source: m.source,
          attempts: m.attempts, numberId: m.numberId,
          // Erro em duas camadas: `code` é estável e programável (item 6),
          // `reason` é a frase crua do provedor, útil para o suporte ler.
          error: m.errorCode || m.failureReason
            ? {
                code:   m.errorCode ?? null,
                reason: m.failureReason ?? null,
                docUrl: m.errorCode ? errorDocUrl(m.errorCode) : null,
              }
            : null,
          sentAt: m.sentAt, createdAt: m.createdAt,
        })),
        hasMore, nextCursor,
      };
    },
  );

  // ── GET /inbound ──────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/inbound', auth,
    async (req: any) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      const q = req.query || {};

      const where: Record<string, any> = { userId: ownerId };
      if (q.numberId) where.numberId = q.numberId;
      if (q.channel)  where.channel = q.channel;
      if (q.type)     where.type = q.type;
      if (q.from)     where.from = { contains: String(q.from).replace(/\D/g, '') };
      if (q.search)   where.body = { contains: String(q.search), mode: 'insensitive' };

      const { rows, hasMore, nextCursor } = await paginate<any>(prisma.inboundMessage, {
        where, orderBy: { receivedAt: 'desc' },
        limit: parseLimit(q.limit), startingAfter: q.startingAfter,
      });

      return {
        messages: rows.map((m) => ({
          id: m.id, from: m.from, to: m.to, channel: m.channel, type: m.type,
          body: m.body, numberId: m.numberId, receivedAt: m.receivedAt,
        })),
        hasMore, nextCursor,
      };
    },
  );

  // ── GET /webhook-deliveries ───────────────────────────────────────────────
  // WebhookDelivery tem uma linha por TENTATIVA — é o que responde "o evento
  // saiu? que status minha URL devolveu?".
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/webhook-deliveries', auth,
    async (req: any) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      const q = req.query || {};

      const where: Record<string, any> = { userId: ownerId };
      if (q.event) where.event = q.event;
      if (q.success === 'true')  where.success = true;
      if (q.success === 'false') where.success = false;

      const { rows, hasMore, nextCursor } = await paginate<any>(prisma.webhookDelivery, {
        where, orderBy: { createdAt: 'desc' },
        limit: parseLimit(q.limit), startingAfter: q.startingAfter,
      });

      return {
        deliveries: rows.map((d) => ({
          id: d.id, event: d.event, url: d.url, success: d.success,
          httpStatus: d.httpStatus, attempt: d.attempt, error: d.error,
          createdAt: d.createdAt,
        })),
        hasMore, nextCursor,
      };
    },
  );

  // ── GET /error-codes — catálogo (item 6) ──────────────────────────────────
  // Serve para a tela explicar um código sem hardcodar a lista no front, e para
  // o integrador descobrir o que pode receber antes de encontrar na prática.
  app.get('/error-codes', auth, async () => {
    const { ERROR_CATALOG } = await import('../lib/apiErrors');
    return {
      errorCodes: Object.entries(ERROR_CATALOG).map(([code, spec]) => ({
        code,
        status:    (spec as any).status,
        message:   (spec as any).message,
        retryable: Boolean((spec as any).retryable),
        docUrl:    errorDocUrl(code),
      })),
    };
  });
}
