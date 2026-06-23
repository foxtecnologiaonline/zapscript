-- ============================================================================
-- Meta Embedded Signup — colunas no WhatsappNumber (idempotente)
-- ----------------------------------------------------------------------------
-- O build da API roda apenas `prisma generate` (NÃO `migrate deploy`), então a
-- migração 20260615_add_meta_embedded NÃO é aplicada automaticamente em produção.
-- Rode este SQL UMA VEZ no Supabase (SQL Editor). É seguro reexecutar: usa
-- ADD COLUMN IF NOT EXISTS, então não quebra se a coluna já existir.
-- ============================================================================

ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'evolution';
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "metaWabaId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "metaPhoneNumberId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "metaBusinessId" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "metaAccessTokenEnc" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "metaTokenExpiresAt" TIMESTAMP(3);

-- Conferência (opcional): deve listar as 6 colunas acima
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'WhatsappNumber'
--   AND column_name IN ('provider','metaWabaId','metaPhoneNumberId','metaBusinessId','metaAccessTokenEnc','metaTokenExpiresAt')
-- ORDER BY column_name;
