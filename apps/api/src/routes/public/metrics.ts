import { FastifyInstance } from 'fastify';
import { requireApiKey } from '../../lib/apiKeyAuth';
import { sendApiError } from '../../lib/httpErrors';
import { getPlatformMetrics, resolveWindow } from '../../services/metrics';

/**
 * Métricas agregadas pela API pública (item 7 do escopo ZapScript × Twilio).
 *
 *   GET /public/v1/metrics?since=&until=&granularity=day|hour&numberId=
 *
 * Responde o que não dava para responder antes: quanto saiu, quanto foi
 * entregue, quanto falhou E POR QUÊ (por código do catálogo), e se os webhooks
 * do cliente estão sendo entregues.
 */
export default async function publicMetricsRoutes(app: FastifyInstance) {
  // Limite mais baixo que as leituras comuns: cada chamada faz várias
  // agregações no Postgres.
  const rateLimit = { max: 30, timeWindow: '1 minute' };

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/',
    { preHandler: [requireApiKey(['metrics:read'])], config: { rateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;

      let window;
      try {
        window = resolveWindow(req.query || {});
      } catch (err: any) {
        return sendApiError(reply, 'request.invalid', { message: err?.message });
      }

      const metrics = await getPlatformMetrics(userId, window);
      return { data: metrics };
    },
  );
}
