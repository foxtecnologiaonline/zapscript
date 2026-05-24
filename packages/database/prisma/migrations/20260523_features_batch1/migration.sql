-- Migration: 20260523_features_batch1
-- Features: Tags em Transcription, privateMode em WhatsappNumber, WebhookConfig

-- 1. Tags em transcrições (Feature: Tags/Categorias — Ultra+)
ALTER TABLE "Transcription" ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- 2. Modo privado em números WhatsApp (Feature: Mensagens Privadas — Executive+)
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "privateMode" BOOLEAN NOT NULL DEFAULT false;

-- 3. Configuração de webhook personalizado (Feature: Webhook — Executive+)
CREATE TABLE IF NOT EXISTS "WebhookConfig" (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT        NOT NULL UNIQUE,
  url         TEXT        NOT NULL,
  secret      TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "WebhookConfig_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
