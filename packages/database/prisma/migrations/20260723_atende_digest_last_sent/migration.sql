-- Atende: controle de idempotência do digest periódico (Feature 9)
ALTER TABLE "AtendeConfig" ADD COLUMN "lastDigestAt" TIMESTAMP(3);
