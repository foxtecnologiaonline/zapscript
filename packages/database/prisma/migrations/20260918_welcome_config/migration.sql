-- AlterTable
ALTER TABLE "AtendeConversation" ADD COLUMN     "lastWelcomeSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WelcomeConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "audioBytes" BYTEA,
    "audioMime" TEXT,
    "videoBytes" BYTEA,
    "videoMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WelcomeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeConfig_numberId_key" ON "WelcomeConfig"("numberId");

-- CreateIndex
CREATE INDEX "WelcomeConfig_userId_idx" ON "WelcomeConfig"("userId");

-- AddForeignKey
ALTER TABLE "WelcomeConfig" ADD CONSTRAINT "WelcomeConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeConfig" ADD CONSTRAINT "WelcomeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

