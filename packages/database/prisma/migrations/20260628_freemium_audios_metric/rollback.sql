-- ROLLBACK da migração 20260628_freemium_audios_metric
-- Reverte colunas e tabela introduzidas. NÃO recupera dados de seed/contadores.
-- Rodar manualmente apenas se necessário reverter o deploy.

DROP TABLE IF EXISTS "ProContactSeed";

ALTER TABLE "Transcription" DROP COLUMN IF EXISTS "footerVariant";
ALTER TABLE "Transcription" DROP COLUMN IF EXISTS "footerShown";

ALTER TABLE "MinuteBalance" DROP COLUMN IF EXISTS "audiosUsed";

ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "trialDowngradedAt";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "trialEndsAt";

ALTER TABLE "Plan" DROP COLUMN IF EXISTS "audiosPerMonth";
