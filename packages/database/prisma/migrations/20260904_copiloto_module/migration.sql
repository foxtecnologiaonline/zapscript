-- CreateTable
CREATE TABLE "CopilotoGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoGroupMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderJid" TEXT NOT NULL,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoGroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoGroupDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "groupsIncluded" INTEGER NOT NULL DEFAULT 0,
    "summaryMd" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoGroupDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoContactThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "pendingSince" TIMESTAMP(3),
    "lastSuggestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoContactThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoContactMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoSuggestion" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "waMessageId" TEXT,
    "resumo" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,
    "chosenOption" INTEGER,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CopilotoSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopilotoGroup_userId_active_idx" ON "CopilotoGroup"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoGroup_numberId_groupJid_key" ON "CopilotoGroup"("numberId", "groupJid");

-- CreateIndex
CREATE INDEX "CopilotoGroupMessage_groupId_createdAt_idx" ON "CopilotoGroupMessage"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoGroupDigest_userId_createdAt_idx" ON "CopilotoGroupDigest"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoGroupDigest_numberId_date_key" ON "CopilotoGroupDigest"("numberId", "date");

-- CreateIndex
CREATE INDEX "CopilotoContactThread_userId_updatedAt_idx" ON "CopilotoContactThread"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoContactThread_numberId_contactPhone_key" ON "CopilotoContactThread"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "CopilotoContactMessage_threadId_createdAt_idx" ON "CopilotoContactMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_threadId_createdAt_idx" ON "CopilotoSuggestion"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_waMessageId_idx" ON "CopilotoSuggestion"("waMessageId");

-- AddForeignKey
ALTER TABLE "CopilotoGroup" ADD CONSTRAINT "CopilotoGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroup" ADD CONSTRAINT "CopilotoGroup_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroupMessage" ADD CONSTRAINT "CopilotoGroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CopilotoGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroupDigest" ADD CONSTRAINT "CopilotoGroupDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoContactThread" ADD CONSTRAINT "CopilotoContactThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoContactThread" ADD CONSTRAINT "CopilotoContactThread_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoContactMessage" ADD CONSTRAINT "CopilotoContactMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CopilotoContactThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoSuggestion" ADD CONSTRAINT "CopilotoSuggestion_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CopilotoContactThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

