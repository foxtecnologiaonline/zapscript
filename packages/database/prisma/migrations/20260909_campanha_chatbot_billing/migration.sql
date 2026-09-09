-- Chatbot Campanhas: saldo de mensagens (pré-pago + assinatura mensal,
-- vendido via chat) + estado de conversa do bot. Ledger próprio, separado de
-- CreditWallet/CreditTransaction (lib/credit.ts) — saldo de MENSAGENS de
-- campanha, não crédito em R$ de indicação.

-- AlterTable
ALTER TABLE "Campanha" ADD COLUMN "createdViaChat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campanha" ADD COLUMN "messagesCost" INTEGER;

-- AlterTable
ALTER TABLE "WhatsappNumber" ADD COLUMN "publicPurpose" TEXT;

-- CreateTable
CREATE TABLE "CampanhaBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableMessages" INTEGER NOT NULL DEFAULT 0,
    "plan" TEXT,
    "asaasSubscriptionId" TEXT,
    "asaasCustomerId" TEXT,
    "renewalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaBalanceTransaction" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaBalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaChatSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'idle',
    "draftMessageBody" TEXT,
    "draftContactSource" TEXT,
    "campanhaId" TEXT,
    "pendingPackageId" TEXT,
    "pendingChargeId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaBalance_userId_key" ON "CampanhaBalance"("userId");

-- CreateIndex
CREATE INDEX "CampanhaBalanceTransaction_balanceId_createdAt_idx" ON "CampanhaBalanceTransaction"("balanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaChatSession_phone_key" ON "CampanhaChatSession"("phone");

-- CreateIndex
CREATE INDEX "CampanhaChatSession_userId_idx" ON "CampanhaChatSession"("userId");

-- AddForeignKey
ALTER TABLE "CampanhaBalance" ADD CONSTRAINT "CampanhaBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaBalanceTransaction" ADD CONSTRAINT "CampanhaBalanceTransaction_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "CampanhaBalance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
