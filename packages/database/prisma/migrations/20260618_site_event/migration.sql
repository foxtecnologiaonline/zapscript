-- Analytics first-party: tabela de eventos do site (visitas e cliques de CTA).
-- Idempotente (IF NOT EXISTS) por causa do histórico de drift de migração em prod.

CREATE TABLE IF NOT EXISTS "SiteEvent" (
  "id"          TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "path"        TEXT NOT NULL,
  "name"        TEXT,
  "visitorId"   TEXT,
  "referrer"    TEXT,
  "device"      TEXT,
  "country"     TEXT,
  "region"      TEXT,
  "city"        TEXT,
  "utmSource"   TEXT,
  "utmMedium"   TEXT,
  "utmCampaign" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SiteEvent_type_createdAt_idx" ON "SiteEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "SiteEvent_createdAt_idx"      ON "SiteEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "SiteEvent_path_idx"           ON "SiteEvent"("path");
CREATE INDEX IF NOT EXISTS "SiteEvent_country_idx"        ON "SiteEvent"("country");
CREATE INDEX IF NOT EXISTS "SiteEvent_visitorId_idx"      ON "SiteEvent"("visitorId");
