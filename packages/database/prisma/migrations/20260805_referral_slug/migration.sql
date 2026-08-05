-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_referralSlug_key" ON "User"("referralSlug");

