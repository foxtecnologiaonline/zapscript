-- Onboarding/alertas de ciclo de vida via WhatsApp (mesma idempotência do e-mail)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lifecycleWhatsappSent" TEXT[] NOT NULL DEFAULT '{}';
