-- Persiste a confiança da triagem (0-100) — faltava desde a v2.0, existia só
-- em memória em processBrief. Sem isso, /admin/copiloto/insights não tinha
-- como calcular a média real de confiança por tipo.

ALTER TABLE "CopilotoBriefing" ADD COLUMN "triageConfidence" DOUBLE PRECISION;
