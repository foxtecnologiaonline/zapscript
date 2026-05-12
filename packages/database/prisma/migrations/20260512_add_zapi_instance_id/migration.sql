-- Z-API: adicionar campo zapiInstanceId em WhatsappNumber
-- Mapeia instância Z-API (dispositivo adicional) ao número do usuário

ALTER TABLE "WhatsappNumber" ADD COLUMN "zapiInstanceId" TEXT;
CREATE UNIQUE INDEX "WhatsappNumber_zapiInstanceId_key" ON "WhatsappNumber"("zapiInstanceId");
