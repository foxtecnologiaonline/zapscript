-- ════════════════════════════════════════════════════════════════════════════
-- FIX idempotente — tabelas do Agente de Suporte (migração 20260616_support_agent)
--
-- Causa: o deploy de produção não rodou `prisma migrate deploy`, então as tabelas
-- SupportAtendimento / KnowledgeBase / FaqSuggestion nunca foram criadas →
-- /sys/g5r8t2/suporte/queue e /metrics retornavam 500.
--
-- Como aplicar: Supabase → SQL Editor → cole tudo → Run. Seguro rodar mais de uma
-- vez (IF NOT EXISTS em tudo + guarda na FK + marca a migração como aplicada).
-- ════════════════════════════════════════════════════════════════════════════

-- ── SupportAtendimento ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SupportAtendimento" (
  "id"                TEXT NOT NULL,
  "canal"             TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'pending_approval',
  "categoria"         TEXT,
  "prioridade"        TEXT,
  "sentimento"        TEXT,
  "confiancaResposta" INTEGER,
  "requerEscalacao"   BOOLEAN NOT NULL DEFAULT false,
  "topicos"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  "clienteNome"       TEXT,
  "clienteEmail"      TEXT,
  "clienteWhatsapp"   TEXT,
  "clienteUserId"     TEXT,
  "mensagemOriginal"  TEXT NOT NULL,
  "rascunhoAgente"    TEXT,
  "respostaFinal"     TEXT,
  "editadoPeloAdmin"  BOOLEAN NOT NULL DEFAULT false,
  "instrucaoRevisao"  TEXT,
  "threadId"          TEXT,
  "canalExternoId"    TEXT,
  "contextoUsado"     TEXT,
  "sugestaoFaq"       TEXT,
  "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aprovadoEm"        TIMESTAMP(3),
  "enviadoEm"         TIMESTAMP(3),
  "resolvidoEm"       TIMESTAMP(3),
  CONSTRAINT "SupportAtendimento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportAtendimento_status_prioridade_idx" ON "SupportAtendimento"("status", "prioridade");
CREATE INDEX IF NOT EXISTS "SupportAtendimento_canal_criadoEm_idx"    ON "SupportAtendimento"("canal", "criadoEm");
CREATE INDEX IF NOT EXISTS "SupportAtendimento_threadId_idx"          ON "SupportAtendimento"("threadId");
CREATE INDEX IF NOT EXISTS "SupportAtendimento_canalExternoId_idx"    ON "SupportAtendimento"("canalExternoId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportAtendimento_clienteUserId_fkey') THEN
    ALTER TABLE "SupportAtendimento"
      ADD CONSTRAINT "SupportAtendimento_clienteUserId_fkey"
      FOREIGN KEY ("clienteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── KnowledgeBase ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
  "id"                  TEXT NOT NULL,
  "titulo"              TEXT NOT NULL,
  "conteudo"            TEXT NOT NULL,
  "categoria"           TEXT,
  "tags"                TEXT[] DEFAULT ARRAY[]::TEXT[],
  "canalOrigem"         TEXT,
  "atendimentoOrigemId" TEXT,
  "aprovadoPorAdmin"    BOOLEAN NOT NULL DEFAULT true,
  "vezesUtilizado"      INTEGER NOT NULL DEFAULT 0,
  "utilidadeMedia"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "criadoEm"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KnowledgeBase_categoria_idx" ON "KnowledgeBase"("categoria");

-- ── FaqSuggestion ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FaqSuggestion" (
  "id"                  TEXT NOT NULL,
  "tituloSugerido"      TEXT NOT NULL,
  "conteudoSugerido"    TEXT NOT NULL,
  "categoria"           TEXT,
  "atendimentoOrigemId" TEXT,
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "criadoEm"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revisadoEm"          TIMESTAMP(3),
  CONSTRAINT "FaqSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FaqSuggestion_status_idx" ON "FaqSuggestion"("status");

-- ── Marca a migração como aplicada (evita conflito em futuros `migrate deploy`) ─
INSERT INTO "_prisma_migrations"
  ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count")
VALUES (
  gen_random_uuid()::text,
  'ad68ef6a7c5f7c48891c192f07f47e52f853365a5e3d0124cb71990eef409c8c',
  '20260616_support_agent',
  now(), now(), 1
)
ON CONFLICT DO NOTHING;
