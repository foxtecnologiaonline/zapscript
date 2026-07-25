-- AffiliateClick só existia em schema.prisma — nunca teve migration.sql própria,
-- então provavelmente nunca foi criada em produção. POST /click e GET /me
-- engolem esse erro silenciosamente (try/catch), então o rastreamento de
-- cliques do afiliado nunca funcionou de fato. Idempotente — ver MEMORY
-- incident_migrate_nao_aplica.
CREATE TABLE IF NOT EXISTS "AffiliateClick" (
    "id"          TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "ip"          TEXT,
    "userAgent"   TEXT,
    "referrer"    TEXT,
    "country"     TEXT,
    "converted"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AffiliateClick_affiliateId_createdAt_idx" ON "AffiliateClick"("affiliateId", "createdAt");
CREATE INDEX IF NOT EXISTS "AffiliateClick_code_createdAt_idx" ON "AffiliateClick"("code", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
