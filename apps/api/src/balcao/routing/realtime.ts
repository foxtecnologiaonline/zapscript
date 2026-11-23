import { prisma } from '../../lib/prisma';
import { emitToSupervisors, emitToUser } from '../core/realtime';

/** Eventos de socket específicos do roteamento (além dos emitidos pelo núcleo). Ver docs/balcao/api-routing.md. */

export interface ConversationBrief {
  id: string; protocol?: string; status: string; queueId: string | null; priority: number; assignedUserId?: string | null; channel?: string;
}

/** `conversation:updated` para a supervisão (mudança de fila/prioridade/SLA feita pelo roteamento). */
export function emitConversationUpdated(orgId: string, conv: ConversationBrief, extra: Record<string, unknown> = {}): void {
  emitToSupervisors(orgId, 'conversation:updated', { id: conv.id, status: conv.status, queueId: conv.queueId, priority: conv.priority, assignedUserId: conv.assignedUserId ?? null, ...extra });
}

/** `conversation:queued` para os membros da fila (nova conversa aguardando — atualiza a caixa de entrada). */
export async function emitConversationQueued(conv: ConversationBrief): Promise<void> {
  if (!conv.queueId) return;
  const members = await prisma.bvQueueMember.findMany({ where: { queueId: conv.queueId }, select: { userId: true } });
  for (const m of members) emitToUser(m.userId, 'conversation:queued', { id: conv.id, protocol: conv.protocol, channel: conv.channel, queueId: conv.queueId, priority: conv.priority });
}
