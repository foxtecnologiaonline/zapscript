-- Add expiresAt and phone fields to TesterInvite
ALTER TABLE "TesterInvite" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "TesterInvite" ADD COLUMN "phone" TEXT;
