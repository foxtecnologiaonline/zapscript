-- ZapScript Campanhas — sequência/drip (passos fixos) + A/B test (2 variantes)
-- Ver CAMPANHAS_ARQUITETURA.md §15. Puramente aditivo, sem backfill.

ALTER TABLE "Campanha" ADD COLUMN "sequenceParentId" TEXT;
ALTER TABLE "Campanha" ADD COLUMN "sequenceIndex" INTEGER;
ALTER TABLE "Campanha" ADD COLUMN "sequenceDelayDays" INTEGER;
ALTER TABLE "Campanha" ADD COLUMN "abTestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campanha" ADD COLUMN "variantBTemplateName" TEXT;
ALTER TABLE "Campanha" ADD COLUMN "variantBTemplateLanguage" TEXT;
ALTER TABLE "Campanha" ADD COLUMN "variantBTemplateComponents" JSONB;
ALTER TABLE "Campanha" ADD COLUMN "variantBTemplateVarCount" INTEGER;
ALTER TABLE "Campanha" ADD COLUMN "variantBMessageBody" TEXT;

ALTER TABLE "CampanhaContato" ADD COLUMN "variant" TEXT;

CREATE INDEX "Campanha_sequenceParentId_idx" ON "Campanha"("sequenceParentId");

ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_sequenceParentId_fkey"
  FOREIGN KEY ("sequenceParentId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
