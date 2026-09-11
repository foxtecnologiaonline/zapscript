-- ZapScript Campanhas — suporte a canal 'evolution' (número Evolution do próprio
-- usuário, mensagem livre) além do canal 'meta' (API oficial, template aprovado)
-- que já existia. Ver CAMPANHAS_ARQUITETURA.md §8 para o racional dos guardrails
-- (público restrito a quem já conversou, ritmo lento, consentimento explícito).
--
-- Seguro de aplicar: 0 linhas em "Campanha" hoje (verificado antes de escrever
-- esta migration) — DROP NOT NULL em templateName não precisa de backfill.

ALTER TABLE "Campanha" ALTER COLUMN "templateName" DROP NOT NULL;
ALTER TABLE "Campanha" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'meta';
ALTER TABLE "Campanha" ADD COLUMN "messageBody" TEXT;
ALTER TABLE "Campanha" ADD COLUMN "consentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Campanha" ADD COLUMN "consentConfirmedIp" TEXT;
