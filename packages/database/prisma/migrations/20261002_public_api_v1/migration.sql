-- API pública v1: eventos de webhook por assinatura + mensageria durável.

-- AlterTable: WebhookConfig passa a declarar quais eventos assina.
-- Default = só 'transcription.completed' (único evento que existia antes desta
-- migration), para que nenhuma config já criada comece a receber os eventos
-- novos sem o dono ter pedido.
ALTER TABLE "WebhookConfig"
  ADD COLUMN "events" TEXT[] DEFAULT ARRAY['transcription.completed']::TEXT[];

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'public_api',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "httpStatus" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Idempotência por usuário: no Postgres, linhas com idempotencyKey NULL não
-- colidem entre si, então envios sem chave continuam livres.
CREATE UNIQUE INDEX "OutboundMessage_userId_idempotencyKey_key" ON "OutboundMessage"("userId", "idempotencyKey");
CREATE INDEX "OutboundMessage_userId_createdAt_idx" ON "OutboundMessage"("userId", "createdAt" DESC);
CREATE INDEX "OutboundMessage_numberId_idx" ON "OutboundMessage"("numberId");
CREATE INDEX "WebhookDelivery_userId_createdAt_idx" ON "WebhookDelivery"("userId", "createdAt" DESC);
CREATE INDEX "WebhookDelivery_event_createdAt_idx" ON "WebhookDelivery"("event", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
