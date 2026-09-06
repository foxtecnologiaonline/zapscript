-- DropForeignKey
ALTER TABLE "CopilotoContactThread" DROP CONSTRAINT "CopilotoContactThread_userId_fkey";

-- DropForeignKey
ALTER TABLE "CopilotoContactThread" DROP CONSTRAINT "CopilotoContactThread_numberId_fkey";

-- DropForeignKey
ALTER TABLE "CopilotoContactMessage" DROP CONSTRAINT "CopilotoContactMessage_threadId_fkey";

-- DropForeignKey
ALTER TABLE "CopilotoSuggestion" DROP CONSTRAINT "CopilotoSuggestion_threadId_fkey";

-- DropIndex
DROP INDEX "CopilotoSuggestion_threadId_createdAt_idx";

-- DropIndex
DROP INDEX "CopilotoSuggestion_waMessageId_idx";

-- AlterTable
ALTER TABLE "CopilotoSuggestion" DROP COLUMN "chosenOption",
DROP COLUMN "opcoes",
DROP COLUMN "respondedAt",
DROP COLUMN "resumo",
DROP COLUMN "threadId",
DROP COLUMN "waMessageId",
ADD COLUMN     "axis" TEXT NOT NULL,
ADD COLUMN     "briefingId" TEXT NOT NULL,
ADD COLUMN     "commitmentDueAt" TIMESTAMP(3),
ADD COLUMN     "commitmentTitle" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "draft" TEXT NOT NULL,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "rank" INTEGER NOT NULL,
ADD COLUMN     "rationale" TEXT NOT NULL,
ADD COLUMN     "risk" TEXT,
ADD COLUMN     "sentText" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'offered',
ADD COLUMN     "technique" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL;

-- DropTable
DROP TABLE "CopilotoContactThread";

-- DropTable
DROP TABLE "CopilotoContactMessage";

-- CreateTable
CREATE TABLE "CopilotoConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxBriefsPerDay" INTEGER NOT NULL DEFAULT 8,
    "quietStart" TEXT NOT NULL DEFAULT '21:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "aggressiveness" TEXT NOT NULL DEFAULT 'equilibrado',
    "businessContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBriefedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fromCopiloto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "blocker" TEXT,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "awaitingRank" INTEGER,
    "awaitingSince" TIMESTAMP(3),
    "deliveredVia" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConfig_numberId_key" ON "CopilotoConfig"("numberId");

-- CreateIndex
CREATE INDEX "CopilotoConfig_userId_idx" ON "CopilotoConfig"("userId");

-- CreateIndex
CREATE INDEX "CopilotoConversation_userId_lastMessageAt_idx" ON "CopilotoConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConversation_numberId_contactPhone_key" ON "CopilotoConversation"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "CopilotoMessage_conversationId_createdAt_idx" ON "CopilotoMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoBriefing_userId_createdAt_idx" ON "CopilotoBriefing"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoBriefing_numberId_status_createdAt_idx" ON "CopilotoBriefing"("numberId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_briefingId_idx" ON "CopilotoSuggestion"("briefingId");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_technique_outcome_idx" ON "CopilotoSuggestion"("technique", "outcome");

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoMessage" ADD CONSTRAINT "CopilotoMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoSuggestion" ADD CONSTRAINT "CopilotoSuggestion_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "CopilotoBriefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

