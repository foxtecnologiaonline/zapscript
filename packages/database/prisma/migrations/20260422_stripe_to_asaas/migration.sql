-- Migration: Stripe → Asaas
-- Rename Stripe-specific columns to Asaas equivalents

-- Plan: stripePriceId → asaasProductId
ALTER TABLE "Plan" RENAME COLUMN "stripePriceId" TO "asaasProductId";

-- Subscription: stripeSubscriptionId → asaasSubscriptionId
ALTER TABLE "Subscription" RENAME COLUMN "stripeSubscriptionId" TO "asaasSubscriptionId";

-- Subscription: stripeCustomerId → asaasCustomerId
ALTER TABLE "Subscription" RENAME COLUMN "stripeCustomerId" TO "asaasCustomerId";
