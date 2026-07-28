-- API pública ZapScript 2.0 (tier Empresas) — ver lib/apiKeyAuth.ts e
-- routes/apiKeys.ts / routes/publicApi.ts.
--
-- Puramente aditiva: 1 tabela nova, nenhuma coluna/tabela existente é tocada.
-- Escrita à mão (não gerada por `prisma migrate dev`, indisponível neste
-- ambiente) e guardada com IF NOT EXISTS para poder ser reaplicada com segurança.

CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "keyHash"    TEXT NOT NULL,
    "keyPrefix"  TEXT NOT NULL,
    "scopes"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");

DO $$ BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
