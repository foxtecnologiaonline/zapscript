-- Copiloto v2.1 — insights e controles pós-observação (10 melhorias):
-- piso de confiança configurável por tipo, persistência do sinal de
-- vulnerabilidade (antes só em memória) e feedback explícito de ruído do dono.

ALTER TABLE "CopilotoConfig" ADD COLUMN "minConfidenceByTipo" JSONB;

ALTER TABLE "CopilotoBriefing" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CopilotoBriefing" ADD COLUMN "dismissReason" TEXT;

CREATE INDEX "CopilotoBriefing_sensitive_tipo_idx" ON "CopilotoBriefing"("sensitive", "tipo");
