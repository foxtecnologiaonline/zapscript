-- AlterTable
ALTER TABLE "CreditWallet" ADD COLUMN     "payoutName" TEXT,
ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" TEXT;

-- CreateTable
CREATE TABLE "WalletPayout" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "pixKey" TEXT NOT NULL,
    "pixKeyType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,

    CONSTRAINT "WalletPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletPayout_status_requestedAt_idx" ON "WalletPayout"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "WalletPayout" ADD CONSTRAINT "WalletPayout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

