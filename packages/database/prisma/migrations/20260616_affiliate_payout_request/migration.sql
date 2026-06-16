-- Migration: 20260616_affiliate_payout_request
-- Adiciona campo para rastrear última solicitação de saque do afiliado.

ALTER TABLE "Affiliate" ADD COLUMN IF NOT EXISTS "payoutRequestedAt" TIMESTAMP(3);
