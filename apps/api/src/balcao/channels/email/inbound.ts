import path from 'path';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { ingestInbound, sendMessage } from '../../core/conversations';
import type { Attachment } from '../../core/messages';
import { AttachmentRejectedError } from '../../core/antivirus';
import { deleteObject, newKey, putObject } from '../../core/storage';
import { recordUsage } from '../../core/usage';
import { normalizeSubject, parseRawEmail } from './parse';
import { resolveThread } from './threading';
import { MAX_ATTACHMENT_BYTES, type EmailConfig } from './types';

export interface InboundContext {
  orgId: string;
  /** Endereços do próprio órgão (anti-loop). */
  ownAddresses: string[];
  autoReply?: EmailConfig['autoReply'];
  source: 'imap' | 'webhook' | 'simulator';
}

export type InboundOutcome =
  | { status: 'ingested'; conversationId: string; messageId: string | null; protocol: string; isNew: boolean; matchedBy: string }
  | { status: 'duplicate'; conversationId: string }
  | { status: 'ignored'; reason: string };

const safeName = (n: string | null, idx: number): string => {
  const base = path.basename((n ?? '').replace(/[\\]/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim().slice(0, 150);
  return base || `anexo-${idx + 1}`;
};

/** Pipeline único de entrada: parse → filtros anti-loop → dedupe → anexos → thread → ingestInbound → auto-resposta. */
export async function ingestRawEmail(raw: Buffer, ctx: InboundContext): Promise<InboundOutcome> {
  const mail = await parseRawEmail(raw, ctx.ownAddresses);
  if (!mail.from) return { status: 'ignored', reason: 'no_sender' };
  if (mail.automated.automated) {
    logger.info({ orgId: ctx.orgId, reason: mail.automated.reason, source: ctx.source }, '[balcao.email] mensagem automática ignorada');
    return { status: 'ignored', reason: mail.automated.reason ?? 'automated' };
  }

  // dedupe antes de gravar anexos (reentrega / reinício de uidValidity)
  const dup = await prisma.bvMessage.findFirst({ where: { orgId: ctx.orgId, channelMessageId: mail.messageId }, select: { conversationId: true } });
  if (dup) return { status: 'duplicate', conversationId: dup.conversationId };

  const stored: Attachment[] = [];
  const skipped: Array<{ name: string; size: number; reason: string }> = [];
  /** Anexos recusados pelo antivírus (ClamAV): descartados, a mensagem segue. `reason`: 'infected' | 'scan_unavailable'. */
  const rejected: Array<{ name: string; reason: string }> = [];
  try {
    for (const [i, a] of mail.attachments.entries()) {
      const name = safeName(a.filename, i);
      if (a.size > MAX_ATTACHMENT_BYTES) { skipped.push({ name, size: a.size, reason: 'too_large' }); continue; }
      const ext = path.extname(name).slice(1);
      let obj;
      try { obj = await putObject(newKey(ctx.orgId, 'attachments', ext), a.content, { scan: true }); }
      catch (err) {
        if (!(err instanceof AttachmentRejectedError)) throw err;
        rejected.push({ name, reason: err.reason });
        logger.warn({ orgId: ctx.orgId, reason: err.reason, signature: err.signature, source: ctx.source }, '[balcao.email] anexo recusado pelo antivírus');
        continue;
      }
      stored.push({ key: obj.key, name, mime: a.contentType, size: obj.size, sha256: obj.sha256 });
    }

    const thread = await resolveThread(ctx.orgId, mail);
    const cleanSubject = normalizeSubject(mail.subject) || mail.subject || null;
    const res = await ingestInbound({
      orgId: ctx.orgId, channel: 'EMAIL', channelRef: thread.channelRef, externalId: mail.from.address,
      name: mail.from.name, email: mail.from.address, subject: cleanSubject,
      message: {
        kind: 'TEXT', body: mail.text || null, attachments: stored.length ? stored : undefined, channelMessageId: mail.messageId, createdAt: mail.date ?? undefined,
        channelMeta: {
          messageId: mail.messageId, inReplyTo: mail.inReplyTo, references: mail.references, subject: mail.subject,
          from: mail.from, to: mail.to, cc: mail.cc, matchedBy: thread.matchedBy, source: ctx.source,
          ...(skipped.length ? { skippedAttachments: skipped } : {}),
          ...(rejected.length ? { attachmentsRejected: rejected } : {}),
        },
      },
    });

    if (res.duplicate) {
      for (const s of stored) await deleteObject(s.key).catch(() => undefined);
      return { status: 'duplicate', conversationId: res.conversation.id };
    }
    await recordUsage(ctx.orgId, 'EMAIL_IN');
    if (res.isNew && ctx.autoReply?.enabled) await sendAutoReply(ctx, res.conversation.id, res.conversation.protocol, (res.conversation.metadata ?? {}) as Record<string, any>);
    return { status: 'ingested', conversationId: res.conversation.id, messageId: res.message?.id ?? null, protocol: res.conversation.protocol, isNew: res.isNew, matchedBy: thread.matchedBy };
  } catch (err) {
    // falha no meio: não deixa anexos órfãos (a mensagem será reprocessada)
    for (const s of stored) await deleteObject(s.key).catch(() => undefined);
    throw err;
  }
}

export const DEFAULT_AUTOREPLY = 'Recebemos a sua mensagem e ela foi registrada sob o protocolo {{protocolo}}. Em breve um atendente responderá neste mesmo e-mail. Guarde o número do protocolo e mantenha-o no assunto das próximas mensagens.';

export function renderAutoReply(text: string | undefined, protocol: string): string {
  const base = (text && text.trim()) || DEFAULT_AUTOREPLY;
  const withProto = base.replace(/\{\{\s*protocolo\s*\}\}/gi, protocol);
  return withProto.includes(protocol) ? withProto : `${withProto}\n\nProtocolo: ${protocol}`;
}

/** Resposta automática de recebimento: no máximo 1 por conversa (marca em metadata ANTES de enviar). */
async function sendAutoReply(ctx: InboundContext, conversationId: string, protocol: string, metadata: Record<string, any>): Promise<void> {
  if (metadata.emailAutoReplySent) return;
  try {
    await prisma.bvConversation.updateMany({ where: { id: conversationId, orgId: ctx.orgId }, data: { metadata: { ...metadata, emailAutoReplySent: true } as any } });
    await sendMessage({ orgId: ctx.orgId, conversationId, senderType: 'SYSTEM', body: renderAutoReply(ctx.autoReply?.text, protocol), channelMeta: { autoReply: true } });
  } catch (err: any) {
    logger.warn({ err: err?.message, conversationId }, '[balcao.email] falha na resposta automática');
  }
}
