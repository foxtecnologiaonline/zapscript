-- Item 5 do escopo ZapScript × Twilio: lado de ENTRADA do log de mensagens.
--
-- A v1 só tinha OutboundMessage (saída) e o evento message.received (empurrado
-- na hora). Sem registro durável, "este contato me mandou algo?" dependia de o
-- webhook do cliente estar de pé naquele segundo.

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT,
    "channel" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "providerMessageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Deduplicação de reentrega do webhook do provedor. NULLs não colidem no Postgres,
-- então mensagem sem id do provedor não é bloqueada.
CREATE UNIQUE INDEX "InboundMessage_channel_providerMessageId_key" ON "InboundMessage"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "InboundMessage_userId_receivedAt_idx" ON "InboundMessage"("userId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "InboundMessage_numberId_receivedAt_idx" ON "InboundMessage"("numberId", "receivedAt" DESC);

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
