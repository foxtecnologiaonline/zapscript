-- Migration: Atualiza preços dos planos Pro e Executive
-- Pro:       R$39,90 → R$29,90
-- Executive: R$69,90 → R$49,90 (minutesPerMonth já está correto em 300)
-- Data: 2026-06-02

-- 1. Atualizar preço do plano Pro
UPDATE "Plan"
SET "priceBrl" = 29.90
WHERE "name" = 'pro';

-- 2. Atualizar preço do plano Executive (minutos já corretos em 300)
UPDATE "Plan"
SET "priceBrl" = 49.90,
    "minutesPerMonth" = 300,
    "maxNumbers" = 3
WHERE "name" = 'executive';

-- 3. Confirmar resultado
SELECT
  name,
  label,
  "minutesPerMonth",
  "maxNumbers",
  "priceBrl"
FROM "Plan"
ORDER BY "priceBrl" ASC;
