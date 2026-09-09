-- Campanhas — checagem real de messaging_limit_tier/quality_rating antes do
-- disparo (canal meta), em vez de só o aviso de copy — ver
-- CAMPANHAS_ARQUITETURA.md §5.1/§9. Puramente aditivo, sem backfill.

ALTER TABLE "WhatsappNumber" ADD COLUMN "metaMessagingLimitTier" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaQualityRating" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "metaLimitsSyncedAt" TIMESTAMP(3);
