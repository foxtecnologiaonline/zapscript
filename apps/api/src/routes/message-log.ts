import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/apiErrors';
import { sendApiError } from '../lib/httpErrors';
import { resolveTeamScope } from '../lib/teamScope';
import { toPublicMessage } from '../services/message-log';
import { getPlatformMetrics, resolveWindow } from '../services/metrics';

/**
 * Log de mensagens e métricas no painel (itens 5 e 7 do escopo
 * ZapScript × Twilio).
 *
 * Mesma fonte de dados da API pública (MessageLog), autenticada por JWT de
 * sessão em vez de X-Api-Key. Existe porque "ver o que saiu" não pode exigir
 * ser cliente de API: hoje, quando um contato diz que não recebeu, o dono
 * precisa adivinhar entre a tela de campanhas, a de conversas e nada.
 *
 *   GET /messages            log paginado
 *   GET /messages/metrics    agregados do período
 *   GET /messages/:id        uma mensagem
 */

const MAX_LIMIT = 100;

export default async function messageLogRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /metrics — precisa vir antes de /:id (rota estática ganha do param,
  // mas deixar explícito evita surpresa em refactor) ────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/metrics',
    auth,
    async (req: any, reply) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      let window;
      try {
        window = resolveWindow(req.query || {});
      } catch (err: any) {
        return sendApiError(reply, 'request.invalid', { message: err?.message });
      }
      return { metrics: await getPlatformMetrics(ownerId, window) };
    },
  );

  // ── GET / — log ───────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>('/', auth, async (req: any) => {
    const { ownerId } = await resolveTeamScope(req.user.sub);
    const q = req.query || {};
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit ?? '', 10) || 25));

    const where: Record<string, any> = { userId: ownerId };
    if (q.status)    where.status    = q.status;
    if (q.direction) where.direction = q.direction;
    if (q.numberId)  where.numberId  = q.numberId;
    if (q.source)    where.source    = q.source;
    if (q.to)        where.toPhone   = { contains: String(q.to).replace(/\D/g, '') };
    // `search` cobre o caso real do suporte: "acha a mensagem que falava X".
    if (q.search)    where.body      = { contains: String(q.search), mode: 'insensitive' };

    const rows = await prisma.messageLog.findMany({
      where,
      orderBy: { queuedAt: 'desc' },
      take:    limit + 1,
      ...(q.startingAfter ? { cursor: { id: q.startingAfter }, skip: 1 } : {}),
    }).catch((err: any) => {
      if (err?.code === 'P2025') {
        throw new ApiError('request.invalid', { message: 'startingAfter inválido.' });
      }
      throw err;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      messages:   page.map(toPublicMessage),
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const { ownerId } = await resolveTeamScope(req.user.sub);
    const row = await prisma.messageLog.findFirst({
      where: { id: req.params.id, userId: ownerId },
    });
    if (!row) return sendApiError(reply, 'message.not_found');
    return { message: toPublicMessage(row) };
  });
}
