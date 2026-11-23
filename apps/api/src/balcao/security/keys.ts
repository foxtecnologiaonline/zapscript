import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decryptField, isEncrypted, encryptField } from '../core/crypto';

/**
 * Rotação de chaves de campo (core/crypto): recifra, em lotes, as colunas cifradas com a chave ATUAL
 * (BV_FIELD_KEY_CURRENT). Idempotente (o que já usa a chave atual não é tocado) e retomável (cada lote é
 * confirmado separadamente; basta chamar de novo). Valores legados sem prefixo `bv1.` também são cifrados.
 */
export interface FieldColumn {
  table: string; model: string; column: string; delegate: string;
  /** Coluna Json que guarda o valor cifrado em `data[path]` (apenas linhas com `type`). Ex.: BvConversationEvent AI_SUGGESTION. */
  json?: { path: string; type: string };
}

export const FIELD_COLUMNS: FieldColumn[] = [
  { table: 'BvMessage', model: 'bvMessage', column: 'body', delegate: 'bvMessage' },
  { table: 'BvContact', model: 'bvContact', column: 'documentEnc', delegate: 'bvContact' },
  { table: 'BvUser', model: 'bvUser', column: 'totpSecretEnc', delegate: 'bvUser' },
  { table: 'BvIntegration', model: 'bvIntegration', column: 'configEnc', delegate: 'bvIntegration' },
  // sugestões de IA (ai/bot.ts e ai/assist.ts) guardam o texto cifrado dentro do JSON do evento
  { table: 'BvConversationEvent', model: 'bvConversationEvent', column: 'data', delegate: 'bvConversationEvent', json: { path: 'textEnc', type: 'AI_SUGGESTION' } },
];

/** kid da chave atual conforme o ambiente (mesma regra de core/crypto.ts, sem expor o material). */
export function currentKid(): string {
  const probe = encryptField('kid-probe');
  return probe.split('.')[1];
}

export interface RotateOptions { orgId?: string; batchSize?: number; maxRows?: number; tables?: string[] }
export interface RotateTableResult { table: string; column: string; rotated: number; skipped: number; failed: number; remaining: number }
export interface RotateResult { currentKid: string; tables: RotateTableResult[]; rotated: number; failed: number; remaining: number; done: boolean }

const notCurrent = (c: FieldColumn, kid: string, orgId?: string): any => c.json
  ? {
    ...(orgId ? { orgId } : {}), type: c.json.type,
    NOT: { data: { path: [c.json.path], string_starts_with: `bv1.${kid}.` } },
  }
  : { ...(orgId ? { orgId } : {}), [c.column]: { not: null }, NOT: { [c.column]: { startsWith: `bv1.${kid}.` } } };

/** Valor cifrado da linha (coluna texto ou chave dentro do JSON) e o `data` que o substitui. */
const readEnc = (c: FieldColumn, row: any): string | null => { const v = c.json ? row.data?.[c.json.path] : row[c.column]; return typeof v === 'string' ? v : null; };
const writeWhere = (c: FieldColumn, id: string, old: string): any => (c.json ? { id, data: { path: [c.json.path], equals: old } } : { id, [c.column]: old });
const writeData = (c: FieldColumn, row: any, next: string): any => (c.json ? { data: { ...row.data, [c.json.path]: next } } : { [c.column]: next });

export async function rotateFieldKeys(opts: RotateOptions = {}): Promise<RotateResult> {
  const kid = currentKid();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 1000);
  let budget = opts.maxRows ?? Number.POSITIVE_INFINITY;
  const out: RotateTableResult[] = [];

  for (const c of FIELD_COLUMNS) {
    if (opts.tables && !opts.tables.includes(c.table)) continue;
    const dl = (prisma as any)[c.delegate];
    const r: RotateTableResult = { table: c.table, column: c.column, rotated: 0, skipped: 0, failed: 0, remaining: 0 };
    const failedIds = new Set<string>();
    let cursor: string | undefined;
    while (budget > 0) {
      const rows: Array<{ id: string } & Record<string, any>> = await dl.findMany({
        where: { ...notCurrent(c, kid, opts.orgId), ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, [c.column]: true },
        orderBy: { id: 'asc' }, take: Math.min(batchSize, budget),
      });
      if (!rows.length) break;
      for (const row of rows) {
        const old = readEnc(c, row);
        if (old === null) { r.skipped++; continue; }
        try {
          const next = isEncrypted(old) ? encryptField(decryptField(old)) : encryptField(old);
          // otimista: só grava se o valor não mudou desde a leitura (evita sobrescrever escrita concorrente)
          const res = await dl.updateMany({ where: writeWhere(c, row.id, old), data: writeData(c, row, next) });
          if (res.count) { r.rotated++; budget--; } else r.skipped++;
        } catch {
          r.failed++; failedIds.add(row.id); // não loga valor nem chave
        }
      }
      cursor = rows[rows.length - 1].id; // avança por id: linhas com falha não prendem o laço
    }
    r.remaining = await dl.count({ where: notCurrent(c, kid, opts.orgId) });
    out.push(r);
  }
  const remaining = out.reduce((a, t) => a + t.remaining, 0);
  return { currentKid: kid, tables: out, rotated: out.reduce((a, t) => a + t.rotated, 0), failed: out.reduce((a, t) => a + t.failed, 0), remaining, done: remaining === 0 };
}

export interface KeyUsage { table: string; column: string; byKid: Record<string, number>; plaintext: number; total: number }

/** Quantos registros usam cada kid, por coluna (apenas contagens — nunca material de chave). */
export async function keyStatus(orgId?: string): Promise<{ currentKid: string; knownKids: string[]; usage: KeyUsage[] }> {
  const usage: KeyUsage[] = [];
  for (const c of FIELD_COLUMNS) {
    const filter = orgId ? Prisma.sql`AND "orgId" = ${orgId}` : Prisma.empty;
    const expr = Prisma.raw(c.json ? `("${c.column}"->>'${c.json.path}')` : `"${c.column}"`);
    const typeFilter = c.json ? Prisma.sql`AND "type" = ${c.json.type}` : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>(Prisma.sql`
      SELECT CASE WHEN ${expr} LIKE 'bv1.%' THEN split_part(${expr}, '.', 2) ELSE '_plain' END AS kid, count(*) AS n
      FROM ${Prisma.raw(`"${c.table}"`)} WHERE ${expr} IS NOT NULL ${typeFilter} ${filter} GROUP BY 1`);
    const byKid: Record<string, number> = {};
    let plaintext = 0; let total = 0;
    for (const r of rows) {
      const n = Number(r.n); total += n;
      if (r.kid === '_plain') plaintext += n; else byKid[r.kid as string] = n;
    }
    usage.push({ table: c.table, column: c.column, byKid, plaintext, total });
  }
  let knownKids = ['0'];
  try {
    const parsed = process.env.BV_FIELD_KEYS ? Object.keys(JSON.parse(process.env.BV_FIELD_KEYS)) : [];
    knownKids = [...new Set(['0', ...parsed])].sort();
  } catch { /* BV_FIELD_KEYS inválida: o keyring do core já acusa */ }
  return { currentKid: currentKid(), knownKids, usage };
}
