import { prisma } from '../../lib/prisma';
import { emitBvEvent } from './events';
import { emitToSupervisors } from './realtime';
import type { Presence } from './types';

export async function setAgentPresence(orgId: string, userId: string, presence: Presence): Promise<void> {
  await prisma.bvUser.updateMany({ where: { id: userId, orgId }, data: { presence, presenceAt: new Date() } });
  emitToSupervisors(orgId, 'presence:changed', { userId, presence });
  emitBvEvent('agent.presence', { orgId, userId, presence });
  if (presence === 'ONLINE') emitBvEvent('agent.available', { orgId, userId });
}

/** Conversas ATIVAS atribuídas ao atendente (base da distribuição por capacidade). */
export async function agentLoad(userId: string): Promise<number> {
  return prisma.bvConversation.count({ where: { assignedUserId: userId, status: 'ACTIVE' } });
}
