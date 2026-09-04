-- ZapScript Copiloto (MVP) — agente pessoal do dono.
--
-- Ver ESCOPO_COPILOTO.md. O Copiloto lê a conversa, resume para o DONO no
-- self-chat e oferece 3 opções de ação; só envia ao cliente quando o dono
-- responde 1/2/3. Nunca fala com o cliente por conta própria.
--
-- Acesso no MVP é concedido pelo admin (Entitlement source='comp'), não por
-- compra: o Product entra como 'planned', que billing.ts recusa vender
-- (routes/billing.ts §/modules/:key/subscribe). O gate real é o Entitlement.

-- CreateTable
CREATE TABLE "CopilotoConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxBriefsPerDay" INTEGER NOT NULL DEFAULT 8,
    "quietStart" TEXT NOT NULL DEFAULT '21:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "aggressiveness" TEXT NOT NULL DEFAULT 'equilibrado',
    "businessContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBriefedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fromCopiloto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "blocker" TEXT,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "awaitingRank" INTEGER,
    "awaitingSince" TIMESTAMP(3),
    "deliveredVia" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoSuggestion" (
    "id" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "axis" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "risk" TEXT,
    "technique" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "sentText" TEXT,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConfig_numberId_key" ON "CopilotoConfig"("numberId");

-- CreateIndex
CREATE INDEX "CopilotoConfig_userId_idx" ON "CopilotoConfig"("userId");

-- CreateIndex
CREATE INDEX "CopilotoConversation_userId_lastMessageAt_idx" ON "CopilotoConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConversation_numberId_contactPhone_key" ON "CopilotoConversation"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "CopilotoMessage_conversationId_createdAt_idx" ON "CopilotoMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoBriefing_userId_createdAt_idx" ON "CopilotoBriefing"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoBriefing_numberId_status_createdAt_idx" ON "CopilotoBriefing"("numberId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_briefingId_idx" ON "CopilotoSuggestion"("briefingId");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_technique_outcome_idx" ON "CopilotoSuggestion"("technique", "outcome");

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoMessage" ADD CONSTRAINT "CopilotoMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoSuggestion" ADD CONSTRAINT "CopilotoSuggestion_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "CopilotoBriefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catálogo: registra o módulo para que o Entitlement (FK -> Product.key) exista.
-- 'planned' = aparece no catálogo, mas NÃO é comprável — no MVP quem libera é o admin.
INSERT INTO "Product" (id, key, name, status, "priceMonthly", "priceYearly", "dependsOn", "updatedAt")
VALUES (gen_random_uuid()::text, 'copiloto', 'ZapScript Copiloto', 'planned', 47.00, 451.00, ARRAY[]::TEXT[], now())
ON CONFLICT ("key") DO UPDATE SET
  name           = EXCLUDED.name,
  status         = EXCLUDED.status,
  "priceMonthly" = EXCLUDED."priceMonthly",
  "priceYearly"  = EXCLUDED."priceYearly",
  "updatedAt"    = now();
