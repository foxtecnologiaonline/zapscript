-- Programa de Afiliados: configuração editável pelo admin (taxas, auto-aprovação,
-- relatório periódico), campanhas sazonais de bônus e taxa personalizada por
-- afiliado. Idempotente — ver MEMORY incident_migrate_nao_aplica.

CREATE TABLE IF NOT EXISTS "AffiliateConfig" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "value"     JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateConfig_key_key" ON "AffiliateConfig"("key");

CREATE TABLE IF NOT EXISTS "AffiliateCampaign" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "rate"      DOUBLE PRECISION NOT NULL,
    "startsAt"  TIMESTAMP(3) NOT NULL,
    "endsAt"    TIMESTAMP(3) NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AffiliateCampaign_active_startsAt_endsAt_idx" ON "AffiliateCampaign"("active", "startsAt", "endsAt");

ALTER TABLE "Affiliate" ADD COLUMN IF NOT EXISTS "customRate" DOUBLE PRECISION;
