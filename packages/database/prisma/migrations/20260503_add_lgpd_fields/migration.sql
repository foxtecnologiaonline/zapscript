-- Migration: add_lgpd_fields
-- Adds LGPD compliance columns to User table and creates PrivacyPolicy table
-- LGPD Art. 18 (right to deletion), Art. 20 (data portability), consent tracking

-- AddColumn: LGPD consent timestamps
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyPolicyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt"         TIMESTAMP(3);

-- AddColumn: soft delete support (LGPD Art. 18)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pseudonymizedAt" TIMESTAMP(3);

-- CreateTable: versioned privacy policy documents
CREATE TABLE IF NOT EXISTS "PrivacyPolicy" (
    "id"        TEXT         NOT NULL,
    "version"   TEXT         NOT NULL,
    "content"   TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PrivacyPolicy_version_key" ON "PrivacyPolicy"("version");
CREATE INDEX        IF NOT EXISTS "PrivacyPolicy_version_idx" ON "PrivacyPolicy"("version");
