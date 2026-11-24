-- Balcão Virtual: respostas prontas pessoais (ownerId) e códigos de recuperação do MFA
ALTER TABLE "BvCannedResponse" ADD COLUMN "ownerId" TEXT;
DROP INDEX "BvCannedResponse_orgId_shortcut_key";
CREATE UNIQUE INDEX "BvCannedResponse_orgId_ownerId_shortcut_key" ON "BvCannedResponse"("orgId", "ownerId", "shortcut");
-- NULLs são distintos no unique: garante 1 atalho por órgão para respostas compartilhadas (ownerId nulo)
CREATE UNIQUE INDEX "BvCannedResponse_org_shortcut_shared_key" ON "BvCannedResponse"("orgId", "shortcut") WHERE "ownerId" IS NULL;
CREATE INDEX "BvCannedResponse_orgId_ownerId_idx" ON "BvCannedResponse"("orgId", "ownerId");
ALTER TABLE "BvUser" ADD COLUMN "mfaRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
