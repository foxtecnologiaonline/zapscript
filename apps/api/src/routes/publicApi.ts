import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireApiKey } from '../lib/apiKeyAuth';

/**
 * API pública ZapScript 2.0 (tier Empresas) — leitura, para integrar com
 * Zapier/Make/etc. Autenticação por header `X-Api-Key` (ver lib/apiKeyAuth.ts),
 * não pelo JWT de sessão do dashboard.
 *
 * v1: só leitura, sem paginação por cursor (limit fixo, documentado). Cada
 * chave só enxerga os dados do usuário que a criou (sempre o dono do tier
 * Empresas — nunca um membro de time, ver routes/apiKeys.ts).
 */
export default async function publicApiRoutes(app: FastifyInstance) {
  const rateLimit = { max: 60, timeWindow: '1 minute' };

  // ── GET /public/v1/me — checagem de conexão (útil para Zapier "Test") ──
  app.get('/me', { preHandler: [requireApiKey([])], config: { rateLimit } }, async () => {
    return { ok: true };
  });

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
