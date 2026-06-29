-- Migração: Freemium (Trial 7d) + métrica por áudios + rodapé condicional
-- Data: 2026-06-28
-- Idempotente (IF NOT EXISTS) para reaplicar com segurança em prod.

-- ── Plan: cota por áudios (métrica primária) ────────────────────────────────
ALTER TABLE "Plan"          ADD COLUMN IF NOT EXISTS "audiosPerMonth"   INTEGER NOT NULL DEFAULT 0;

-- ── Subscription: trial freemium ────────────────────────────────────────────
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialEndsAt"        TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialDowngradedAt"  TIMESTAMP(3);

-- ── MinuteBalance: contador de áudios do ciclo ──────────────────────────────
ALTER TABLE "MinuteBalance" ADD COLUMN IF NOT EXISTS "audiosUsed"        INTEGER NOT NULL DEFAULT 0;

-- ── Transcription: rastreio do rodapé exibido (B1 — conversão por variação) ──
ALTER TABLE "Transcription" ADD COLUMN IF NOT EXISTS "footerShown"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transcription" ADD COLUMN IF NOT EXISTS "footerVariant"     TEXT;

-- ── Tabela de seed do rodapé condicional (PRO Modo Privado) ─────────────────
CREATE TABLE IF NOT EXISTS "ProContactSeed" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "contactId"     TEXT NOT NULL,
  "footerVariant" TEXT,
  "firstSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProContactSeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProContactSeed_userId_contactId_key" ON "ProContactSeed"("userId", "contactId");
CREATE INDEX IF NOT EXISTS "ProContactSeed_userId_idx" ON "ProContactSeed"("userId");

-- FK com guarda (evita erro se reaplicar)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProContactSeed_userId_fkey'
  ) THEN
    ALTER TABLE "ProContactSeed"
      ADD CONSTRAINT "ProContactSeed_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Backfill de cota de áudios nos planos existentes ────────────────────────
-- FREE = 15 áudios/mês (parametrizável no app via FREE_AUDIO_QUOTA); PRO/Executive = 500 (teto oculto).
UPDATE "Plan" SET "audiosPerMonth" = 15  WHERE "name" = 'free'      AND "audiosPerMonth" = 0;
UPDATE "Plan" SET "audiosPerMonth" = 500 WHERE "name" IN ('pro','executive','ultra') AND "audiosPerMonth" = 0;
