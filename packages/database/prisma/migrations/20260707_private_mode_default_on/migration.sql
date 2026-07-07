-- Modo Privado automático (opt-out) em planos pagos.
-- Novo padrão: privateMode = true. Backfill dos números existentes que estavam
-- em false por causa do default antigo (transcrição vazava na conversa do contato).
ALTER TABLE "WhatsappNumber" ALTER COLUMN "privateMode" SET DEFAULT true;
UPDATE "WhatsappNumber" SET "privateMode" = true WHERE "privateMode" = false;
