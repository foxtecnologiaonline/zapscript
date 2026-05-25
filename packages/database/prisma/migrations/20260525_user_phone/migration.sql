-- Migration: 20260525_user_phone
-- Adiciona campo de celular de contato ao modelo User

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
