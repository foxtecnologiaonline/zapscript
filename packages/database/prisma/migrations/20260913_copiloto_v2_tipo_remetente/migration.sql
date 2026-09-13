-- Copiloto v2.0 — expande escopo de comercial-only para comercial + pessoal +
-- administrativo + crise + oportunidade. Ambas nullable: briefing antigo
-- (tipo=null) continua sendo lido e renderizado normalmente, sem migração de
-- dados retroativa.

ALTER TABLE "CopilotoBriefing" ADD COLUMN "tipo" TEXT;
ALTER TABLE "CopilotoBriefing" ADD COLUMN "remetente" TEXT;

CREATE INDEX "CopilotoBriefing_tipo_idx" ON "CopilotoBriefing"("tipo");
