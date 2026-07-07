import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUserModules } from '../lib/moduleGate';

/**
 * Rotas da plataforma de módulos (suíte ZapScript).
 * - GET /modules        → catálogo público (para launcher + upsell)
 * - GET /modules/me     → módulos que o usuário logado tem ativos
 *
 * O catálogo vem do banco (tabela Product), semeado a partir de
 * packages/modules/catalog.ts. Fonte única da verdade. Ver MODULOS_ARQUITETURA.md.
 */
export default async function entitlementRoutes(app: FastifyInstance) {
  // ── Catálogo público — usado pelo launcher e pelas telas de upsell ──
  app.get('/', async (_req, reply) => {
    try {
      const products = await prisma.product.findMany({
        orderBy: { priceMonthly: 'asc' },
        select: {
          key: true, name: true, status: true,
          priceMonthly: true, priceYearly: true, dependsOn: true,
        },
      });
      return { modules: products };
    } catch {
      // Migração ainda não aplicada — não derrubar o front, só entregar vazio.
      return reply.send({ modules: [] });
    }
  });

  // ── Módulos ativos do usuário logado ──
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req: any) => {
    const modules = await getUserModules(req.user.sub);
    return { modules };
  });
}
