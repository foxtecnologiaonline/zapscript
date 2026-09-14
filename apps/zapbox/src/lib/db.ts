import { PrismaClient } from 'zapbox-db';

declare global {
  // eslint-disable-next-line no-var
  var __zapboxPrisma: PrismaClient | undefined;
}

// Evita esgotar conexões no hot-reload do Next.js em dev (padrão recomendado pela Prisma).
export const db = global.__zapboxPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__zapboxPrisma = db;
