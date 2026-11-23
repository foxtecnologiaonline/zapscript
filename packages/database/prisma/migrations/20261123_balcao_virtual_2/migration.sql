-- Balcão Virtual: metadados da tarefa (nota, marcadores de SLA/aviso) e índice do histórico por campo
ALTER TABLE "BvTask" ADD COLUMN "metadata" JSONB;
CREATE INDEX "BvTaskHistory_taskId_field_idx" ON "BvTaskHistory"("taskId", "field");
