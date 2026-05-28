-- ZapScript v2.0 — Sincronizar saldos de minutos com limites atuais dos planos
--
-- Problema: plano Pro reduziu de 150 → 100 min/mês.
-- Assinantes podem ter availableMinutes baseado no limite antigo.
--
-- Solução: recalcular availableMinutes usando o uso REAL do ciclo atual
-- (lido do UsageLog) e o novo limite do plano.
--
--   availableMinutes = max(0, plan.minutesPerMonth - minutos_usados_no_ciclo)
--
-- Ciclo atual = últimos 30 dias antes do próximo resetAt.
-- resetAt (data do próximo reset) NÃO é alterado — ciclo individual preservado.
-- Idempotente: aplicar mais de uma vez não altera o resultado.

UPDATE "MinuteBalance" mb
SET
  "availableMinutes" = GREATEST(
    0,
    p."minutesPerMonth" - COALESCE(
      (
        -- Soma os minutos realmente usados desde o início do ciclo atual
        SELECT ROUND(SUM(ul."minutesUsed")::numeric, 2)
        FROM "UsageLog" ul
        WHERE ul."userId" = mb."userId"
          AND ul."createdAt" >= (mb."resetAt" - INTERVAL '30 days')
          AND ul."createdAt" <  mb."resetAt"
      ),
      0
    )
  ),
  "lastAlertSent" = NULL   -- recalibrar alertas de 50/80/100% para o novo limite
FROM "Subscription" s
JOIN "Plan"          p  ON p.id = s."planId"
WHERE mb."userId" = s."userId";

-- Sanity check: garantir que nenhum saldo fique negativo
UPDATE "MinuteBalance"
SET "availableMinutes" = 0
WHERE "availableMinutes" < 0;
