import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// ── PgBouncer compatibility ─────────────────────────────────────────────────────
// Supabase Pooler tem dois modos:
//   • Transaction mode — porta 6543 — requer ?pgbouncer=true (sem prepared statements)
//   • Session mode     — porta 5432 — compatível com Prisma nativo, conexões persistentes
//
// Para servidores persistentes (Fastify/Node long-running), session mode é preferível:
// mantém conexões abertas, elimina overhead de handshake por query, menor latência.
// Só adicionamos pgbouncer=true se a URL usar a porta 6543 (transaction mode).
function buildDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  // Session mode (porta 5432 no pooler ou direct): não precisa de pgbouncer=true
  const isSessionMode = !url.includes(':6543') && !url.includes('pgbouncer=true');
  if (isSessionMode) return url;

  // Transaction mode (porta 6543): garantir pgbouncer=true
  if (url.includes('pgbouncer=true')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}pgbouncer=true`;
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
