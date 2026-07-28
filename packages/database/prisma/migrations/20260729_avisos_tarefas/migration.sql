-- Avisos (tier Profissional) e Tarefas (tier Empresas) — revisão de tiers
-- ZapScript 2.0. Puramente aditivo: 2 tabelas novas, nenhuma existente é tocada.

CREATE TABLE IF NOT EXISTS "Aviso" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "numberId"     TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName"  TEXT,
    "category"     TEXT NOT NULL,
    "message"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aviso_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Aviso_userId_createdAt_idx" ON "Aviso"("userId", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Task" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "description"  TEXT,
    "assignedToId" TEXT,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "dueAt"        TIMESTAMP(3),
    "completedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Task_userId_status_idx" ON "Task"("userId", "status");
CREATE INDEX IF NOT EXISTS "Task_userId_dueAt_idx" ON "Task"("userId", "dueAt");

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
