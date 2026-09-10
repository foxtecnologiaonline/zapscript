-- Restaurar Modo Privado como opt-in manual (desligado por padrão)
-- A migration 20260707 fez backfill para true, mas a intenção agora é opt-in:
-- usuários ativam manualmente no painel quando desejarem.
-- Revertendo para que novos números nasçam desligados (false).

-- Reverter default para false
ALTER TABLE "WhatsappNumber" ALTER COLUMN "privateMode" SET DEFAULT false;

-- Reset: todos para false (novo baseline opt-in)
UPDATE "WhatsappNumber" SET "privateMode" = false WHERE "privateMode" = true;
