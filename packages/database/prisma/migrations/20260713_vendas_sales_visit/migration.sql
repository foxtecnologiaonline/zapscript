-- CreateTable
CREATE TABLE "SalesVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientName" TEXT,
    "filename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originalText" TEXT,
    "summaryBullets" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesVisit_userId_createdAt_idx" ON "SalesVisit"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SalesVisit" ADD CONSTRAINT "SalesVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
