-- ZapScript ZapScreve: áudio do DONO vira texto refinado, enviado no lugar do
-- áudio (direção contrária da transcrição de entrada). Sem módulo/gate
-- próprio no catálogo — acesso via requireAnyModule(['atende','copiloto']).
-- Ver ESCOPO_ZAPSCREVE.md.

CREATE TABLE "ZapScreveDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "targetPhone" TEXT NOT NULL,
    "targetName" TEXT,
    "audioStorageKey" TEXT,
    "rawText" TEXT,
    "quickText" TEXT,
    "copilotoText" TEXT,
    "sentText" TEXT,
    "sentVia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "errorMessage" TEXT,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ZapScreveDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ZapScreveDraft_userId_status_idx" ON "ZapScreveDraft"("userId", "status");

CREATE INDEX "ZapScreveDraft_userId_createdAt_idx" ON "ZapScreveDraft"("userId", "createdAt" DESC);

ALTER TABLE "ZapScreveDraft" ADD CONSTRAINT "ZapScreveDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
