-- CreateTable
CREATE TABLE "AtendeConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessContext" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'profissional-amigavel',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'Recebemos sua mensagem! Já já alguém te responde por aqui.',
    "escalationPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeKnowledgeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendeKnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtendeConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtendeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtendeConfig_numberId_key" ON "AtendeConfig"("numberId");

-- CreateIndex
CREATE INDEX "AtendeConfig_userId_idx" ON "AtendeConfig"("userId");

-- CreateIndex
CREATE INDEX "AtendeKnowledgeBase_userId_active_idx" ON "AtendeKnowledgeBase"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AtendeConversation_numberId_contactPhone_key" ON "AtendeConversation"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "AtendeConversation_userId_lastMessageAt_idx" ON "AtendeConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "AtendeMessage_conversationId_createdAt_idx" ON "AtendeMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AtendeConfig" ADD CONSTRAINT "AtendeConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConfig" ADD CONSTRAINT "AtendeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeKnowledgeBase" ADD CONSTRAINT "AtendeKnowledgeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConversation" ADD CONSTRAINT "AtendeConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConversation" ADD CONSTRAINT "AtendeConversation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeMessage" ADD CONSTRAINT "AtendeMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AtendeConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
