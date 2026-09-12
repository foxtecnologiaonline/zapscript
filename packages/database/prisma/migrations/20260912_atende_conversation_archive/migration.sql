-- Adicionar campos de soft-delete (archive) em AtendeConversation
-- Permite cleanup de conversas antigas sem perder dados (LGPD compliance)

-- Adicionar flag de archived
ALTER TABLE "AtendeConversation" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- Data de quando foi marcada como archived
ALTER TABLE "AtendeConversation" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Índice para queries rápidas de cleanup
CREATE INDEX "AtendeConversation_archived_idx" ON "AtendeConversation"("archived");
