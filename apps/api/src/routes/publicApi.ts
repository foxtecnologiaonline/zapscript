import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireApiKey } from '../lib/apiKeyAuth';
import { registerPublicErrorHandler } from '../lib/httpErrors';

/**
 * API pública ZapScript (tier Empresas). Autenticação por header `X-Api-Key`
 * (ver lib/apiKeyAuth.ts), não pelo JWT de sessão do dashboard. Cada chave só
 * enxerga os dados do usuário que a criou — sempre o dono do tier Empresas,
 * nunca um membro de time (ver routes/apiKeys.ts).
 *
 * Mudou com o escopo ZapScript × Twilio: era só leitura de conversas e
 * contatos. Agora é uma superfície de plataforma —
 *
 *   /messages            envio (item 1) + log (item 5), idempotente (item 3)
 *   /events              histórico de eventos de webhook (item 2)
 *   /templates           templates do WABA (item 4), com header de mídia (item 8)
 *   /metrics             métricas agregadas (item 7)
 *
 * …e todo erro sai no envelope com código estável do catálogo (item 6):
 * `{ error: { code, message, docUrl, retryable, requestId } }`. Antes era
 * `{ error: '<frase em português>' }`, impossível de programar contra.
 * Documentação do contrato: PLATAFORMA_API_PUBLICA.md
 */
export default async function publicApiRoutes(app: FastifyInstance) {
  // Vale só para este escopo do Fastify (prefixo /public/v1) — as rotas do
  // painel seguem com o formato de erro antigo, sem quebrar o front.
  registerPublicErrorHandler(app);

  const rateLimit = { max: 60, timeWindow: '1 minute' };

  // ── GET /public/v1/me — checagem de conexão (útil para Zapier "Test") ──
  app.get('/me', { preHandler: [requireApiKey([])], config: { rateLimit } }, async (req: any) => {
    const userId = req.apiKeyUserId as string;

    // Devolve o que o integrador precisa para se configurar sozinho: quais
    // escopos a chave tem e quais números existem (o `numberId` que ele vai
    // informar em POST /messages quando houver mais de um).
    const [key, numbers] = await Promise.all([
      prisma.apiKey.findUnique({
        where:  { id: req.apiKeyId as string },
        select: { name: true, keyPrefix: true, scopes: true, createdAt: true },
      }),
      prisma.whatsappNumber.findMany({
        where:   { userId },
        orderBy: { createdAt: 'asc' },
        select:  { id: true, phoneNumber: true, displayName: true, status: true, provider: true },
      }),
    ]);

    return {
      ok: true,
      data: {
        apiKey: key
          ? { name: key.name, keyPrefix: key.keyPrefix, scopes: key.scopes, createdAt: key.createdAt }
          : null,
        numbers: numbers.map((n: any) => ({
          id:          n.id,
          phoneNumber: n.phoneNumber === 'pending' ? null : n.phoneNumber,
          displayName: n.displayName,
          status:      n.status,
          // 'official' é o nome que o cliente entende; 'meta' é interno.
          channel:     n.provider === 'meta' ? 'official' : 'evolution',
        })),
      },
    };
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

  // ── Superfícies de plataforma ──────────────────────────────────────────────
  app.register(import('./public/messages'),  { prefix: '/messages' });
  app.register(import('./public/events'),    { prefix: '/events' });
  app.register(import('./public/templates'), { prefix: '/templates' });
  app.register(import('./public/metrics'),   { prefix: '/metrics' });
}
