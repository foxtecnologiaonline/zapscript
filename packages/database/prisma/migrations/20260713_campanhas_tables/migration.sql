-- ZapScript Campanhas — disparo em massa via WhatsApp API oficial (Meta Cloud API)

-- ── Campanha ─────────────────────────────────────────────────────────────────
CREATE TABLE "Campanha" (
    "id"                 TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "whatsappNumberId"   TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'draft',
    "templateName"       TEXT NOT NULL,
    "templateLanguage"   TEXT NOT NULL DEFAULT 'pt_BR',
    "templateComponents" JSONB,
    "audienceCount"      INTEGER NOT NULL DEFAULT 0,
    "sentCount"          INTEGER NOT NULL DEFAULT 0,
    "scheduledAt"        TIMESTAMP(3),
    "startedAt"          TIMESTAMP(3),
    "completedAt"        TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campanha_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Campanha_userId_idx" ON "Campanha"("userId");
CREATE INDEX "Campanha_whatsappNumberId_idx" ON "Campanha"("whatsappNumberId");
CREATE INDEX "Campanha_status_idx" ON "Campanha"("status");
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_whatsappNumberId_fkey" FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CampanhaContato ──────────────────────────────────────────────────────────
CREATE TABLE "CampanhaContato" (
    "id"           TEXT NOT NULL,
    "campanhaId"   TEXT NOT NULL,
    "phone"        TEXT NOT NULL,
    "name"         TEXT,
    "variables"    JSONB,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "wamid"        TEXT,
    "errorMessage" TEXT,
    "sentAt"       TIMESTAMP(3),
    "deliveredAt"  TIMESTAMP(3),
    "readAt"       TIMESTAMP(3),
    "failedAt"     TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampanhaContato_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CampanhaContato_campanhaId_idx" ON "CampanhaContato"("campanhaId");
CREATE INDEX "CampanhaContato_campanhaId_status_idx" ON "CampanhaContato"("campanhaId", "status");
CREATE INDEX "CampanhaContato_wamid_idx" ON "CampanhaContato"("wamid");
ALTER TABLE "CampanhaContato" ADD CONSTRAINT "CampanhaContato_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CampanhaOptOut ───────────────────────────────────────────────────────────
CREATE TABLE "CampanhaOptOut" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "phone"     TEXT NOT NULL,
    "reason"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampanhaOptOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampanhaOptOut_userId_phone_key" ON "CampanhaOptOut"("userId", "phone");
CREATE INDEX "CampanhaOptOut_userId_idx" ON "CampanhaOptOut"("userId");
ALTER TABLE "CampanhaOptOut" ADD CONSTRAINT "CampanhaOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
