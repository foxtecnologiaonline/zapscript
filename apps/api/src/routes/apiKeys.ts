import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { generateApiKey } from '../lib/apiKeyAuth';
import { validateRequest, createApiKeySchema } from '../lib/validation';

/**
 * Gestão de chaves da API pública ZapScript 2.0 (tier Empresas) — usada pelo
 * dashboard (sessão JWT normal). O consumo de fato das chaves é em
 * routes/publicApi.ts (auth por X-Api-Key, não JWT).
 *
 * Só o DONO do tier Empresas cria/revoga chaves — nunca um membro de time
 * (mesmo admin), já que uma chave dá acesso de leitura a todos os dados do
 * time via a API externa. Ver lib/teamScope.ts.
 */
export default async function apiKeysRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  async function requireEmpresasOwner(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
    return sub?.status === 'active' && sub.plan?.name === 'empresas';
  }

  app.get('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    if (!(await requireEmpresasOwner(userId))) {
      return reply.code(402).send({ error: 'A API pública é exclusiva do tier Empresas.' });
    }
    const keys = await prisma.apiKey.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
    return { keys };
  });

  app.post<{ Body: any }>(
    '/',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      if (!(await requireEmpresasOwner(userId))) {
        return reply.code(402).send({ error: 'A API pública é exclusiva do tier Empresas.' });
      }

      const v = validateRequest(createApiKeySchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const activeCount = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
      if (activeCount >= 10) {
        return reply.code(400).send({ error: 'Limite de 10 chaves ativas atingido.' });
      }

      const { token, keyHash, keyPrefix } = generateApiKey();
      const key = await prisma.apiKey.create({
        data: { userId, name: v.data.name, keyHash, keyPrefix, scopes: v.data.scopes },
      });

      // Único momento em que o token real é devolvido — o dono precisa copiar agora.
      return reply.code(201).send({
        id:        key.id,
        name:      key.name,
        scopes:    key.scopes,
        createdAt: key.createdAt,
        token,
      });
    }
  );

  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId } });
    if (!key) return reply.code(404).send({ error: 'Chave não encontrada.' });
    if (key.revokedAt) return reply.code(400).send({ error: 'Chave já revogada.' });

    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    return { ok: true, message: 'Chave revogada.' };
  });
}
