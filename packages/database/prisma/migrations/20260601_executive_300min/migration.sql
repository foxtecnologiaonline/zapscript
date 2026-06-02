-- Migration: Corrige minutesPerMonth do Executive para 300
-- e ajusta saldo dos usuários que receberam 500 erroneamente
-- Aplicar no Supabase SQL Editor

-- 1. Corrigir o plano no banco
UPDATE "Plan"
SET "minutesPerMonth" = 300
WHERE "name" = 'executive';

-- 2. Corrigir saldo dos usuários Executive ativos que ainda têm o excesso de 200 min
--    (só afeta quem recebeu 500 e ainda não usou os 200 extras)
UPDATE "MinuteBalance" mb
SET "availableMinutes" = mb."availableMinutes" - 200
FROM "Subscription" s
JOIN "Plan" p ON s."planId" = p.id
WHERE mb."userId" = s."userId"
  AND p."name" = 'executive'
  AND s."status" = 'active'
  AND mb."availableMinutes" > 300;

-- Confirmar resultado
SELECT
  u.email,
  p.name AS plano,
  p."minutesPerMonth",
  mb."availableMinutes"
FROM "User" u
JOIN "Subscription" s ON s."userId" = u.id
JOIN "Plan" p ON s."planId" = p.id
JOIN "MinuteBalance" mb ON mb."userId" = u.id
WHERE p.name = 'executive'
ORDER BY u."createdAt" DESC;
