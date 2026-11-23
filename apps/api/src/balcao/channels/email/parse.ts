import crypto from 'crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';

export interface ParsedAttachment { filename: string | null; contentType: string; size: number; content: Buffer; inline: boolean }

export interface ParsedEmail {
  messageId: string;
  /** Message-ID ausente no original: foi gerado a partir do hash (dedupe de reentregas continua funcionando). */
  synthesizedId: boolean;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: { address: string; name: string | null } | null;
  to: string[];
  cc: string[];
  date: Date | null;
  text: string;
  attachments: ParsedAttachment[];
  automated: { automated: boolean; reason?: string };
}

const ID_RE = /<[^<>\s]+>/g;
export const extractIds = (v: unknown): string[] => {
  const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  return [...new Set(s.match(ID_RE) ?? [])];
};

const flatAddrs = (a: AddressObject | AddressObject[] | undefined): string[] => {
  const list = !a ? [] : Array.isArray(a) ? a : [a];
  return list.flatMap((x) => x.value.map((v) => (v.address ?? '').trim().toLowerCase()).filter(Boolean));
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô' };
const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[String(n).toLowerCase()] ?? m);

/** HTML → texto limpo (sem scripts/estilos; blocos viram quebras de linha; links mantêm a URL). */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, d, sq, inner) => {
      const href = String(d ?? sq ?? '').trim();
      const label = String(inner).replace(/<[^>]+>/g, '').trim();
      return /^https?:/i.test(href) && label && label !== href ? `${label} (${href})` : label || href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|blockquote|section|article)\s*>/gi, '\n\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s)
    .replace(/\r/g, '')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const NOREPLY_LOCAL = /^(mailer-daemon|postmaster|no[-_.]?reply|do[-_.]?not[-_.]?reply|nao[-_.]?responda|bounces?)(?:[-_.+].*)?$/i;

/** Detecta auto-respostas, bounces e remetentes que nunca devem gerar conversa (evita loops). */
export function detectAutomated(mail: ParsedMail, fromAddress: string | null, ownAddresses: string[]): { automated: boolean; reason?: string } {
  const h = (k: string): string | null => {
    const v = mail.headers.get(k);
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text ?? '');
    if (typeof v === 'object' && 'value' in (v as any)) return String((v as any).value ?? '');
    return String(v);
  };
  const addr = (fromAddress ?? '').toLowerCase();
  if (addr && ownAddresses.map((a) => a.toLowerCase()).includes(addr)) return { automated: true, reason: 'own_address' };
  const local = addr.split('@')[0] ?? '';
  if (local && NOREPLY_LOCAL.test(local)) return { automated: true, reason: 'noreply_sender' };
  const autoSub = h('auto-submitted');
  if (autoSub != null && autoSub.trim().toLowerCase() !== 'no') return { automated: true, reason: 'auto_submitted' };
  const prec = h('precedence');
  if (prec && /^(bulk|junk|list|auto_reply)$/i.test(prec.trim())) return { automated: true, reason: 'precedence' };
  if (h('x-auto-response-suppress') != null) return { automated: true, reason: 'auto_response_suppress' };
  if (h('x-autoreply') != null || h('x-autorespond') != null || h('x-failed-recipients') != null) return { automated: true, reason: 'auto_reply' };
  const ct = mail.headers.get('content-type') as any;
  if (ct?.value === 'multipart/report' || /delivery-status|disposition-notification/i.test(String(ct?.params?.['report-type'] ?? ''))) return { automated: true, reason: 'bounce' };
  const rpRaw = mail.headers.get('return-path') as any;
  const rpVals: Array<{ address?: string }> | undefined = rpRaw && typeof rpRaw === 'object' ? rpRaw.value : undefined;
  if ((Array.isArray(rpVals) && rpVals.every((v) => !v.address)) || (typeof rpRaw === 'string' && /^<\s*>$/.test(rpRaw.trim()))) return { automated: true, reason: 'null_return_path' };
  return { automated: false };
}

/** Faz o parse de um e-mail bruto (RFC 822) com mailparser. */
export async function parseRawEmail(raw: Buffer, ownAddresses: string[] = []): Promise<ParsedEmail> {
  const mail = await simpleParser(raw);
  const fromV = mail.from?.value?.[0];
  const fromAddr = fromV?.address ? fromV.address.trim().toLowerCase() : null;

  let messageId = extractIds(mail.messageId)[0];
  let synthesizedId = false;
  if (!messageId) { messageId = `<${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40)}@sem-message-id.local>`; synthesizedId = true; }

  const text = (mail.text && mail.text.trim()) ? mail.text.trim() : htmlToText(typeof mail.html === 'string' ? mail.html : '');
  return {
    messageId, synthesizedId,
    inReplyTo: extractIds(mail.inReplyTo)[0] ?? null,
    references: extractIds(mail.references),
    subject: (mail.subject ?? '').replace(/[\r\n]+/g, ' ').trim(),
    from: fromAddr ? { address: fromAddr, name: fromV?.name?.trim() || null } : null,
    to: flatAddrs(mail.to), cc: flatAddrs(mail.cc),
    date: mail.date ?? null,
    text: text.slice(0, 200_000),
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename ?? null, contentType: a.contentType || 'application/octet-stream', size: a.size ?? a.content.length, content: a.content,
      inline: a.contentDisposition === 'inline' || !!a.related,
    })),
    automated: detectAutomated(mail, fromAddr, ownAddresses),
  };
}

/** Remove Re:/Fwd:/RES:/ENC: e tokens de protocolo `[BV-2026-000123]`; colapsa espaços. */
export function normalizeSubject(s: string): string {
  let out = s.replace(/\[[A-Za-z][A-Za-z0-9]*-\d{4}-\d{6,}\]/g, ' ');
  for (let i = 0; i < 10; i++) {
    const next = out.trim().replace(/^(?:re|res|fw|fwd|enc|rv|aw|sv|tr)(?:\s*\[\d+\])?\s*:\s*/i, '');
    if (next === out.trim()) break;
    out = next;
  }
  return out.replace(/\s+/g, ' ').trim();
}
