-- Migration: Add paymentMethod to Subscription + remove unused Plan column
-- Apply in Supabase SQL Editor

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;

-- Remove unused column on Plan (was never populated)
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "asaasProductId";
