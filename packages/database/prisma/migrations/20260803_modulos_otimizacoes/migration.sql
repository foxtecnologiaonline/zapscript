-- Otimizações dos módulos Atende/CRM/Tarefas (revisão pós-lançamento do tier
-- Empresas). Puramente aditivo: novas colunas nullable + 2 tabelas novas.

-- Task: vínculo opcional com CRM
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
CREATE INDEX IF NOT EXISTS "Task_contactId_idx" ON "Task"("contactId");
DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TaskComment: colaboração leve dentro do time
CREATE TABLE IF NOT EXISTS "TaskComment" (
    "id"        TEXT NOT NULL,
    "taskId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CrmActivity: idempotência do aviso de lembrete vencido via WhatsApp
ALTER TABLE "CrmActivity" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3);

-- AiUsageLog: telemetria de custo de IA (Claude) por tenant no módulo Atende
CREATE TABLE IF NOT EXISTS "AiUsageLog" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "feature"      TEXT NOT NULL,
    "model"        TEXT NOT NULL,
    "inputTokens"  INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
