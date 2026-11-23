import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decryptField, isEncrypted, encryptField } from '../core/crypto';

/**
 * Rotação de chaves de campo (core/crypto): recifra, em lotes, as colunas cifradas com a chave ATUAL
 * (BV_FIELD_KEY_CURRENT). Idempotente (o que já usa a chave atual não é tocado) e retomável (cada lote é
 * confirmado separadamente; basta chamar de novo). Valores legados sem prefixo `bv1.` também são cifrados.
 */
export interface FieldColumn { table: string; model: string; column: string; delegate: string }

export const FIELD_COLUMNS: FieldColumn[] = [
  { table: 'BvMessage', model: 'bvMessage', column: 'body', delegate: 'bvMessage' },
  { table: 'BvContact', model: 'bvContact', column: 'documentEnc', delegate: 'bvContact' },
  { table: 'BvUser', model: 'bvUser', column: 'totpSecretEnc', delegate: 'bvUser' },
  { table: 'BvIntegration', model: 'bvIntegration', column: 'configEnc', delegate: 'bvIntegration' },
];

/** kid da chave atual conforme o ambiente (mesma regra de core/crypto.ts, sem expor o material). */
export function currentKid(): string {
  const probe = encryptField('kid-probe');
  return probe.split('.')[1];
}

export interface RotateOptions { orgId?: string; batchSize?: number; maxRows?: number; tables?: string[] }
export interface RotateTableResult { table: string; column: string; rotated: number; skipped: number; failed: number; remaining: number }
export interface RotateResult { currentKid: string; tables: RotateTableResult[]; rotated: number; failed: number; remaining: number; done: boolean }

const notCurrent = (col: string, kid: string, orgId?: string): any => ({
  ...(orgId ? { orgId } : {}),
  [col]: { not: null },
  NOT: { [col]: { startsWith: `bv1.${kid}.` } },
});

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
      const rows: Array<{ id: string } & Record<string, string>> = await dl.findMany({
        where: notCurrent(c.column, kid, opts.orgId),
        select: { id: true, [c.column]: true },
        orderBy: { id: 'asc' }, take: Math.min(batchSize, budget),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      for (const row of rows) {
        const old = row[c.column];
        try {
          const next = isEncrypted(old) ? encryptField(decryptField(old)) : encryptField(old);
          // otimista: só grava se o valor não mudou desde a leitura (evita sobrescrever escrita concorrente)
          const res = await dl.updateMany({ where: { id: row.id, [c.column]: old }, data: { [c.column]: next } });
          if (res.count) { r.rotated++; budget--; } else r.skipped++;
        } catch {
          r.failed++; failedIds.add(row.id); // não loga valor nem chave
        }
      }
      cursor = rows[rows.length - 1].id; // avança por id: linhas com falha não prendem o laço
    }
    r.remaining = await dl.count({ where: notCurrent(c.column, kid, opts.orgId) });
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
    const rows = await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>(Prisma.sql`
      SELECT CASE WHEN ${Prisma.raw(`"${c.column}"`)} LIKE 'bv1.%' THEN split_part(${Prisma.raw(`"${c.column}"`)}, '.', 2) ELSE '_plain' END AS kid, count(*) AS n
      FROM ${Prisma.raw(`"${c.table}"`)} WHERE ${Prisma.raw(`"${c.column}"`)} IS NOT NULL ${filter} GROUP BY 1`);
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
