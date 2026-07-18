import { prisma } from './prisma';
import { FastifyReply } from 'fastify';
import { redis } from '../services/queue';

const PLAN_CACHE_TTL = 60; // segundos — balanço entre consistência e performance
const planCacheKey   = (userId: string) => `plan:${userId}`;

/**
 * M6: Retorna o nome do plano do usuário com cache Redis de 60s.
 * Evita query extra em toda rota que usa planGate.
 * ('free' | 'pro' | 'ultra' | 'executive')
 */
export async function getUserPlan(userId: string): Promise<string> {
  // Tentar cache primeiro
  try {
    const cached = await (redis as any).get(planCacheKey(userId));
    if (cached) return cached as string;
  } catch { /* Redis indisponível — continuar sem cache */ }

  const sub = await prisma.subscription.findUnique({
    where:   { userId },
    include: { plan: true },
  });
  const planName = sub?.plan?.name ?? 'free';

  // Salvar em cache (fire-and-forget)
  try {
    await (redis as any).set(planCacheKey(userId), planName, 'EX', PLAN_CACHE_TTL);
  } catch { /* Redis indisponível — ignorar */ }

  return planName;
}

/** Invalida o cache de plano — chamar após mudança de subscription */
export async function invalidatePlanCache(userId: string): Promise<void> {
  try { await (redis as any).del(planCacheKey(userId)); } catch { /* ignorar */ }
}

/**
 * Verifica se o plano do usuário está na lista de planos permitidos.
 * Se não estiver, envia 403 e retorna false.
 * Use assim:
 *   const plan = await getUserPlan(userId);
 *   if (!requirePlan(plan, ['pro','ultra','executive'], reply)) return;
 */
export function requirePlan(
  planName: string,
  allowed: string[],
  reply: FastifyReply,
): boolean {
  if (allowed.includes(planName)) return true;
  reply.code(403).send({
    error:        'Plano insuficiente',
    message:      `Esta funcionalidade requer um plano superior. Acesse /dashboard/plano para fazer upgrade.`,
    planRequired: allowed[0],
    planCurrent:  planName,
  });
  return false;
}
