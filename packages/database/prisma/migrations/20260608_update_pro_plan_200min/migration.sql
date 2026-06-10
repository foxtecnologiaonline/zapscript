-- Migração v4.0: Atualizar plano Pro (100→200min, R$29,90→R$39,90) e top-up usuários ativos
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Atualizar registro do plano Pro na tabela Plan
UPDATE "Plan"
SET
  "minutesPerMonth" = 200,
  "priceBrl"        = 39.90,
  "label"           = 'Pro',
  "features"        = '["200 min/mês","2 números WhatsApp","Transcrição automática","Transcrição de áudios no site","Resumo com IA","Histórico completo de transcrições","Filtros por data e contato","Busca no histórico","Notas Pessoais de Voz","Modo Privado de transcrição","Transcrição profissional (PDF)"]'
WHERE "name" = 'pro';

-- 2. Top-up: garantir que todos os usuários Pro tenham pelo menos 200 minutos disponíveis
--    (usuários com saldo menor que 200 são atualizados para 200; quem já tem mais, não muda)
UPDATE "MinuteBalance" mb
SET    "availableMinutes" = 200
FROM   "Subscription" s
JOIN   "Plan" p ON p.id = s."planId"
WHERE  mb."userId"          = s."userId"
  AND  p."name"             = 'pro'
  AND  mb."availableMinutes" < 200;

-- Subscription não tem coluna minutesPerMonth — worker lê de Plan diretamente.
