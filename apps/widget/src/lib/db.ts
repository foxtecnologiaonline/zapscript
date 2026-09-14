import { PrismaClient } from 'widget-db';

declare global {
  // eslint-disable-next-line no-var
  var __widgetPrisma: PrismaClient | undefined;
}

// Evita esgotar conexões no hot-reload do Next.js em dev (padrão recomendado pela Prisma).
export const db = global.__widgetPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__widgetPrisma = db;
