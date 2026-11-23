import type { PlainMessage } from '../../core/messages';

/**
 * Representação PÚBLICA de mensagens (o que o visitante pode ver). Nunca expõe notas internas, id do
 * atendente, metadados de IA nem de canal.
 */
export interface VisitorMessage {
  id: string;
  from: 'visitor' | 'bot' | 'agent' | 'system';
  kind: string;
  text: string | null;
  attachments: Array<{ name: string; mime: string; size: number; path: string }>;
  at: string;
}

const FROM: Record<string, VisitorMessage['from']> = { CONTACT: 'visitor', BOT: 'bot', AGENT: 'agent', SYSTEM: 'system' };

/** null = mensagem que o visitante não deve ver (nota interna, evento, direção INTERNAL). */
export function toVisitorView(m: PlainMessage): VisitorMessage | null {
  if (m.direction === 'INTERNAL' || m.kind === 'NOTE' || m.kind === 'EVENT') return null;
  const raw = Array.isArray(m.attachments) ? (m.attachments as any[]) : [];
  return {
    id: m.id,
    from: FROM[m.senderType] ?? 'system',
    kind: m.kind,
    text: m.body,
    attachments: raw
      .filter((a) => a && typeof a === 'object' && typeof a.key === 'string')
      .map((a, i) => ({ name: String(a.name ?? 'arquivo').slice(0, 120), mime: String(a.mime ?? 'application/octet-stream'), size: Number(a.size) || 0, path: `attachments/${m.id}/${i}` })),
    at: m.createdAt.toISOString(),
  };
}

export const toVisitorViews = (list: PlainMessage[]): VisitorMessage[] => list.map(toVisitorView).filter((x): x is VisitorMessage => x !== null);

// ── Sanitização de entrada (texto puro) ──────────────────────────────────────
// Remove controles C0/C1 (exceto \n e \t), BOM e caracteres bidi de sobreposição (spoofing de texto).
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿]/g;

export function cleanText(s: string): string {
  return s.normalize('NFC').replace(/\r\n?/g, '\n').replace(BAD_CHARS, '').trim();
}

/** Nome/rótulos de uma linha: sem quebras, sem < > e com espaços normalizados. */
export function cleanLine(s: string, max = 80): string {
  return cleanText(s).replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, max);
}

export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const c = cleanLine(base, 120).replace(/[^\p{L}\p{N}._ -]/gu, '_');
  return c && c !== '.' && c !== '..' ? c : 'arquivo';
}
