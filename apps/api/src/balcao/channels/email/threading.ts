import { prisma } from '../../../lib/prisma';
import { normalizeEmail } from '../../core/contacts';
import { getOrgSettings } from '../../core/settings';
import { normalizeSubject, type ParsedEmail } from './parse';

export type ThreadMatch = { channelRef: string; matchedBy: 'protocol' | 'header' | 'subject' | 'new'; conversationId?: string };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Extrai o protocolo `[BV-2026-000123]` do assunto (usa o prefixo configurado do órgão). */
export function extractProtocol(subject: string, prefix: string): string | null {
  const m = new RegExp(`\\[(${escapeRegex(prefix)}-\\d{4}-\\d{6,})\\]`, 'i').exec(subject);
  return m ? m[1].toUpperCase() : null;
}

/** Contato (já resolvido/mesclado) associado a um e-mail neste órgão, sem criar nada. */
async function contactIdByEmail(orgId: string, email: string): Promise<string | null> {
  const ident = await prisma.bvContactIdentity.findUnique({ where: { orgId_channel_externalId: { orgId, channel: 'EMAIL', externalId: email } }, select: { contactId: true } });
  if (ident) {
    const c = await prisma.bvContact.findUnique({ where: { id: ident.contactId }, select: { id: true, mergedIntoId: true } });
    return c?.mergedIntoId ?? ident.contactId;
  }
  const c = await prisma.bvContact.findFirst({ where: { orgId, email, mergedIntoId: null }, select: { id: true } });
  return c?.id ?? null;
}

/**
 * Descobre a que thread o e-mail pertence, nesta ordem:
 *  1. token de protocolo no assunto (só vale se o remetente é o contato da conversa — o protocolo é sequencial/adivinhável);
 *  2. In-Reply-To / References casando com channelMessageId de mensagens do órgão;
 *  3. mesmo remetente + assunto normalizado em conversa aberta.
 * `channelRef` = Message-ID raiz do thread.
 */
export async function resolveThread(orgId: string, mail: ParsedEmail): Promise<ThreadMatch> {
  const sender = normalizeEmail(mail.from?.address) ?? '';
  const settings = await getOrgSettings(orgId);

  // 1) protocolo no assunto
  const protocol = extractProtocol(mail.subject, settings.protocolPrefix);
  if (protocol && sender) {
    const conv = await prisma.bvConversation.findFirst({ where: { orgId, protocol, channel: 'EMAIL' }, select: { id: true, channelRef: true, contactId: true } });
    if (conv) {
      const senderContact = await contactIdByEmail(orgId, sender);
      if (senderContact && senderContact === conv.contactId) return { channelRef: conv.channelRef ?? mail.references[0] ?? mail.messageId, matchedBy: 'protocol', conversationId: conv.id };
    }
  }

  // 2) cabeçalhos de thread
  const candidates = [...new Set([...(mail.inReplyTo ? [mail.inReplyTo] : []), ...[...mail.references].reverse()])];
  if (candidates.length) {
    const rows = await prisma.bvMessage.findMany({
      where: { orgId, channelMessageId: { in: candidates }, conversation: { channel: 'EMAIL' } },
      select: { channelMessageId: true, conversationId: true, conversation: { select: { channelRef: true } } },
    });
    for (const id of candidates) {
      const hit = rows.find((r) => r.channelMessageId === id);
      if (hit) return { channelRef: hit.conversation.channelRef ?? id, matchedBy: 'header', conversationId: hit.conversationId };
    }
  }

  // 3) mesmo remetente + assunto normalizado, conversa aberta
  const norm = normalizeSubject(mail.subject).toLowerCase();
  if (sender && norm) {
    const contactId = await contactIdByEmail(orgId, sender);
    if (contactId) {
      const open = await prisma.bvConversation.findMany({
        where: { orgId, channel: 'EMAIL', contactId, status: { not: 'CLOSED' } }, orderBy: { startedAt: 'desc' }, take: 20,
        select: { id: true, channelRef: true, subject: true },
      });
      const hit = open.find((c) => c.subject && normalizeSubject(c.subject).toLowerCase() === norm && c.channelRef);
      if (hit) return { channelRef: hit.channelRef!, matchedBy: 'subject', conversationId: hit.id };
    }
  }

  // novo thread: raiz = 1º References, senão In-Reply-To, senão o próprio Message-ID
  return { channelRef: mail.references[0] ?? mail.inReplyTo ?? mail.messageId, matchedBy: 'new' };
}
