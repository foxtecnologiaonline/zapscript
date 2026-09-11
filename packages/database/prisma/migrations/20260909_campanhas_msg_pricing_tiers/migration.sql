-- Nova política de preços do saldo de mensagens de Campanhas (decisão de produto,
-- 2026-09-09): 30 mensagens grátis por mês pra todo mundo, pacotes pré-pagos com
-- validade (90/120 dias) e assinatura mensal vira Ilimitada (R$699). Ver
-- lib/campanha-credit.ts e CAMPANHAS_ARQUITETURA.md §17.

-- AlterTable
ALTER TABLE "CampanhaBalance" ADD COLUMN "freeMessages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampanhaBalance" ADD COLUMN "freeResetAt" TIMESTAMP(3);
ALTER TABLE "CampanhaBalance" ADD COLUMN "paidMessages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampanhaBalance" ADD COLUMN "paidExpiresAt" TIMESTAMP(3);

-- Backfill: saldo pago já existente (tudo estava em availableMessages, sem separação
-- free/paid nem validade antes desta migration) vira saldo pago com 90 dias de
-- carência a partir de agora, pra ninguém perder mensagens já compradas.
UPDATE "CampanhaBalance"
SET "paidMessages" = "availableMessages",
    "paidExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '90 days'
WHERE "availableMessages" > 0;
