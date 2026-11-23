import { logger } from '../../lib/logger';
import { onBvEvent } from '../core/events';
import { drainForAgent, routeConversation } from './acd';

/**
 * Liga o ACD ao barramento de eventos: `conversation.needs_routing` (roteia) e `agent.available` (drena a fila).
 * Idempotente: chamar duas vezes não duplica handlers (remove os anteriores antes de registrar). Retorna a função que desliga (usada em testes).
 */
let offs: Array<() => void> | null = null;

export function registerRoutingHandlers(): () => void {
  unregisterRoutingHandlers(); // idempotente (e robusto a clearBvEventHandlers() dos testes do núcleo)
  {
    offs = [
      onBvEvent('conversation.needs_routing', async (e) => {
        const r = await routeConversation(e.orgId, e.conversationId, e.reason);
        logger.debug({ conversationId: e.conversationId, reason: e.reason, result: r.result }, '[balcao/routing] roteamento');
      }),
      onBvEvent('agent.available', async (e) => { await drainForAgent(e.orgId, e.userId); }),
    ];
  }
  return unregisterRoutingHandlers;
}

export function unregisterRoutingHandlers(): void {
  for (const off of offs ?? []) off();
  offs = null;
}
