import { logger } from '../../lib/logger';

/**
 * Barramento interno de eventos do Balcão. Desacopla os módulos: o núcleo emite, canais/IA/roteamento/
 * relatórios/tarefas assinam. Handlers rodam isolados (erro de um não derruba os outros nem o emissor).
 */
export interface BvEventMap {
  /** Conversa criada (já com a 1ª mensagem). */
  'conversation.created': { orgId: string; conversationId: string; channel: string; status: string };
  /** Mensagem do contato recebida (qualquer status de conversa). */
  'message.inbound': { orgId: string; conversationId: string; messageId: string; channel: string; status: string };
  /** Mensagem enviada ao contato (bot, agente ou sistema). */
  'message.outbound': { orgId: string; conversationId: string; messageId: string; channel: string; senderType: string };
  /** Conversa precisa de um atendente humano — o roteamento (ACD) assina este evento. */
  'conversation.needs_routing': { orgId: string; conversationId: string; reason: 'NEW' | 'ESCALATED' | 'TRANSFER' | 'OVERFLOW' | 'REOPEN' | 'AGENT_AVAILABLE' };
  'conversation.assigned': { orgId: string; conversationId: string; userId: string };
  'conversation.updated': { orgId: string; conversationId: string; fields: string[] };
  'conversation.closed': { orgId: string; conversationId: string; channel: string; reason: string };
  'conversation.csat': { orgId: string; conversationId: string; score: number };
  'agent.presence': { orgId: string; userId: string; presence: string };
  /** Capacidade livre de um agente (fim de atendimento, ficou ONLINE…) — ACD tenta drenar a fila. */
  'agent.available': { orgId: string; userId: string };
  /** Cidadão autenticado (GOV.BR) na conversa — a IA retoma o atendimento. */
  'identity.verified': { orgId: string; conversationId: string; contactId: string; level: 'bronze' | 'prata' | 'ouro' };
  'task.created': { orgId: string; taskId: string };
  'task.closed': { orgId: string; taskId: string };
  'sla.breach': { orgId: string; conversationId?: string; taskId?: string; kind: string };
  'call.started': { orgId: string; callId: string; conversationId?: string };
  'call.ended': { orgId: string; callId: string; conversationId?: string };
}
export type BvEventName = keyof BvEventMap;
type Handler<K extends BvEventName> = (payload: BvEventMap[K]) => void | Promise<void>;

const handlers = new Map<BvEventName, Set<Handler<any>>>();

export function onBvEvent<K extends BvEventName>(name: K, fn: Handler<K>): () => void {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name)!.add(fn);
  return () => handlers.get(name)?.delete(fn);
}

/** Dispara e espera todos os handlers (erros são logados, nunca propagados). */
export async function emitBvEventAndWait<K extends BvEventName>(name: K, payload: BvEventMap[K]): Promise<void> {
  const list = [...(handlers.get(name) ?? [])];
  await Promise.all(list.map(async (fn) => {
    try { await fn(payload); } catch (err: any) { logger.error({ err: err?.message, event: name }, '[balcao] handler de evento falhou'); }
  }));
}

/** Dispara sem esperar (fire-and-forget). */
export function emitBvEvent<K extends BvEventName>(name: K, payload: BvEventMap[K]): void {
  void emitBvEventAndWait(name, payload);
}

/** Só para testes. */
export function clearBvEventHandlers() { handlers.clear(); }
