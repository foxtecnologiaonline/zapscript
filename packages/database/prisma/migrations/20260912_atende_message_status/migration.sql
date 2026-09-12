-- Adicionar rastreamento de status de envio em AtendeMessage
-- Permite visibilidade real de: enviado, pendente, falha + retry logic

-- Adicionar coluna status
ALTER TABLE "AtendeMessage" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'sent';

-- Adicionar razão da falha (para debugging)
ALTER TABLE "AtendeMessage" ADD COLUMN "failureReason" TEXT;

-- Contador de tentativas de retry (para evitar retry infinito)
ALTER TABLE "AtendeMessage" ADD COLUMN "failureAttempts" INTEGER NOT NULL DEFAULT 0;

-- Adicionar updatedAt (permite tracking de quando foi a última tentativa)
ALTER TABLE "AtendeMessage" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Índice para queries rápidas de "mensagens pendentes"
CREATE INDEX "AtendeMessage_status_idx" ON "AtendeMessage"("status");
