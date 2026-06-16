-- Agente de Suporte Inteligente — atendimentos, base de conhecimento, sugestões de FAQ

-- SupportAtendimento
CREATE TABLE "SupportAtendimento" (
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

CREATE INDEX "SupportAtendimento_status_prioridade_idx" ON "SupportAtendimento"("status", "prioridade");
CREATE INDEX "SupportAtendimento_canal_criadoEm_idx" ON "SupportAtendimento"("canal", "criadoEm");
CREATE INDEX "SupportAtendimento_threadId_idx" ON "SupportAtendimento"("threadId");
CREATE INDEX "SupportAtendimento_canalExternoId_idx" ON "SupportAtendimento"("canalExternoId");

ALTER TABLE "SupportAtendimento"
  ADD CONSTRAINT "SupportAtendimento_clienteUserId_fkey"
  FOREIGN KEY ("clienteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- KnowledgeBase
CREATE TABLE "KnowledgeBase" (
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

CREATE INDEX "KnowledgeBase_categoria_idx" ON "KnowledgeBase"("categoria");

-- FaqSuggestion
CREATE TABLE "FaqSuggestion" (
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

CREATE INDEX "FaqSuggestion_status_idx" ON "FaqSuggestion"("status");
