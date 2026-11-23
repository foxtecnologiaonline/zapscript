import type { Attachment } from './messages';
import type { Channel, MessageKind } from './types';

/**
 * Registro de remetentes por canal. Cada módulo de canal chama `registerChannelSender` ao carregar; o núcleo
 * (conversations.ts) despacha mensagens de saída (bot, atendente, sistema) por aqui, sem conhecer o canal.
 */
export interface OutboundRequest {
  orgId: string;
  conversation: { id: string; channel: Channel; channelRef: string | null; protocol: string; subject: string | null; lastInboundAt: Date | null; metadata: any };
  contact: { id: string; name: string | null; email: string | null; phone: string | null };
  message: { id: string; kind: MessageKind; body: string | null; attachments: Attachment[]; channelMeta: any; senderType: string };
}
export interface OutboundResult {
  channelMessageId?: string;
  status?: 'QUEUED' | 'SENT';
  channelMeta?: unknown; // mesclado em BvMessage.channelMeta
}
export type ChannelSender = (req: OutboundRequest) => Promise<OutboundResult>;

const senders = new Map<Channel, ChannelSender>();
export const registerChannelSender = (channel: Channel, fn: ChannelSender) => { senders.set(channel, fn); };
export const getChannelSender = (channel: Channel) => senders.get(channel);
export const clearChannelSenders = () => senders.clear();

export class ChannelSendError extends Error {
  constructor(message: string, public code = 'channel.send_failed', public retryable = false) { super(message); }
}
