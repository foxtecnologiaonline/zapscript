-- Programa de Afiliados + captura de leads da demo pública da landing page

-- ── Affiliate ────────────────────────────────────────────────────────────────
CREATE TABLE "Affiliate" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "code"           TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "commissionType" TEXT NOT NULL DEFAULT 'recurring',
    "pixKey"         TEXT,
    "pixKeyType"     TEXT,
    "payoutName"     TEXT,
    "audience"       TEXT,
    "notes"          TEXT,
    "rejectedReason" TEXT,
    "appliedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"     TIMESTAMP(3),
    "approvedBy"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");
CREATE INDEX "Affiliate_status_idx" ON "Affiliate"("status");
CREATE INDEX "Affiliate_code_idx" ON "Affiliate"("code");
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AffiliateReferral ────────────────────────────────────────────────────────
CREATE TABLE "AffiliateReferral" (
    "id"             TEXT NOT NULL,
    "affiliateId"    TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "convertedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AffiliateReferral_referredUserId_key" ON "AffiliateReferral"("referredUserId");
CREATE INDEX "AffiliateReferral_affiliateId_idx" ON "AffiliateReferral"("affiliateId");
ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AffiliateCommission ──────────────────────────────────────────────────────
CREATE TABLE "AffiliateCommission" (
    "id"               TEXT NOT NULL,
    "affiliateId"      TEXT NOT NULL,
    "referredUserId"   TEXT NOT NULL,
    "paymentId"        TEXT NOT NULL,
    "saleAmount"       DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "commissionType"   TEXT NOT NULL,
    "monthIndex"       INTEGER NOT NULL DEFAULT 1,
    "status"           TEXT NOT NULL DEFAULT 'pending',
    "paidAt"           TIMESTAMP(3),
    "paidReference"    TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AffiliateCommission_paymentId_affiliateId_key" ON "AffiliateCommission"("paymentId", "affiliateId");
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DemoLead ─────────────────────────────────────────────────────────────────
CREATE TABLE "DemoLead" (
    "id"          TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "ip"          TEXT,
    "durationSec" DOUBLE PRECISION,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DemoLead_email_idx" ON "DemoLead"("email");
CREATE INDEX "DemoLead_createdAt_idx" ON "DemoLead"("createdAt");
