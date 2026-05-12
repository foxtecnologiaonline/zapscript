-- Z-API multi-instância: adicionar zapiToken por número
-- Cada WhatsappNumber terá sua própria instância Z-API com token dedicado

ALTER TABLE "WhatsappNumber" ADD COLUMN "zapiToken" TEXT;
