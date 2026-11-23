import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { registerChannelSender } from '../../core/channels';
import { onBvEvent } from '../../core/events';
import { toPlain } from '../../core/messages';
import { getOrgSettings } from '../../core/settings';
import { recordUsage } from '../../core/usage';
import { emitToVisitors, visitorOnline } from './socket';
import { toVisitorView } from './view';

/**
 * Entrega ao visitante. O remetente do canal só confirma (SENT): a mensagem fica disponível ao polling
 * (`GET /public/messages`) e é empurrada por socket pelo handler de `message.outbound`, que cobre também
 * mensagens registradas com `skipChannel`. Notas internas nunca chegam aqui (direction INTERNAL).
 */
let wired = false;

export function wireWebchatDelivery(): void {
  if (wired) return;
  wired = true;

  registerChannelSender('WEBCHAT', async (req) => {
    const online = await visitorOnline(req.conversation.id);
    return { status: 'SENT', channelMeta: { delivery: online ? 'socket' : 'poll' } };
  });

  onBvEvent('message.outbound', async (e) => {
    if (e.channel !== 'WEBCHAT') return;
    const row = await prisma.bvMessage.findFirst({ where: { id: e.messageId, orgId: e.orgId, conversationId: e.conversationId, direction: 'OUT' } });
    if (!row) return;
    const view = toVisitorView(toPlain(row));
    if (!view) return;
    emitToVisitors(e.conversationId, 'message:new', { message: view });
    void recordUsage(e.orgId, 'WEBCHAT_MSG');
  });

  onBvEvent('conversation.closed', async (e) => {
    if (e.channel !== 'WEBCHAT') return;
    emitToVisitors(e.conversationId, 'conversation:closed', { conversationId: e.conversationId });
    try {
      const settings = await getOrgSettings(e.orgId);
      const conv = await prisma.bvConversation.findFirst({ where: { id: e.conversationId, orgId: e.orgId }, select: { csatScore: true } });
      // O core só pede NPS quando o encerramento é RESOLVED (e csat habilitado) — espelhamos a regra para o visitante.
      if (conv && settings.csat.enabled && e.reason === 'RESOLVED' && conv.csatScore == null) {
        emitToVisitors(e.conversationId, 'csat:request', { conversationId: e.conversationId, prompt: settings.csat.prompt });
      }
    } catch (err: any) { logger.warn({ err: err?.message }, '[webchat] falha ao emitir csat:request'); }
  });
}
