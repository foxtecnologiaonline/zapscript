-- ─────────────────────────────────────────────────────────────────────────────
-- ZapScript Atende (multi-tenant) + Billing multi-produto (Opção A)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Billing multi-produto ────────────────────────────────────────────────────
-- Subscription passa a ter uma linha por PRODUTO do usuário (cada produto tem sua
-- própria assinatura Asaas/preço/ciclo). Linhas existentes são o produto histórico
-- 'transcription' (o DEFAULT backfila automaticamente).
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "productKey" TEXT NOT NULL DEFAULT 'transcription';

-- Trocar a unicidade de userId por (userId, productKey). O nome do índice/constraint
-- antigo segue a convenção do Prisma; removemos de forma defensiva (índice OU constraint).
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_userId_key";
DROP INDEX IF EXISTS "Subscription_userId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_userId_productKey_key"
  ON "Subscription"("userId", "productKey");

-- ── AtendeConfig ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AtendeConfig" (
  "id"                  TEXT        NOT NULL,
  "userId"              TEXT        NOT NULL,
  "ativo"               BOOLEAN     NOT NULL DEFAULT false,
  "autoEnvioAtivo"      BOOLEAN     NOT NULL DEFAULT false,
  "categoriasSensiveis" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "toneOverride"        TEXT,
  "negocioDescricao"    TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AtendeConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AtendeConfig_userId_key" ON "AtendeConfig"("userId");
ALTER TABLE "AtendeConfig"
  ADD CONSTRAINT "AtendeConfig_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AtendeConversa ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AtendeConversa" (
  "id"          TEXT         NOT NULL,
  "userId"      TEXT         NOT NULL,
  "numberId"    TEXT         NOT NULL,
  "remoteJid"   TEXT         NOT NULL,
  "contatoNome" TEXT,
  "resumoAtual" TEXT         NOT NULL DEFAULT '',
  "ultimaMsgId" TEXT,
  "ultimaMsgEm" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AtendeConversa_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AtendeConversa_userId_numberId_remoteJid_key"
  ON "AtendeConversa"("userId", "numberId", "remoteJid");
CREATE INDEX IF NOT EXISTS "AtendeConversa_userId_idx" ON "AtendeConversa"("userId");
ALTER TABLE "AtendeConversa"
  ADD CONSTRAINT "AtendeConversa_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AtendePendencia ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AtendePendencia" (
  "id"         TEXT         NOT NULL,
  "conversaId" TEXT         NOT NULL,
  "descricao"  TEXT         NOT NULL,
  "urgencia"   TEXT         NOT NULL DEFAULT 'baixa',
  "resolvida"  BOOLEAN      NOT NULL DEFAULT false,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AtendePendencia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AtendePendencia_conversaId_resolvida_idx"
  ON "AtendePendencia"("conversaId", "resolvida");
ALTER TABLE "AtendePendencia"
  ADD CONSTRAINT "AtendePendencia_conversaId_fkey"
  FOREIGN KEY ("conversaId") REFERENCES "AtendeConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AtendeMensagem ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AtendeMensagem" (
  "id"                TEXT         NOT NULL,
  "conversaId"        TEXT         NOT NULL,
  "direcao"           TEXT         NOT NULL,
  "categoria"         TEXT,
  "prioridade"        TEXT,
  "confiancaResposta" INTEGER,
  "requerEscalacao"   BOOLEAN      NOT NULL DEFAULT false,
  "categoriaSensivel" BOOLEAN      NOT NULL DEFAULT false,
  "status"            TEXT         NOT NULL DEFAULT 'pending_approval',
  "rascunho"          TEXT,
  "respostaFinal"     TEXT,
  "canalExternoId"    TEXT,
  "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviadoEm"         TIMESTAMP(3),
  CONSTRAINT "AtendeMensagem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AtendeMensagem_conversaId_status_idx"
  ON "AtendeMensagem"("conversaId", "status");
CREATE INDEX IF NOT EXISTS "AtendeMensagem_canalExternoId_idx"
  ON "AtendeMensagem"("canalExternoId");
ALTER TABLE "AtendeMensagem"
  ADD CONSTRAINT "AtendeMensagem_conversaId_fkey"
  FOREIGN KEY ("conversaId") REFERENCES "AtendeConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
