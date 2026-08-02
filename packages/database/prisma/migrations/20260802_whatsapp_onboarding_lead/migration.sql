-- CreateTable
CREATE TABLE "WhatsappOnboardingLead" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'started',
    "name" TEXT,
    "pushName" TEXT,
    "email" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "numberId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappOnboardingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappOnboardingLead_phone_key" ON "WhatsappOnboardingLead"("phone");

-- CreateIndex
CREATE INDEX "WhatsappOnboardingLead_stage_idx" ON "WhatsappOnboardingLead"("stage");
