-- AlterTable: adicionar campo filename (nome original do arquivo) às transcrições manuais
ALTER TABLE "Transcription" ADD COLUMN IF NOT EXISTS "filename" TEXT;
