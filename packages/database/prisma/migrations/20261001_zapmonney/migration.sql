-- CreateTable
CREATE TABLE "ZmUser" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'awaiting_consent',
    "consentAt" TIMESTAMP(3),
    "userId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZmUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZmTransaction" (
    "id" TEXT NOT NULL,
    "zmUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rawText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "sourceMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZmTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZmUser_phone_key" ON "ZmUser"("phone");

-- CreateIndex
CREATE INDEX "ZmUser_stage_idx" ON "ZmUser"("stage");

-- CreateIndex
CREATE INDEX "ZmUser_userId_idx" ON "ZmUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ZmTransaction_sourceMsgId_key" ON "ZmTransaction"("sourceMsgId");

-- CreateIndex
CREATE INDEX "ZmTransaction_zmUserId_status_idx" ON "ZmTransaction"("zmUserId", "status");

-- CreateIndex
CREATE INDEX "ZmTransaction_zmUserId_occurredAt_idx" ON "ZmTransaction"("zmUserId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "ZmTransaction" ADD CONSTRAINT "ZmTransaction_zmUserId_fkey" FOREIGN KEY ("zmUserId") REFERENCES "ZmUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
