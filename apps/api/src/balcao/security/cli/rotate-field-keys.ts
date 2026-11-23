/**
 * CLI: recifra colunas cifradas com a chave atual (BV_FIELD_KEY_CURRENT).
 *
 *   # no servidor (container da API):
 *   node dist/balcao/security/cli/rotate-field-keys.js [--org <orgId>] [--batch 200] [--max 100000] [--status]
 *   # desenvolvimento:
 *   npx ts-node src/balcao/security/cli/rotate-field-keys.ts --status
 *
 * Procedimento completo: docs/balcao/api-security.md ("Rotação de chaves").
 * Saída: apenas contagens por tabela — nunca valores nem chaves. Código de saída 1 se sobrou registro ou houve falha.
 */
import { prisma } from '../../../lib/prisma';
import { audit } from '../../core/audit';
import { keyStatus, rotateFieldKeys } from '../keys';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = arg('org');
  if (process.argv.includes('--status')) {
    console.log(JSON.stringify(await keyStatus(orgId), null, 2));
    return 0;
  }
  const result = await rotateFieldKeys({ orgId, batchSize: arg('batch') ? Number(arg('batch')) : undefined, maxRows: arg('max') ? Number(arg('max')) : undefined });
  console.log(JSON.stringify(result, null, 2));
  const orgs = orgId ? [{ id: orgId }] : await prisma.bvOrg.findMany({ select: { id: true } });
  for (const o of orgs) await audit({ orgId: o.id, actorType: 'SYSTEM', action: 'security.keys.rotate', meta: { via: 'cli', currentKid: result.currentKid, rotated: result.rotated, failed: result.failed, remaining: result.remaining } });
  return result.done && result.failed === 0 ? 0 : 1;
}

main().then((c) => prisma.$disconnect().finally(() => process.exit(c)), (e) => { console.error('Falha:', e?.message ?? e); process.exit(2); });
