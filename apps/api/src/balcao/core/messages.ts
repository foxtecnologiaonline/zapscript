import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decryptField, encryptField } from './crypto';
import type { MessageDirection, MessageKind, SenderType } from './types';

/**
 * ÚNICO ponto de acesso a BvMessage.body. O conteúdo é cifrado em repouso (AES-256-GCM); qualquer módulo
 * que precise do texto deve usar `readBody`/`listMessages` — não ler `body` direto do Prisma.
 */
export interface Attachment { key: string; name: string; mime: string; size: number; sha256?: string }

export interface CreateMessageInput {
  orgId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: SenderType;
  senderUserId?: string | null;
  kind?: MessageKind;
  body?: string | null;
  attachments?: Attachment[];
  channelMessageId?: string | null;
  channelMeta?: unknown;
  status?: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  aiMeta?: unknown;
  createdAt?: Date;
}

export type PlainMessage = Omit<Prisma.BvMessageGetPayload<{}>, 'body'> & { body: string | null };

export const readBody = (body: string | null): string | null => (body == null ? null : decryptField(body));

export function toPlain(row: Prisma.BvMessageGetPayload<{}>): PlainMessage {
  return { ...row, body: readBody(row.body) };
}

/** Cria a mensagem (cifrando o corpo). Reentrega do provedor (mesmo channelMessageId) devolve a existente com duplicate=true. */
export async function createMessage(i: CreateMessageInput): Promise<{ message: PlainMessage; duplicate: boolean }> {
  try {
    const row = await prisma.bvMessage.create({
      data: {
        orgId: i.orgId, conversationId: i.conversationId, direction: i.direction, senderType: i.senderType,
        senderUserId: i.senderUserId ?? null, kind: i.kind ?? (i.direction === 'INTERNAL' ? 'NOTE' : 'TEXT'),
        body: i.body ? encryptField(i.body) : null, attachments: (i.attachments ?? undefined) as any,
        channelMessageId: i.channelMessageId ?? null, channelMeta: (i.channelMeta ?? undefined) as any,
        status: i.status ?? 'SENT', aiMeta: (i.aiMeta ?? undefined) as any, ...(i.createdAt ? { createdAt: i.createdAt } : {}),
      },
    });
    return { message: toPlain(row), duplicate: false };
  } catch (err: any) {
    if (err?.code === 'P2002' && i.channelMessageId) {
      const row = await prisma.bvMessage.findFirstOrThrow({ where: { orgId: i.orgId, channelMessageId: i.channelMessageId } });
      return { message: toPlain(row), duplicate: true };
    }
    throw err;
  }
}

export async function listMessages(conversationId: string, opts: { limit?: number; before?: Date; includeInternal?: boolean } = {}): Promise<PlainMessage[]> {
  const rows = await prisma.bvMessage.findMany({
    where: { conversationId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}), ...(opts.includeInternal === false ? { direction: { not: 'INTERNAL' } } : {}) },
    orderBy: { createdAt: 'desc' }, take: Math.min(opts.limit ?? 100, 500),
  });
  return rows.reverse().map(toPlain);
}

/** Últimas N mensagens (texto) para contexto de IA / curadoria — exclui notas internas. */
export async function recentTranscript(conversationId: string, n = 12): Promise<Array<{ role: 'user' | 'assistant'; senderType: string; text: string; at: Date }>> {
  const msgs = await listMessages(conversationId, { limit: n, includeInternal: false });
  return msgs.filter((m) => m.body).map((m) => ({ role: m.direction === 'IN' ? 'user' as const : 'assistant' as const, senderType: m.senderType, text: m.body!, at: m.createdAt }));
}

export async function setMessageStatus(messageId: string, status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', errorCode?: string | null) {
  await prisma.bvMessage.update({ where: { id: messageId }, data: { status, ...(errorCode !== undefined ? { errorCode } : {}) } }).catch(() => undefined);
}
