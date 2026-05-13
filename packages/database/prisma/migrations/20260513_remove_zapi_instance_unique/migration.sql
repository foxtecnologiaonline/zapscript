-- Remove unique constraint em zapiInstanceId
-- Múltiplos usuários podem compartilhar a mesma instância Z-API (modo single-instance via env vars)
DROP INDEX IF EXISTS "WhatsappNumber_zapiInstanceId_key";
