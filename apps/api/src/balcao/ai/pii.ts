/**
 * Redação de dados pessoais ANTES de qualquer texto sair para um LLM (LGPD). Troca CPF, CNPJ, e-mail, telefone,
 * cartão e nº de processo CNJ por marcadores ([CPF_1], [PROCESSO_1]…) e guarda o mapa para "reidratar" os
 * parâmetros de ferramentas (ex.: a consulta e-Proc precisa do número real, mas o LLM nunca o vê).
 */

export type PiiKind = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'PROCESSO' | 'CARTAO';

const CNJ_RE = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
// +55 (63) 99999-9999 · (63) 3215-1234 · 63 99999 9999 · 99999-9999 · 3215-1234
const PHONE_RE = /(?<![\d])(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9[\s.-]?\d{4}|\d{4})[\s.-]?\d{4}(?![\d])/g;

function validCpf(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}
function validCnpj(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
function luhn(d: string): boolean {
  let sum = 0; let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export interface RedactOptions {
  /** Tipos que devem permanecer em claro (ex.: ['PROCESSO'] quando o texto vai a um sistema confiável). */
  keep?: PiiKind[];
}

/**
 * Redator com estado: o mesmo valor recebe sempre o mesmo marcador dentro do mesmo redator, e `map` permite
 * reidratar. Use UM redator por chamada ao LLM (mensagem atual + histórico).
 */
export class PiiRedactor {
  readonly map: Record<string, string> = {};
  readonly counts: Partial<Record<PiiKind, number>> = {};
  private byValue = new Map<string, string>();
  private n: Partial<Record<PiiKind, number>> = {};
  constructor(private opts: RedactOptions = {}) {}

  private mark(kind: PiiKind, value: string): string {
    const key = `${kind}:${value.replace(/\D/g, '') || value.toLowerCase()}`;
    const hit = this.byValue.get(key);
    if (hit) return hit;
    const i = (this.n[kind] = (this.n[kind] ?? 0) + 1);
    const tag = `[${kind}_${i}]`;
    this.byValue.set(key, tag); this.map[tag] = value;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return tag;
  }

  redact(text: string): string {
    if (!text) return text;
    const keep = new Set(this.opts.keep ?? []);
    let out = text;
    // ordem importa: padrões mais longos/específicos primeiro, para um não "comer" parte do outro
    if (!keep.has('PROCESSO')) out = out.replace(CNJ_RE, (m) => this.mark('PROCESSO', m));
    if (!keep.has('EMAIL')) out = out.replace(EMAIL_RE, (m) => this.mark('EMAIL', m));
    if (!keep.has('CNPJ')) out = out.replace(CNPJ_RE, (m) => (validCnpj(m.replace(/\D/g, '')) ? this.mark('CNPJ', m) : m));
    if (!keep.has('CPF')) out = out.replace(CPF_RE, (m) => (validCpf(m.replace(/\D/g, '')) || /[.-]/.test(m) ? this.mark('CPF', m) : m));
    if (!keep.has('CARTAO')) out = out.replace(CARD_RE, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d) ? this.mark('CARTAO', m) : m; });
    if (!keep.has('TELEFONE')) out = out.replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 8 ? this.mark('TELEFONE', m.trim()) : m));
    return out;
  }

  /** Reidrata marcadores em texto ou, recursivamente, em objetos/arrays (parâmetros de ferramenta). */
  rehydrate<T>(value: T): T {
    if (typeof value === 'string') {
      return value.replace(/\[(CPF|CNPJ|EMAIL|TELEFONE|PROCESSO|CARTAO)_\d+\]/g, (tag) => this.map[tag] ?? tag) as unknown as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.rehydrate(v)) as unknown as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.rehydrate(v)])) as T;
    }
    return value;
  }

  get found(): number { return Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0); }
}

/** Atalho sem estado: devolve só o texto redigido. */
export function redactPII(text: string, opts: RedactOptions = {}): string {
  return new PiiRedactor(opts).redact(text);
}
