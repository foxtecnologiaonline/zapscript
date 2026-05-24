import { prisma } from './prisma';
import { FastifyReply } from 'fastify';

/**
 * Retorna o nome do plano do usuário ('free' | 'pro' | 'ultra' | 'executive').
 * Se não houver subscription ativa, retorna 'free'.
 */
export async function getUserPlan(userId: string): Promise<string> {
  const sub = await prisma.subscription.findUnique({
    where:   { userId },
    include: { plan: true },
  });
  return sub?.plan?.name ?? 'free';
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
