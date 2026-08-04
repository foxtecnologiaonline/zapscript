-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingCredit" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_userId_key" ON "CreditWallet"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_walletId_createdAt_idx" ON "CreditTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingCredit_paymentId_key" ON "PendingCredit"("paymentId");

-- CreateIndex
CREATE INDEX "PendingCredit_status_releaseAt_idx" ON "PendingCredit"("status", "releaseAt");

-- AddForeignKey
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCredit" ADD CONSTRAINT "PendingCredit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

