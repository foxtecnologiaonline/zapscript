-- Programa de Afiliados: modelo recorrente (30% 12 meses + 5% residual + bônus
-- 40% para clientes 51+/mês + clawback de cancelamento em 30 dias).
-- Idempotente (IF EXISTS/IF NOT EXISTS) — ver MEMORY incident_migrate_nao_aplica.

-- "commissionType" no Affiliate era legado, nunca lido pelo motor de comissão
-- (o motor sempre usou uma taxa fixa por ciclo); com o modelo recorrente novo,
-- manter a coluna só induziria a erro. Removida.
ALTER TABLE "Affiliate" DROP COLUMN IF EXISTS "commissionType";

-- Trava, no momento da conversão, se este indicado contou como cliente novo
-- nº51+ do afiliado no mês (ativa a taxa de bônus de 40% enquanto recorrente).
ALTER TABLE "AffiliateReferral" ADD COLUMN IF NOT EXISTS "bonusTier" BOOLEAN NOT NULL DEFAULT false;
