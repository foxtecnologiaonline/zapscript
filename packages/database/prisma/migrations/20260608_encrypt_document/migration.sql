-- Migration: 20260608_encrypt_document
-- Criptografia do campo CPF/CNPJ (document) com AES-256-GCM
-- e criação de blind index HMAC-SHA256 para busca de unicidade (LGPD)

-- 1. Adicionar coluna documentHash (blind index)
ALTER TABLE "User" ADD COLUMN "documentHash" TEXT;

-- 2. Remover constraint unique do campo document
--    (AES-GCM com IV aleatório gera ciphertext diferente a cada encriptação)
DROP INDEX IF EXISTS "User_document_key";

-- 3. Criar unique constraint no documentHash
--    (garante unicidade via HMAC determinístico)
CREATE UNIQUE INDEX "User_documentHash_key" ON "User"("documentHash");

-- NOTA: Os registros existentes com document em plaintext devem ser
-- migrados pelo script scripts/migrate-encrypt-document.ts
-- antes de qualquer novo write criptografado.
