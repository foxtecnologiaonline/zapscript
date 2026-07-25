-- CreateTable
CREATE TABLE "LegendaJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "originalFilename" TEXT,
    "inputStorageKey" TEXT NOT NULL,
    "inputSizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "language" TEXT NOT NULL DEFAULT 'pt',
    "srtStorageKey" TEXT,
    "vttStorageKey" TEXT,
    "errorMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegendaJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegendaJob_userId_createdAt_idx" ON "LegendaJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LegendaJob_status_idx" ON "LegendaJob"("status");

-- AddForeignKey
ALTER TABLE "LegendaJob" ADD CONSTRAINT "LegendaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nota: NÃO promove Product.status para 'beta' aqui. O Product 'legenda' já é
-- semeado como 'planned' pela migration 20260713_seed_products_backfill_core,
-- e o módulo permanece oculto até decisão explícita de lançamento — ver
-- packages/modules/catalog.ts e o guard em runAutoMigrations() (apps/api/src/index.ts).
