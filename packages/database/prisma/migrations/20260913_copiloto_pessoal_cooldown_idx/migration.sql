-- Suporte ao cooldown de briefing "pessoal" por contato (processBrief, v2.1)
-- — sem este índice, a query rodava sem suporte a cada mensagem classificada
-- como "pessoal" pela triagem.

CREATE INDEX "CopilotoBriefing_conversationId_tipo_createdAt_idx" ON "CopilotoBriefing"("conversationId", "tipo", "createdAt");
