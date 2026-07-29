-- Sistemática inicial de preços dos tiers ZapScript 2.0 (decisão de
-- negócio, 2026-07-29). Plan.priceBrl = "aluguel" (mensal); "compra"
-- (anual) vive em PLAN_PRICES_YEARLY (apps/api/src/routes/billing.ts):
--   Profissional: aluguel R$49/mês · compra R$295/ano
--   Empresas:     aluguel R$99/mês · compra R$595/ano

UPDATE "Plan" SET "priceBrl" = 49 WHERE name = 'profissional';
UPDATE "Plan" SET "priceBrl" = 99 WHERE name = 'empresas';
