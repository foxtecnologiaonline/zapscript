-- Migração: SupportTicket.attachmentUrl
-- Adiciona coluna para URL de arquivo no Supabase Storage.
-- attachmentData (Base64) é mantido para retrocompatibilidade com registros antigos.
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
