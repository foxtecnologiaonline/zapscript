-- Adicionar campo completedAt para rastrear quando o onboarding foi concluído
-- Usado para calcular tempo médio de conclusão e análise de métricas

ALTER TABLE "WhatsappOnboardingLead" ADD COLUMN "completedAt" TIMESTAMP;
