-- Sistema de opt-in WhatsApp para campanhas via Evolution
-- Adiciona rastreabilidade de consentimento ao contato da campanha

ALTER TABLE "CampanhaContato" ADD COLUMN "optinConfirmedAt" TIMESTAMP(3);
ALTER TABLE "CampanhaContato" ADD COLUMN "optinTimeoutAt" TIMESTAMP(3);

-- Status enum será tratado via Prisma — a string 'pending_optin' é novo valor de status

-- Rastreamento global de opt-in por contato no CRM
ALTER TABLE "CrmContact" ADD COLUMN "whatsappOptinConfirmedAt" TIMESTAMP(3);
