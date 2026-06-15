-- Meta Embedded Signup (WhatsApp Cloud API) — vínculo por número
-- Usado apenas para o fluxo de App Review da Meta. Usuários reais seguem no Evolution.

ALTER TABLE "WhatsappNumber" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'evolution';
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaWabaId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaPhoneNumberId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaBusinessId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaAccessTokenEnc" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaTokenExpiresAt" TIMESTAMP(3);
