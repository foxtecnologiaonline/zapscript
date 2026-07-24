import { prisma } from './prisma';
import { FastifyReply } from 'fastify';
import { redis } from '../services/queue';

/**
 * Gate de acesso por MÓDULO da suíte ZapScript (login único + acesso à la carte).
 * Espelha o padrão de planGate.ts: cache Redis de 60s, tolerante a Redis fora do ar,
 * invalidação explícita após mudança de titularidade (webhook de billing, admin).
 *
 * A titularidade (Entitlement) é a fonte da verdade de acesso — nunca o front.
 * Ver MODULOS_ARQUITETURA.md §4.
 */

const ENT_CACHE_TTL = 60; // segundos
const entCacheKey = (userId: string) => `ent:${userId}`;

/** Status de entitlement que concedem acesso ativo ao módulo. */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Retorna as keys dos módulos que o usuário tem ATIVOS (com cache Redis 60s).
 * Ex.: ['core', 'cobranca']. Vazio se o usuário não tiver nenhum entitlement.
 */
export async function getUserModules(userId: string): Promise<string[]> {
  try {
    const cached = await (redis as any).get(entCacheKey(userId));
    if (cached) return JSON.parse(cached) as string[];
  } catch { /* Redis indisponível — segue sem cache */ }

  let keys: string[] = [];
  try {
    const ents = await prisma.entitlement.findMany({
      where:  { userId, status: { in: [...ACTIVE_STATUSES] } },
      select: { productKey: true },
    });
    keys = ents.map((e: { productKey: string }) => e.productKey);
  } catch {
    // Tabela ausente (migração ainda não aplicada) ou erro — degrada para vazio
    // em vez de derrubar a rota. O gate então nega (402), que é o padrão seguro.
    keys = [];
  }

  try {
    await (redis as any).set(entCacheKey(userId), JSON.stringify(keys), 'EX', ENT_CACHE_TTL);
  } catch { /* ignorar */ }

  return keys;
}

/** Invalida o cache de módulos — chamar após alteração de entitlement. */
export async function invalidateModuleCache(userId: string): Promise<void> {
  try { await (redis as any).del(entCacheKey(userId)); } catch { /* ignorar */ }
}

/** Cache leve do mapa productKey -> dependsOn (catálogo muda raramente). */
let depsCache: { at: number; map: Record<string, string[]> } | null = null;
const DEPS_TTL_MS = 5 * 60 * 1000;

async function getDependencyMap(): Promise<Record<string, string[]>> {
  if (depsCache && Date.now() - depsCache.at < DEPS_TTL_MS) return depsCache.map;
  const map: Record<string, string[]> = {};
  try {
    const products = await prisma.product.findMany({ select: { key: true, dependsOn: true } });
    for (const p of products) map[p.key] = p.dependsOn ?? [];
  } catch { /* catálogo indisponível — sem dependências conhecidas */ }
  depsCache = { at: Date.now(), map };
  return map;
}

/**
 * preHandler factory: exige que o usuário tenha o módulo `key` ativo.
 * Responde 402 (Payment Required) se não contratado — semântica de "existe, mas
 * você não assinou", melhor que 403. Também valida dependências (dependsOn).
 *
 * Uso:
 *   app.post('/cobranca/lembrete', {
 *     preHandler: [(app as any).authenticate, requireModule('cobranca')],
 *   }, handler);
 */
export function requireModule(key: string) {
  return async (req: any, reply: FastifyReply) => {
    const userId = req.user?.sub;
    if (!userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return reply;
    }

    const owned = await getUserModules(userId);
    const ownedSet = new Set(owned);

    if (!ownedSet.has(key)) {
      reply.code(402).send({
        error:          'Módulo não contratado',
        message:        `Este recurso faz parte do módulo "${key}", que você ainda não contratou.`,
        moduleRequired: key,
        upsellUrl:      `/app?upsell=${encodeURIComponent(key)}`,
      });
      return reply;
    }

    // Dependência dura (ex.: atende-qualidade requer atende)
    const deps = (await getDependencyMap())[key] ?? [];
    const missingDep = deps.find((d) => !ownedSet.has(d));
    if (missingDep) {
      reply.code(402).send({
        error:          'Dependência não contratada',
        message:        `O módulo "${key}" requer também o módulo "${missingDep}".`,
        moduleRequired: missingDep,
        upsellUrl:      `/app?upsell=${encodeURIComponent(missingDep)}`,
      });
      return reply;
    }
    // ok — segue para o handler
  };
}
