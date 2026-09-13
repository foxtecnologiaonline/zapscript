-- MKT-Fast: motor genérico de missão de divulgação (ferramenta interna).
-- Ver MKTFAST_ESCOPO.md.

CREATE TABLE "Mission" (
    "id"               TEXT NOT NULL,
    "key"              TEXT,
    "title"            TEXT NOT NULL,
    "objective"        TEXT NOT NULL,
    "content"          JSONB NOT NULL,
    "channels"         TEXT[] NOT NULL,
    "whatsappNumberId" TEXT,
    "targetReach"      INTEGER,
    "status"           TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt"      TIMESTAMP(3),
    "startedAt"        TIMESTAMP(3),
    "completedAt"      TIMESTAMP(3),
    "createdBy"        TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mission_key_key" ON "Mission"("key");
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

ALTER TABLE "Mission" ADD CONSTRAINT "Mission_whatsappNumberId_fkey"
    FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MissionExecution" (
    "id"          TEXT NOT NULL,
    "missionId"   TEXT NOT NULL,
    "channel"     TEXT NOT NULL,
    "executor"    TEXT NOT NULL DEFAULT 'bot',
    "targetRef"   TEXT,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "proofUrl"    TEXT,
    "reachCount"  INTEGER,
    "errorReason" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MissionExecution_missionId_channel_targetRef_key" ON "MissionExecution"("missionId", "channel", "targetRef");
CREATE INDEX "MissionExecution_missionId_status_idx" ON "MissionExecution"("missionId", "status");

ALTER TABLE "MissionExecution" ADD CONSTRAINT "MissionExecution_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
