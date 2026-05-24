-- Migration: 20260524_admin_features
-- Adiciona modelos para: uptime logs, NPS, alert config

-- #6 ServiceStatusLog — histórico de saúde dos serviços
CREATE TABLE "ServiceStatusLog" (
  id          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service     TEXT NOT NULL,
  status      TEXT NOT NULL,
  "latencyMs" INTEGER,
  "checkedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ServiceStatusLog_service_checkedAt_idx" ON "ServiceStatusLog"(service, "checkedAt");

-- #10 NpsResponse — feedback NPS dos usuários
CREATE TABLE "NpsResponse" (
  id          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT NOT NULL,
  score       INTEGER NOT NULL,
  comment     TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "NpsResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "NpsResponse_createdAt_idx" ON "NpsResponse"("createdAt");
CREATE INDEX "NpsResponse_userId_idx"    ON "NpsResponse"("userId");

-- #4 AdminAlertConfig — thresholds de alertas automáticos
CREATE TABLE "AdminAlertConfig" (
  id          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: valores padrão dos alertas
INSERT INTO "AdminAlertConfig" (id, key, value, "updatedAt") VALUES
  (gen_random_uuid()::text, 'queueMaxWaiting', '20'::jsonb,   now()),
  (gen_random_uuid()::text, 'errorRatePct',    '10'::jsonb,   now()),
  (gen_random_uuid()::text, 'alertPhone',       'null'::jsonb, now()),
  (gen_random_uuid()::text, 'alertEmail',       'null'::jsonb, now());
