-- AddColumn deletedAt para soft-delete de campanhas (LGPD)
ALTER TABLE "Campanha" ADD COLUMN "deletedAt" TIMESTAMP;

-- Index pra filtrar campanhas ativas (deletedAt IS NULL)
CREATE INDEX "idx_campanha_userId_deletedAt" ON "Campanha"("userId", "deletedAt");
CREATE INDEX "idx_campanha_status_deletedAt" ON "Campanha"("status", "deletedAt");
