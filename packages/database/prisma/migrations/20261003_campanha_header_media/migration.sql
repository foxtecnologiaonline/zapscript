-- Item 8 do escopo ZapScript × Twilio: header de mídia em template de campanha.
--
-- Template aprovado com header IMAGE/VIDEO/DOCUMENT precisa receber a mídia em
-- CADA envio — a Meta só guarda o exemplo usado na aprovação, não a mídia
-- definitiva. Sem isso, a campanha falhava contato por contato com um 132012
-- opaco DEPOIS de o disparo já ter começado.
--
-- Colunas próprias (e não dentro de templateComponents, que é Json livre)
-- porque precisam ser validadas na CRIAÇÃO da campanha contra a definição do
-- template escolhido.
--
-- Nome com data 20261003 de propósito: migration é aplicada em ordem
-- lexicográfica, e 20261002_public_api_v1 precisa vir antes (a migration
-- seguinte altera OutboundMessage, criada lá).

-- AlterTable
ALTER TABLE "Campanha" ADD COLUMN     "headerMediaType" TEXT,
                       ADD COLUMN     "headerMediaUrl" TEXT,
                       ADD COLUMN     "headerMediaFilename" TEXT;
