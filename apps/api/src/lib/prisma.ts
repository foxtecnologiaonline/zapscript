import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: any;
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

// ── Alerta de query lenta ────────────────────────────────────────────────────
// Qualquer query (ORM ou $queryRaw/$executeRaw) que passe de 5s vira: log,
// linha em SystemError (aparece em /admin/errors) e — no máximo 1x a cada 5min,
// pra não virar spam num pico — um WhatsApp pro admin (mesmo canal já usado
// pelo health-monitor: ADMIN_NOTIFY_PHONE + ADMIN_INSTANCE_NAME).
const SLOW_QUERY_MS = 5000;
const SLOW_QUERY_NOTIFY_COOLDOWN_SEC = 5 * 60;

async function reportSlowQuery(label: string, durationMs: number): Promise<void> {
  logger.warn(`[DB] Query lenta: ${label} levou ${Math.round(durationMs)}ms (limite ${SLOW_QUERY_MS}ms)`);

  await prisma.systemError.create({
    data: {
      service: 'db-slow-query',
      message: `Query lenta: ${label} (${Math.round(durationMs)}ms)`,
    },
  }).catch(() => null);

  try {
    // Import dinâmico: services/queue e services/evolution acabam importando
    // este próprio módulo (prisma) — import estático aqui criaria ciclo.
    const { redis } = await import('../services/queue');
    const canNotify = await redis.set(
      'slowquery:notify:lastSent', '1', 'EX', SLOW_QUERY_NOTIFY_COOLDOWN_SEC, 'NX',
    );
    if (!canNotify) return; // já notificou recentemente — evita flood em pico

    const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
    const adminInstanceName = process.env.ADMIN_INSTANCE_NAME;
    if (!adminPhone || !adminInstanceName) return;

    const number = await prisma.whatsappNumber.findFirst({
      where:  { zapiInstanceId: adminInstanceName, status: 'connected' },
      select: { zapiInstanceId: true },
    });
    if (!number) return;

    const { sendText } = await import('../services/evolution');
    await sendText(
      number.zapiInstanceId,
      adminPhone,
      `🔴 *ZapScript — Query lenta no banco*\n` +
      `${label}: ${(durationMs / 1000).toFixed(1)}s (limite: ${SLOW_QUERY_MS / 1000}s)\n` +
      `📅 ${new Date().toLocaleString('pt-BR')}`,
    );
  } catch (e: any) {
    logger.warn(`[DB] Falha ao notificar admin sobre query lenta: ${e.message}`);
  }
}

function createPrismaClient() {
  const base = new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error', 'warn'],
    errorFormat: 'pretty',
  });

  return base.$extends({
    name: 'slow-query-alert',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: any; query: (args: any) => Promise<any> }) {
          const start = Date.now();
          const result = await query(args);
          const duration = Date.now() - start;
          if (duration > SLOW_QUERY_MS) reportSlowQuery(`${model}.${operation}`, duration).catch(() => null);
          return result;
        },
      },
      async $queryRaw({ args, query }: { args: any; query: (args: any) => Promise<any> }) {
        const start = Date.now();
        const result = await query(args);
        const duration = Date.now() - start;
        if (duration > SLOW_QUERY_MS) reportSlowQuery('$queryRaw', duration).catch(() => null);
        return result;
      },
      async $executeRaw({ args, query }: { args: any; query: (args: any) => Promise<any> }) {
        const start = Date.now();
        const result = await query(args);
        const duration = Date.now() - start;
        if (duration > SLOW_QUERY_MS) reportSlowQuery('$executeRaw', duration).catch(() => null);
        return result;
      },
    },
  });
}

export const prisma = global.__prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
