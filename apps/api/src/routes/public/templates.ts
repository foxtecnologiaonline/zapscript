import { FastifyInstance } from 'fastify';
import { requireApiKey } from '../../lib/apiKeyAuth';
import { ApiError } from '../../lib/apiErrors';
import { sendApiError } from '../../lib/httpErrors';
import { resolveMetaNumber } from '../../services/meta-number';
import { listTemplates, toPublicTemplate } from '../../services/meta-templates';

/**
 * Templates pela API pública (item 4 do escopo ZapScript × Twilio).
 *
 * Só leitura por aqui, de propósito: criar template é um ato que passa por
 * análise da Meta e tem consequência na qualidade do número — mora no painel
 * (routes/templates.ts), onde o dono vê o formulário e o motivo de rejeição.
 * O que a API precisa é responder "que templates eu posso enviar, com quantas
 * variáveis e se exigem header de mídia" — que é exatamente o que falta para
 * montar um POST /messages correto na primeira tentativa.
 */
export default async function publicTemplatesRoutes(app: FastifyInstance) {
  const rateLimit = { max: 60, timeWindow: '1 minute' };

  app.get<{ Querystring: { numberId?: string; status?: string } }>(
    '/',
    { preHandler: [requireApiKey(['templates:read'])], config: { rateLimit } },
    async (req: any, reply) => {
      const userId = req.apiKeyUserId as string;
      try {
        const ctx = await resolveMetaNumber(userId, req.query?.numberId);
        const all = await listTemplates(ctx.accessToken, ctx.wabaId);

        // Sem filtro explícito devolve só APPROVED: é o único que pode ser
        // enviado, e é isso que o integrador quer listar.
        const wanted = (req.query?.status || 'APPROVED').toUpperCase();
        const filtered = wanted === 'ALL'
          ? all
          : all.filter((t) => t.status.toUpperCase() === wanted);

        return {
          data: filtered.map(toPublicTemplate),
          numberId: ctx.numberId,
        };
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, err);
        throw err;
      }
    },
  );
}
