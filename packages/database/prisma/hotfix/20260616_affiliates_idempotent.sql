-- ════════════════════════════════════════════════════════════════════════════
-- HOTFIX IDEMPOTENTE — Programa de Afiliados + DemoLead
-- ════════════════════════════════════════════════════════════════════════════
-- Equivalente a prisma/migrations/20260616_affiliates/migration.sql, porém
-- 100% re-executável: tabelas e índices com IF NOT EXISTS, e FKs guardadas
-- por blocos DO (Postgres não aceita IF NOT EXISTS em ADD CONSTRAINT).
--
-- Causa: a migração foi registrada em _prisma_migrations como aplicada, mas os
-- comandos DDL não rodaram em produção (mesmo padrão de outages anteriores),
-- derrubando /auth/me, /affiliates/* e o registro de leads da demo.
--
-- COMO USAR: cole tudo no Supabase → SQL Editor → Run. Seguro rodar quantas
-- vezes precisar. NÃO mexe em _prisma_migrations (se já consta como aplicada,
-- o migrate deploy futuro a ignora — e as tabelas já existirão).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Affiliate ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Affiliate" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "code"           TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "commissionType" TEXT NOT NULL DEFAULT 'recurring',
    "pixKey"         TEXT,
    "pixKeyType"     TEXT,
    "payoutName"     TEXT,
    "audience"       TEXT,
    "notes"          TEXT,
    "rejectedReason" TEXT,
    "appliedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"     TIMESTAMP(3),
    "approvedBy"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_userId_key" ON "Affiliate"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_code_key"   ON "Affiliate"("code");
CREATE INDEX        IF NOT EXISTS "Affiliate_status_idx" ON "Affiliate"("status");
CREATE INDEX        IF NOT EXISTS "Affiliate_code_idx"   ON "Affiliate"("code");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_userId_fkey') THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── AffiliateReferral ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AffiliateReferral" (
    "id"             TEXT NOT NULL,
    "affiliateId"    TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "convertedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateReferral_referredUserId_key" ON "AffiliateReferral"("referredUserId");
CREATE INDEX        IF NOT EXISTS "AffiliateReferral_affiliateId_idx"    ON "AffiliateReferral"("affiliateId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_affiliateId_fkey') THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_referredUserId_fkey') THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_referredUserId_fkey"
      FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── AffiliateCommission ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AffiliateCommission" (
    "id"               TEXT NOT NULL,
    "affiliateId"      TEXT NOT NULL,
    "referredUserId"   TEXT NOT NULL,
    "paymentId"        TEXT NOT NULL,
    "saleAmount"       DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "commissionType"   TEXT NOT NULL,
    "monthIndex"       INTEGER NOT NULL DEFAULT 1,
    "status"           TEXT NOT NULL DEFAULT 'pending',
    "paidAt"           TIMESTAMP(3),
    "paidReference"    TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateCommission_paymentId_affiliateId_key" ON "AffiliateCommission"("paymentId", "affiliateId");
CREATE INDEX        IF NOT EXISTS "AffiliateCommission_affiliateId_status_idx"     ON "AffiliateCommission"("affiliateId", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCommission_affiliateId_fkey') THEN
    ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── DemoLead ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DemoLead" (
    "id"          TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "ip"          TEXT,
    "durationSec" DOUBLE PRECISION,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DemoLead_email_idx"     ON "DemoLead"("email");
CREATE INDEX IF NOT EXISTS "DemoLead_createdAt_idx" ON "DemoLead"("createdAt");

-- ── Conferência (opcional) ───────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('Affiliate','AffiliateReferral','AffiliateCommission','DemoLead')
--   ORDER BY table_name;
