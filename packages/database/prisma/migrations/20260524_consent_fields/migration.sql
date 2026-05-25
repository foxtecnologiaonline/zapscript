-- Migration: 20260524_consent_fields
-- Adiciona campos de consentimento LGPD ao modelo User

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contractAcceptedAt"  TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "marketingConsentAt"  TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "consentDocVersion"   TEXT;
