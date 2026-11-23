import { prisma } from '../../lib/prisma';
import { blindIndex, decryptField, encryptField } from './crypto';
import type { Channel } from './types';

export const normalizeEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);
/** E.164 BR: remove máscara; 10–11 dígitos ganham +55. Retorna null se não parecer telefone. */
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}
export const normalizeDocument = (d: string) => d.replace(/\D/g, '');

export interface ResolveContactInput {
  orgId: string;
  channel: Channel;
  externalId: string; // wa_id / e-mail / visitorId / número de origem
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Identidade única entre canais: acha o contato pela identidade do canal; senão tenta casar por
 * e-mail/telefone (mesma pessoa vinda de outro canal) e registra a nova identidade; senão cria.
 */
export async function resolveContact(i: ResolveContactInput): Promise<{ contactId: string; created: boolean }> {
  const email = normalizeEmail(i.email ?? (i.channel === 'EMAIL' ? i.externalId : null));
  const phone = normalizePhone(i.phone ?? (i.channel === 'WHATSAPP' || i.channel === 'VOICE' ? i.externalId : null));
  const externalId = i.channel === 'EMAIL' ? (email ?? i.externalId) : i.channel === 'WHATSAPP' || i.channel === 'VOICE' ? (phone ?? i.externalId) : i.externalId;

  const ident = await prisma.bvContactIdentity.findUnique({ where: { orgId_channel_externalId: { orgId: i.orgId, channel: i.channel, externalId } } });
  if (ident) {
    const c = await prisma.bvContact.findUnique({ where: { id: ident.contactId }, select: { id: true, mergedIntoId: true, name: true, email: true, phone: true } });
    const id = c?.mergedIntoId ?? ident.contactId;
    const patch: Record<string, string> = {};
    if (c && !c.name && i.name) patch.name = i.name;
    if (c && !c.email && email) patch.email = email;
    if (c && !c.phone && phone) patch.phone = phone;
    if (Object.keys(patch).length) await prisma.bvContact.update({ where: { id }, data: patch }).catch(() => undefined);
    return { contactId: id, created: false };
  }

  let match = null as { id: string } | null;
  if (email) match = await prisma.bvContact.findFirst({ where: { orgId: i.orgId, email, mergedIntoId: null, anonymizedAt: null }, select: { id: true } });
  if (!match && phone) match = await prisma.bvContact.findFirst({ where: { orgId: i.orgId, phone, mergedIntoId: null, anonymizedAt: null }, select: { id: true } });

  if (match) {
    await prisma.bvContactIdentity.upsert({
      where: { orgId_channel_externalId: { orgId: i.orgId, channel: i.channel, externalId } },
      create: { orgId: i.orgId, contactId: match.id, channel: i.channel, externalId }, update: {},
    });
    return { contactId: match.id, created: false };
  }

  const contact = await prisma.bvContact.create({
    data: {
      orgId: i.orgId, name: i.name ?? null, email, phone,
      identities: { create: { orgId: i.orgId, channel: i.channel, externalId } },
    },
  });
  return { contactId: contact.id, created: true };
}

/** Define CPF/CNPJ (cifrado + índice cego). */
export async function setContactDocument(contactId: string, document: string): Promise<void> {
  const doc = normalizeDocument(document);
  await prisma.bvContact.update({ where: { id: contactId }, data: { documentEnc: encryptField(doc), documentHash: blindIndex(doc) } });
}
export const getContactDocument = (documentEnc: string | null) => (documentEnc ? decryptField(documentEnc) : null);
export const maskDocument = (doc: string) => (doc.length === 11 ? `***.${doc.slice(3, 6)}.***-**` : doc.replace(/^(\d{2})\d+(\d{2})$/, '$1***$2'));

/** Vincula uma identidade extra (ex.: cidadão autenticado via GOV.BR informa o e-mail). */
export async function addIdentity(orgId: string, contactId: string, channel: Channel, externalId: string): Promise<void> {
  await prisma.bvContactIdentity.upsert({
    where: { orgId_channel_externalId: { orgId, channel, externalId } },
    create: { orgId, contactId, channel, externalId }, update: {},
  });
}

/** Mescla `from` em `into` (duplicidade): move identidades e conversas e marca `from` como mesclado. */
export async function mergeContacts(orgId: string, intoId: string, fromId: string): Promise<void> {
  if (intoId === fromId) return;
  await prisma.$transaction(async (tx) => {
    const ids = await tx.bvContactIdentity.findMany({ where: { contactId: fromId, orgId } });
    for (const x of ids) {
      const exists = await tx.bvContactIdentity.findUnique({ where: { orgId_channel_externalId: { orgId, channel: x.channel, externalId: x.externalId } } });
      if (exists && exists.contactId === intoId) await tx.bvContactIdentity.delete({ where: { id: x.id } });
      else await tx.bvContactIdentity.update({ where: { id: x.id }, data: { contactId: intoId } });
    }
    await tx.bvConversation.updateMany({ where: { orgId, contactId: fromId }, data: { contactId: intoId } });
    await tx.bvContact.update({ where: { id: fromId }, data: { mergedIntoId: intoId, documentHash: null, govbrSub: null } });
  });
}
