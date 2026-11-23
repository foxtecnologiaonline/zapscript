import crypto from 'crypto';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { prisma } from '../../../lib/prisma';
import { ChannelSendError, type OutboundRequest, type OutboundResult } from '../../core/channels';
import { listMessages } from '../../core/messages';
import { getObjectBuffer } from '../../core/storage';
import { recordUsage } from '../../core/usage';
import { loadEmailConfig } from './config';
import { normalizeSubject } from './parse';
import type { EmailConfig, MailTransport, MailTransportFactory, SmtpConfig } from './types';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const MAX_ATTACH_TOTAL = 25 * 1024 * 1024;
const MAX_REFERENCES = 15;

export const isDevSimulators = () => process.env.BV_DEV_SIMULATORS === '1';

// ── Transporte SMTP (injetável) ──────────────────────────────────────────────

export const defaultTransportFactory: MailTransportFactory = (cfg: SmtpConfig) => nodemailer.createTransport({
  host: cfg.host, port: cfg.port, secure: cfg.secure,
  auth: cfg.pass ? { user: cfg.user, pass: cfg.pass } : { type: 'OAuth2', user: cfg.user, accessToken: cfg.accessToken },
  connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
}) as unknown as MailTransport;

let transportFactory: MailTransportFactory = defaultTransportFactory;
/** Troca a fábrica de transporte SMTP (testes). Sem argumento, restaura o padrão. */
export const setMailTransportFactory = (f?: MailTransportFactory) => { transportFactory = f ?? defaultTransportFactory; };
export const createMailTransport = (cfg: SmtpConfig): MailTransport => transportFactory(cfg);

// ── "Caixa de saída" de desenvolvimento (só com BV_DEV_SIMULATORS=1 e órgão sem SMTP configurado) ──

export interface DevOutboxEntry { at: string; to: unknown; subject: unknown; messageId: unknown; inReplyTo: unknown; references: unknown; text: unknown }
const devOutbox = new Map<string, DevOutboxEntry[]>();
export const getDevOutbox = (orgId: string): DevOutboxEntry[] => devOutbox.get(orgId) ?? [];
const devTransport = (orgId: string): MailTransport => ({
  async sendMail(msg) {
    const list = devOutbox.get(orgId) ?? [];
    list.unshift({ at: new Date().toISOString(), to: msg.to, subject: msg.subject, messageId: msg.messageId, inReplyTo: msg.inReplyTo, references: msg.references, text: msg.text });
    devOutbox.set(orgId, list.slice(0, 50));
    return { messageId: String(msg.messageId ?? ''), accepted: [msg.to], rejected: [] };
  },
});

// ── Helpers de composição ────────────────────────────────────────────────────

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

export function buildReplySubject(convSubject: string | null, protocol: string): string {
  const base = normalizeSubject(convSubject ?? '') || 'Atendimento';
  return oneLine(`Re: ${base} [${protocol}]`);
}

/** Texto → HTML seguro: tudo escapado (sem tags/scripts do remetente), quebras viram <br>. */
export function textToSafeHtml(text: string, quoted?: string | null): string {
  const body = escapeHtml(text).replace(/\r?\n/g, '<br>');
  const q = quoted ? `<blockquote style="margin:16px 0 0;padding:0 0 0 12px;border-left:3px solid #ccc;color:#555">${escapeHtml(quoted).replace(/\r?\n/g, '<br>')}</blockquote>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${body}</div>${q}`;
}

const quoteText = (header: string, text: string) => `${header}\n${text.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}`;

/** IDs de mensagem do thread, em ordem cronológica (raiz primeiro), excluindo a mensagem atual. */
async function threadIds(conversationId: string, orgId: string, currentMessageId: string, rootRef: string | null): Promise<string[]> {
  const rows = await prisma.bvMessage.findMany({
    where: { conversationId, orgId, direction: { in: ['IN', 'OUT'] }, channelMessageId: { not: null }, id: { not: currentMessageId } },
    orderBy: { createdAt: 'asc' }, select: { channelMessageId: true },
  });
  const ids = rows.map((r) => r.channelMessageId!).filter((id) => /^<[^<>\s]+>$/.test(id));
  if (rootRef && /^<[^<>\s]+>$/.test(rootRef) && !ids.includes(rootRef)) ids.unshift(rootRef);
  const uniq = [...new Set(ids)];
  return uniq.length > MAX_REFERENCES ? [uniq[0], ...uniq.slice(-(MAX_REFERENCES - 1))] : uniq;
}

function mapSmtpError(err: any): ChannelSendError {
  const code = String(err?.code ?? '');
  const rc = Number(err?.responseCode ?? 0);
  const rejected = Array.isArray(err?.rejected) && err.rejected.length > 0;
  const detail = String(err?.response ?? err?.message ?? 'erro desconhecido').replace(/\s+/g, ' ').slice(0, 200);
  if (code === 'EENVELOPE' || rejected || [550, 551, 553, 501].includes(rc)) return new ChannelSendError(`Destinatário recusado pelo servidor SMTP: ${detail}`, 'email.invalid_recipient', false);
  const retryable = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS'].includes(code) || (rc >= 400 && rc < 500);
  return new ChannelSendError(`Falha no envio SMTP: ${detail}`, 'email.smtp_failed', retryable);
}

// ── Remetente do canal ───────────────────────────────────────────────────────

export async function sendEmailOutbound(req: OutboundRequest): Promise<OutboundResult> {
  const loaded = await loadEmailConfig(req.orgId);
  let cfg: EmailConfig | null = loaded?.enabled ? loaded.config : null;
  let transport: MailTransport | null = null;
  if (!cfg && isDevSimulators() && !loaded) {
    cfg = { imap: { host: 'dev', port: 993, secure: true, user: 'dev' }, smtp: { host: 'dev', port: 587, secure: false, user: 'dev' }, from: { name: 'Balcão Virtual (dev)', address: 'balcao@dev.local' }, mailbox: 'INBOX', pollIntervalSec: 30 };
    transport = devTransport(req.orgId);
  }
  if (!cfg) throw new ChannelSendError('Canal de e-mail não configurado para este órgão', 'email.not_configured', false);

  const to = (req.contact.email ?? '').trim();
  if (!EMAIL_RE.test(to)) throw new ChannelSendError('Contato sem endereço de e-mail válido', 'email.invalid_recipient', false);
  if (req.message.kind === 'NOTE' || req.message.kind === 'EVENT') throw new ChannelSendError('Tipo de mensagem não enviável por e-mail', 'email.unsupported_kind', false);

  // anexos: só do storage DO PRÓPRIO órgão
  const attachments: NonNullable<SendMailOptions['attachments']> = [];
  let total = 0;
  for (const a of req.message.attachments ?? []) {
    if (!a.key.startsWith(`${req.orgId}/`)) throw new ChannelSendError('Anexo não pertence ao órgão', 'email.attachment_invalid', false);
    let content: Buffer;
    try { content = await getObjectBuffer(a.key); } catch { throw new ChannelSendError(`Anexo indisponível: ${a.name}`, 'email.attachment_invalid', false); }
    total += content.length;
    if (total > MAX_ATTACH_TOTAL) throw new ChannelSendError('Anexos excedem 25 MB', 'email.attachments_too_large', false);
    attachments.push({ filename: oneLine(a.name || 'anexo'), content, contentType: a.mime || 'application/octet-stream' });
  }

  const ids = await threadIds(req.conversation.id, req.orgId, req.message.id, req.conversation.channelRef);
  const inReplyTo = ids.length ? ids[ids.length - 1] : undefined;
  const domain = cfg.from.address.split('@')[1] || 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const subject = buildReplySubject(req.conversation.subject, req.conversation.protocol);

  const bodyText = req.message.body ?? '';
  let text = bodyText;
  let quoted: string | null = null;
  if (req.message.channelMeta?.quote === true) {
    const last = [...(await listMessages(req.conversation.id, { limit: 30, includeInternal: false }))].reverse().find((m) => m.direction === 'IN' && m.body);
    if (last?.body) {
      const who = req.contact.name || to;
      quoted = quoteText(`Em ${last.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Araguaina' })}, ${who} escreveu:`, last.body);
      text = `${text}\n\n${quoted}`;
    }
  }
  const isAuto = req.message.channelMeta?.autoReply === true;

  const mail: SendMailOptions = {
    from: { name: oneLine(cfg.from.name), address: cfg.from.address },
    to, subject, text,
    html: textToSafeHtml(bodyText, quoted),
    messageId, inReplyTo, references: ids.length ? ids : undefined,
    attachments: attachments.length ? attachments : undefined,
    headers: { 'X-Balcao-Protocol': req.conversation.protocol, ...(isAuto ? { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All', Precedence: 'bulk' } : {}) },
  };

  const t = transport ?? createMailTransport(cfg.smtp);
  try {
    const info = await t.sendMail(mail);
    if (info?.rejected && info.rejected.length > 0 && !(info.accepted && info.accepted.length > 0)) {
      throw new ChannelSendError('Destinatário recusado pelo servidor SMTP', 'email.invalid_recipient', false);
    }
  } catch (err: any) {
    throw err instanceof ChannelSendError ? err : mapSmtpError(err);
  } finally {
    try { t.close?.(); } catch { /* noop */ }
  }

  await recordUsage(req.orgId, 'EMAIL_OUT');
  return { channelMessageId: messageId, status: 'SENT', channelMeta: { messageId, inReplyTo: inReplyTo ?? null, references: ids, subject, to: [to], autoReply: isAuto || undefined } };
}
