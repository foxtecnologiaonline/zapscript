-- ════════════════════════════════════════════════════════════════════════════
-- FIX idempotente — Modo Privado automático (opt-out) em planos pagos
--
-- Contexto: privateMode passou a ser o padrão (default true). O worker força
-- transcrição no próprio número para plano pago, a menos que o usuário desligue
-- explicitamente (privateMode = false). Números pagos existentes que nunca
-- tocaram o toggle ficaram em false e continuariam vazando na conversa do contato.
--
-- Como aplicar: Supabase → SQL Editor → cole tudo → Run. Seguro rodar mais de
-- uma vez. Não roda migração; apenas alinha o schema real com o novo padrão.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Novo padrão para números criados daqui pra frente
ALTER TABLE "WhatsappNumber" ALTER COLUMN "privateMode" SET DEFAULT true;

-- 2) Backfill: liga o Modo Privado em todos os números existentes.
--    Quem quiser deixar a transcrição na conversa desliga pelo painel depois.
UPDATE "WhatsappNumber" SET "privateMode" = true WHERE "privateMode" = false;
