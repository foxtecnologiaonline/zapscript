-- WhatsApp Cloud API oficial (Embedded Signup / Tech Provider)
-- Campos por número para coexistência dual-mode: 'evolution' (automação) | 'official' (Meta).
-- Aplicar SOMENTE no cutover — Render faz auto-deploy do master; aplicar via migrate:deploy
-- simultaneamente ao merge para evitar erro de coluna ausente nos SELECTs do Prisma.

ALTER TABLE "WhatsappNumber"
  ADD COLUMN IF NOT EXISTS "connectionType"  TEXT NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS "wabaId"          TEXT,
  ADD COLUMN IF NOT EXISTS "metaPhoneId"     TEXT,
  ADD COLUMN IF NOT EXISTS "metaAccessToken" TEXT;

CREATE INDEX IF NOT EXISTS "WhatsappNumber_metaPhoneId_idx"
  ON "WhatsappNumber" ("metaPhoneId");
