-- Plataforma/API pública — Fase 1 (itens 3 e 1 do escopo ZapScript × Twilio):
-- idempotência das escritas + log unificado de mensagens.

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "resourceId" TEXT,
    "autoDerived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "toPhone" TEXT NOT NULL,
    "fromPhone" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "mediaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_scope_key_key" ON "IdempotencyRecord"("userId", "scope", "key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "MessageLog_userId_queuedAt_idx" ON "MessageLog"("userId", "queuedAt");

-- CreateIndex
CREATE INDEX "MessageLog_userId_status_idx" ON "MessageLog"("userId", "status");

-- CreateIndex
CREATE INDEX "MessageLog_userId_direction_queuedAt_idx" ON "MessageLog"("userId", "direction", "queuedAt");

-- CreateIndex
CREATE INDEX "MessageLog_providerMessageId_idx" ON "MessageLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "MessageLog_numberId_queuedAt_idx" ON "MessageLog"("numberId", "queuedAt");

-- CreateIndex
CREATE INDEX "MessageLog_source_sourceId_idx" ON "MessageLog"("source", "sourceId");

-- CreateIndex
CREATE INDEX "MessageLog_queuedAt_idx" ON "MessageLog"("queuedAt");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
