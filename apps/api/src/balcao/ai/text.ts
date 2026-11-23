/**
 * Utilitários de texto (português) usados por busca, curadoria e detecção de intenção:
 * normalização, tokenização, "stemming" leve (só para similaridade — a busca FTS usa o snowball do Postgres),
 * Jaccard e similaridade de cosseno com TF-IDF. Sem embeddings (decisão D9).
 */

/** minúsculas, sem acentos, pontuação vira espaço, espaços colapsados. */
export function normalizeText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set((
  'a o as os um uma uns umas de do da dos das em no na nos nas num numa por para pra pro com sem sobre ate entre e ou mas que se como quando onde ' +
  'qual quais quem eu voce voces vc vcs tu ele ela eles elas nos me te lhe meu minha meus minhas seu sua seus suas ao aos pelo pela pelos pelas ' +
  'ja nao sim favor gostaria gostaria preciso precisava quero queria posso pode podem podia poderia ser sou foi era estar esta estou estao ter tem tenho ' +
  'ha isso isto esse essa esses essas este aquele aquela aqui ali la mais menos muito muita bem bom boa dia tarde noite ola oi obrigado obrigada ' +
  'fazer faco faz fazem saber sobre algum alguma alguem tipo coisa so tambem mesmo ainda ai ne eh pois entao'
).split(/\s+/));

export function isStopword(w: string): boolean { return STOPWORDS.has(w); }

/** Redução leve de sufixos (plural, verbal, -ção). Só para comparar textos entre si. */
export function lightStem(w: string): string {
  if (w.length <= 3) return w;
  let s = w.replace(/(coes|oes|aes)$/, 'ao');
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) s = s.slice(0, -1);
  const m = s.match(/^(.{3,}?)(ando|endo|indo|ados|idos|ado|ido|ar|er|ir|ou|am)$/);
  if (m) s = m[1];
  if (s.length > 4 && /[aeo]$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Tokens significativos (sem stopwords, com stemming leve, únicos). */
export function tokenize(s: string, opts: { stem?: boolean; minLen?: number } = {}): string[] {
  const { stem = true, minLen = 2 } = opts;
  const out = new Set<string>();
  for (const w of normalizeText(s).split(' ')) {
    if (w.length < minLen || STOPWORDS.has(w)) continue;
    out.add(stem ? lightStem(w) : w);
  }
  return [...out];
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a); const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export type Vec = Map<string, number>;

/** IDF suavizado sobre um corpus de documentos já tokenizados. */
export function buildIdf(docs: string[][]): (t: string) => number {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return (t) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
}

export function tfidfVec(tokens: string[], idf: (t: string) => number): Vec {
  const v: Vec = new Map();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + idf(t));
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0; let na = 0; let nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [, x] of b) nb += x * x;
  for (const [k, x] of a) { const y = b.get(k); if (y) dot += x * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** snake_case ASCII curto para intenções/categorias vindas do LLM. */
export function slug(s: string, max = 60): string {
  return normalizeText(s).replace(/\s+/g, '_').slice(0, max);
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Estimativa grosseira de tokens quando o provedor não informa (≈ 4 caracteres/token). */
export const estimateTokens = (s: string) => Math.ceil((s ?? '').length / 4);
