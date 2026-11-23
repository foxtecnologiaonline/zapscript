import { prisma } from '../../../lib/prisma';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { openConversation } from '../../core/conversations';
import { makeOrg, makeUser } from '../../core/testing';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

/** Horário 24/7 (segunda a domingo) para os testes não dependerem do relógio. */
export const ALWAYS_OPEN = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['00:00', '23:59']]]));
export const NEVER_OPEN = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, []]));

export const sentMessages: Array<{ conversationId: string; body: string | null; senderType: string }> = [];
export function installSenders(): void {
  for (const ch of ['WHATSAPP', 'WEBCHAT', 'EMAIL', 'VOICE'] as const) {
    registerChannelSender(ch, async (r) => { sentMessages.push({ conversationId: r.conversation.id, body: r.message.body, senderType: r.message.senderType }); return { channelMessageId: `out-${r.message.id}` }; });
  }
}
export const removeSenders = clearChannelSenders;

export async function setup(settings: Record<string, unknown> = {}) {
  const org = await makeOrg({ ai: { enabled: false }, businessHours: ALWAYS_OPEN, ...settings });
  return org.id;
}

export async function makeQueue(orgId: string, over: Record<string, unknown> = {}, memberIds: string[] = []) {
  const slug = (over.slug as string) ?? `q-${Math.random().toString(36).slice(2, 8)}`;
  const q = await prisma.bvQueue.create({ data: { orgId, name: slug, slug, ...over } as any });
  for (const userId of memberIds) await prisma.bvQueueMember.create({ data: { queueId: q.id, userId } });
  return q;
}

export async function onlineAgent(orgId: string, over: Parameters<typeof makeUser>[2] = {}) {
  return makeUser(orgId, 'ATENDENTE', { presence: 'ONLINE', ...over });
}

let seq = 0;
/** Cria uma conversa WAITING sem disparar o roteamento por evento (status inicial BOT e depois WAITING manual). */
export async function waitingConv(orgId: string, over: { channel?: 'WHATSAPP' | 'WEBCHAT' | 'EMAIL' | 'VOICE'; category?: string; contactCategory?: string; priority?: number; queuedAt?: Date } = {}) {
  seq++;
  const ext = `ext-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
  const { conversation, contactId } = await openConversation({ orgId, channel: over.channel ?? 'WEBCHAT', channelRef: ext, externalId: ext, name: `Cidadão ${seq}`, status: 'BOT', category: over.category ?? null });
  if (over.contactCategory) await prisma.bvContact.update({ where: { id: contactId }, data: { category: over.contactCategory } });
  return prisma.bvConversation.update({ where: { id: conversation.id }, data: { status: 'WAITING', queuedAt: over.queuedAt ?? new Date(), ...(over.priority !== undefined ? { priority: over.priority } : {}) } });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('waitFor: tempo esgotado');
    await sleep(40);
  }
}
