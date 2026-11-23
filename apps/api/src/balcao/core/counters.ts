import { prisma } from '../../lib/prisma';

/** Contador atômico por (org, nome) — INSERT … ON CONFLICT DO UPDATE … RETURNING. */
export async function nextCounter(orgId: string, name: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "BvCounter" ("orgId", "name", "value") VALUES (${orgId}, ${name}, 1)
    ON CONFLICT ("orgId", "name") DO UPDATE SET "value" = "BvCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** Protocolo humano único por órgão: BV-2026-000123. */
export async function nextProtocol(orgId: string, prefix = 'BV', at = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  const n = await nextCounter(orgId, `protocol:${year}`);
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

export async function nextTaskCode(orgId: string): Promise<string> {
  return `TAR-${String(await nextCounter(orgId, 'task')).padStart(6, '0')}`;
}
