-- Add clickCount to TesterInvite for conversion tracking
ALTER TABLE "TesterInvite" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
