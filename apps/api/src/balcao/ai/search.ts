import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isStopword, lightStem, normalizeText } from './text';

/**
 * Busca na base de conhecimento (só artigos APPROVED, sempre filtrada por órgão).
 *  1) websearch_to_tsquery('portuguese', q) + ts_rank_cd  — FTS com stemming/stopwords do Postgres
 *  2) tsquery OR (qualquer termo)                           — perguntas em linguagem natural
 *  3) fallback acento-insensível por termos (LIKE)          — o dicionário `portuguese` não remove acentos
 */
export interface KbHit {
  id: string; title: string; question: string; answer: string; category: string | null; tags: string[];
  /** FTS: ts_rank_cd; fallback LIKE: fração de termos encontrados (0–1). */
  rank: number;
  via: 'fts' | 'any' | 'like';
}

const ACCENTS_FROM = 'áàâãäéèêëíìîïóòôõöúùûüç';
const ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuuc';

/** Termos "lexema" para a tsquery OR: letras/dígitos originais (mantém acentos p/ o stemmer), sem stopwords. */
function lexemes(q: string): string[] {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !isStopword(normalizeText(w)));
  return [...new Set(words)].slice(0, 24);
}

/** Termos acento-insensíveis e com stemming leve para o fallback LIKE. */
function likeTerms(q: string): string[] {
  const out = new Set<string>();
  for (const w of normalizeText(q).split(' ')) {
    if (w.length < 3 || isStopword(w)) continue;
    const s = lightStem(w);
    out.add(s.length >= 3 ? s : w);
  }
  return [...out].slice(0, 24);
}

const COLS = Prisma.sql`a.id, a.title, a.question, a.answer, a.category, a.tags`;

function mapRows(rows: any[], via: KbHit['via']): KbHit[] {
  return rows.map((r) => ({ id: r.id, title: r.title, question: r.question, answer: r.answer, category: r.category, tags: r.tags ?? [], rank: Number(r.rank), via }));
}

export interface SearchOptions {
  limit?: number;
  /** 'web' = websearch_to_tsquery primeiro (endpoint /kb/search); 'any' = OR primeiro (bot, perguntas longas). */
  first?: 'web' | 'any';
}

export async function searchKb(orgId: string, q: string, opts: SearchOptions = {}): Promise<KbHit[]> {
  const text = (q ?? '').trim().slice(0, 500);
  if (!text) return [];
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);

  const web = async (): Promise<KbHit[]> => mapRows(await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT ${COLS}, ts_rank_cd(a.search, qq.query) AS rank
    FROM "BvKbArticle" a, websearch_to_tsquery('portuguese', ${text}) AS qq(query)
    WHERE a."orgId" = ${orgId} AND a.status = 'APPROVED' AND a.search @@ qq.query
    ORDER BY rank DESC, a."helpfulCount" DESC, a."updatedAt" DESC LIMIT ${limit}`), 'fts');

  const any = async (): Promise<KbHit[]> => {
    const lx = lexemes(text);
    if (!lx.length) return [];
    return mapRows(await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT ${COLS}, ts_rank_cd(a.search, qq.query) AS rank
      FROM "BvKbArticle" a, to_tsquery('portuguese', ${lx.join(' | ')}) AS qq(query)
      WHERE a."orgId" = ${orgId} AND a.status = 'APPROVED' AND a.search @@ qq.query
      ORDER BY rank DESC, a."helpfulCount" DESC, a."updatedAt" DESC LIMIT ${limit}`), 'any');
  };

  const like = async (): Promise<KbHit[]> => {
    const terms = likeTerms(text);
    if (!terms.length) return [];
    const hay = Prisma.sql`translate(lower(a.title || ' ' || a.question || ' ' || a.answer || ' ' || array_to_string(a.tags, ' ')), ${ACCENTS_FROM}, ${ACCENTS_TO})`;
    const score = Prisma.join(terms.map((t) => Prisma.sql`(CASE WHEN strpos(${hay}, ${t}) > 0 THEN 1 ELSE 0 END)`), ' + ');
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM (
        SELECT ${COLS}, (${score})::float / ${terms.length} AS rank
        FROM "BvKbArticle" a WHERE a."orgId" = ${orgId} AND a.status = 'APPROVED'
      ) s WHERE s.rank > 0 ORDER BY s.rank DESC LIMIT ${limit}`);
    return mapRows(rows, 'like');
  };

  const order = opts.first === 'any' ? [any, like] : [web, any, like];
  for (const step of order) {
    try {
      const hits = await step();
      if (hits.length) return hits;
    } catch (err: any) {
      // tsquery inválida não pode derrubar o atendimento: segue para o próximo método
      if (!/tsquery|syntax/i.test(String(err?.message))) throw err;
    }
  }
  return [];
}
