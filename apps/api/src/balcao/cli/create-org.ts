/**
 * CLI — cria um órgão do Balcão Virtual e seu primeiro ADMIN. Idempotente (reexecutar não duplica nada).
 *
 *   cd apps/api
 *   BV_ADMIN_PASSWORD='SenhaForte12345' npx ts-node src/balcao/cli/create-org.ts \
 *       --name "TJTO" --slug tjto --admin-email admin@tjto.jus.br [--admin-name "Administrador"] [--reset-password]
 *
 * Lê DATABASE_URL do ambiente. A senha vem de --admin-password ou da env BV_ADMIN_PASSWORD (prefira a env:
 * argumentos aparecem na lista de processos). Política: >= 12 caracteres, com letras e números.
 */
import { prisma } from '../../lib/prisma';
import { createOrgWithAdmin, IamError } from '../iam/service';

const USAGE = `Uso: ts-node src/balcao/cli/create-org.ts --name <nome> --slug <slug> --admin-email <email> [--admin-name <nome>] [--admin-password <senha>] [--reset-password]
  A senha também pode vir de BV_ADMIN_PASSWORD. --reset-password redefine a senha se o administrador já existir.`;

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || args.h) { log(USAGE); return 0; }
  if (!env.DATABASE_URL) { log('Erro: defina DATABASE_URL.'); return 2; }
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
  const name = str('name'), slug = str('slug'), adminEmail = str('admin-email');
  const adminPassword = str('admin-password') ?? env.BV_ADMIN_PASSWORD;
  if (!name || !slug || !adminEmail || !adminPassword) { log(`Erro: faltam parâmetros (--name, --slug, --admin-email e senha via --admin-password ou BV_ADMIN_PASSWORD).\n${USAGE}`); return 2; }
  try {
    const r = await createOrgWithAdmin({ name, slug, adminEmail, adminPassword, adminName: str('admin-name'), resetAdminPassword: args['reset-password'] === true });
    log(`Órgão "${slug}": ${r.orgCreated ? 'criado' : 'já existia'} (id ${r.orgId}).`);
    log(`Administrador ${adminEmail}: ${r.adminCreated ? 'criado' : 'já existia'}${r.adminPasswordSet ? ' (senha definida)' : r.adminCreated ? '' : ' (senha mantida; use --reset-password para redefinir)'}.`);
    return 0;
  } catch (e) {
    if (e instanceof IamError) { log(`Erro: ${e.message}`); return 1; }
    throw e;
  }
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => prisma.$disconnect().finally(() => process.exit(code)))
    .catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => undefined); process.exit(1); });
}
