import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// ── Connection pool hint ────────────────────────────────────────────────────────
// Para Supabase em produção, use o URL do PgBouncer (porta 6543) com:
//   DATABASE_URL="postgres://...@aws-0-xxx.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
// Isso evita esgotamento de conexões com 500 usuários simultâneos.
if (process.env.NODE_ENV === 'production') {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && !dbUrl.includes('pgbouncer') && !dbUrl.includes('connection_limit')) {
    console.warn(
      '[Prisma] ⚠️  DATABASE_URL não usa PgBouncer. ' +
      'Para escala, use a URL do pooler Supabase (porta 6543) com ?pgbouncer=true&connection_limit=10'
    );
  }
}

export const prisma =
  global.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error', 'warn'],
    errorFormat: 'pretty',
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
