-- Bucket de minutos extras (avulsos / indicação) — valem 60 dias e não resetam mensalmente
ALTER TABLE "MinuteBalance" ADD COLUMN "extraMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "MinuteBalance" ADD COLUMN "extraExpiresAt" TIMESTAMP(3);
