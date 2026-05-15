import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// ── PgBouncer compatibility ─────────────────────────────────────────────────────
// Supabase usa PgBouncer em modo transação (porta 6543). Prisma usa prepared
// statements por padrão, o que causa "prepared statement does not exist" (PG-26000)
// quando conexões são reutilizadas pelo pool. A flag ?pgbouncer=true desativa isso.
//
// Garantimos aqui em código: se o DATABASE_URL não incluir a flag, adicionamos.
// Isso evita que um env var mal configurado derrube o dashboard em produção.
function buildDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (url.includes('pgbouncer=true')) return url; // já OK

  const separator = url.includes('?') ? '&' : '?';
  const patched = `${url}${separator}pgbouncer=true`;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Prisma] ⚠️  DATABASE_URL sem ?pgbouncer=true — adicionado automaticamente. ' +
      'Adicione ?pgbouncer=true à URL do pooler Supabase (porta 6543) no Render para remover este aviso.'
    );
  }
  return patched;
}

const datasourceUrl = buildDatasourceUrl();

export const prisma =
  global.__prisma ||
  new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error', 'warn'],
    errorFormat: 'pretty',
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
