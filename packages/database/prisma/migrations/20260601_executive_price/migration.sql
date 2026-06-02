-- Migration: Atualiza preço do plano Executive para R$69,90
-- Aplique no Supabase SQL Editor

UPDATE "Plan" SET "priceBrl" = 69.90 WHERE "name" = 'executive';

-- Confirmar resultado
SELECT name, label, "priceBrl", "minutesPerMonth", "maxNumbers" FROM "Plan" ORDER BY "priceBrl";
