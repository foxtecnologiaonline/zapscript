-- Idempotência de ingestão do Copiloto: guarda o messageId do WhatsApp
-- (Evolution) em cada CopilotoMessage. Nullable/best-effort, sem unique
-- constraint (mesmo padrão de AtendeReview.canalExternoId) — o objetivo é
-- permitir reprocessar o backfill/sweep de conversas não lidas com segurança,
-- sem duplicar mensagem quando o mesmo chat continua não lido entre rodadas.

ALTER TABLE "CopilotoMessage" ADD COLUMN "externalId" TEXT;

CREATE INDEX "CopilotoMessage_conversationId_externalId_idx" ON "CopilotoMessage"("conversationId", "externalId");
