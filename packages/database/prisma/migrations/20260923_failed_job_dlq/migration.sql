-- CreateTable
CREATE TABLE "FailedJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "bullJobId" TEXT,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "payloadTrimmed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayedAt" TIMESTAMP(3),
    "replayCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FailedJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedJob_queue_failedAt_idx" ON "FailedJob"("queue", "failedAt");

-- CreateIndex
CREATE INDEX "FailedJob_userId_idx" ON "FailedJob"("userId");

-- CreateIndex
CREATE INDEX "FailedJob_replayedAt_idx" ON "FailedJob"("replayedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FailedJob_queue_bullJobId_key" ON "FailedJob"("queue", "bullJobId");
