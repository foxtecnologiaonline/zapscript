import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { generateApiKey } from '../lib/apiKeyAuth';
import { validateRequest, createApiKeySchema } from '../lib/validation';
import { getUserPlan } from '../lib/planGate';
import { planAllowsIntegration } from '../lib/integrationGate';

/**
 * Gestão de chaves da API pública ZapScript — usada pelo dashboard (sessão JWT
 * normal). O consumo de fato das chaves é em routes/publicApi.ts (auth por
 * X-Api-Key, não JWT).
 *
 * Só o DONO da conta cria/revoga chaves — nunca um membro de time (mesmo
 * admin), já que uma chave dá acesso aos dados de todo o time via a API
 * externa, e agora também permite ENVIAR mensagem em nome da conta. Ver
 * lib/teamScope.ts.
 *
 * O gate de plano passou a ser o integrationGate (antes: só 'empresas'), para
 * que chave e webhook de saída possam coexistir no mesmo plano — ver o
 * histórico do problema em lib/integrationGate.ts.
 */
export default async function apiKeysRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  /**
   * Dono com assinatura ativa e plano liberado para integração. A checagem de
   * assinatura ATIVA continua valendo: plano liberado não é o mesmo que conta
   * em dia, e uma chave de API sobrevive a vencimento se ninguém olhar.
   */
  async function requireIntegrationOwner(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
    if (sub?.status !== 'active') return false;
    return planAllowsIntegration(await getUserPlan(userId));
  }

  app.get('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    if (!(await requireIntegrationOwner(userId))) {
      return reply.code(402).send({ error: 'A API pública exige uma assinatura ativa.' });
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
      if (!(await requireIntegrationOwner(userId))) {
        return reply.code(402).send({ error: 'A API pública exige uma assinatura ativa.' });
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
