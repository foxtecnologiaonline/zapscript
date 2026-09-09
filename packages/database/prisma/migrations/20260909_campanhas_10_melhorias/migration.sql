-- ZapScript Campanhas — schema pras 10 sugestões de eficiência/eficácia
-- (ver CAMPANHAS_ARQUITETURA.md §11). Puramente aditivo, sem backfill —
-- 0 campanhas em produção até esta revisão (confirmado nas revisões anteriores).

ALTER TABLE "Campanha" ADD COLUMN "templateVarCount" INTEGER;
ALTER TABLE "Campanha" ADD COLUMN "poolNumberIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Campanha" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Campanha" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "Campanha" ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CampanhaContato" ADD COLUMN "assignedNumberId" TEXT;
