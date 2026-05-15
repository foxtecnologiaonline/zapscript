import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Supabase PgBouncer: prepared statements causam "prepared statement does not exist"
// em modo transação. Força ?pgbouncer=true se não estiver no DATABASE_URL.
function buildDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (url.includes('pgbouncer=true')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}pgbouncer=true`;
}

export const prisma =
  global.__prisma ||
  new PrismaClient({ datasourceUrl: buildDatasourceUrl(), log: ['error'] });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
