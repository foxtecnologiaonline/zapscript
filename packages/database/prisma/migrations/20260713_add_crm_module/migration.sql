-- Módulo CRM — funil de vendas dentro do WhatsApp (ver MODULOS_ARQUITETURA.md).
-- Puramente aditivo: 3 tabelas novas, nenhuma coluna/tabela existente é tocada.
-- Escrita à mão (não gerada por `prisma migrate dev`, indisponível neste ambiente)
-- e guardada com IF NOT EXISTS / duplicate_object para poder ser reaplicada com
-- segurança caso a migração seja repetida manualmente (ver incidentes de
-- migrate não aplicado em produção — MODULOS_ARQUITETURA.md / runbook de deploy).

-- CreateTable
CREATE TABLE IF NOT EXISTS "CrmStage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CrmContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "value" DOUBLE PRECISION,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numberId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lostReason" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CrmActivity" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmStage_userId_order_idx" ON "CrmStage"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CrmContact_userId_phone_key" ON "CrmContact"("userId", "phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmContact_userId_stageId_idx" ON "CrmContact"("userId", "stageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmContact_userId_lastActivityAt_idx" ON "CrmContact"("userId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmActivity_contactId_createdAt_idx" ON "CrmActivity"("contactId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmActivity_userId_dueAt_idx" ON "CrmActivity"("userId", "dueAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
