-- Migration: Índices de performance — auditoria 2026-05-31
-- Aplicar no Supabase SQL Editor

-- Transcription: listagem e ordenação por usuário (hot path em toda API)
CREATE INDEX IF NOT EXISTS "Transcription_userId_idx"
  ON "Transcription"("userId");

CREATE INDEX IF NOT EXISTS "Transcription_userId_createdAt_idx"
  ON "Transcription"("userId", "createdAt" DESC);

-- WhatsappNumber: listagem de números por usuário + busca por instância Evolution (webhook hot path)
CREATE INDEX IF NOT EXISTS "WhatsappNumber_userId_idx"
  ON "WhatsappNumber"("userId");

CREATE INDEX IF NOT EXISTS "WhatsappNumber_zapiInstanceId_idx"
  ON "WhatsappNumber"("zapiInstanceId");

-- UsageLog: aggregations de consumo por usuário e por período
CREATE INDEX IF NOT EXISTS "UsageLog_userId_idx"
  ON "UsageLog"("userId");

CREATE INDEX IF NOT EXISTS "UsageLog_createdAt_idx"
  ON "UsageLog"("createdAt");
