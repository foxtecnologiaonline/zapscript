-- Plataforma — Fase 4 (item 8): header de mídia em template de campanha.
-- Template aprovado com header IMAGE/VIDEO/DOCUMENT precisa receber a mídia em
-- cada envio; a Meta só guarda o exemplo da aprovação.

-- AlterTable
ALTER TABLE "Campanha" ADD COLUMN     "headerMediaType" TEXT,
                       ADD COLUMN     "headerMediaUrl" TEXT,
                       ADD COLUMN     "headerMediaFilename" TEXT;
