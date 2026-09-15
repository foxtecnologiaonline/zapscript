-- HARVEY: persona de negociação/fechamento dentro do Copiloto.
-- Cada consulta ("harvey <situação>" no self-chat) só vira registro permanente
-- se o dono confirmar depois de ver a resposta (status 'draft' -> 'saved').

CREATE TABLE "HarveyConsult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT,
    "contexto" TEXT NOT NULL,
    "topico" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarveyConsult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HarveyConsult_userId_status_createdAt_idx" ON "HarveyConsult"("userId", "status", "createdAt" DESC);

CREATE INDEX "HarveyConsult_userId_contexto_status_idx" ON "HarveyConsult"("userId", "contexto", "status");

ALTER TABLE "HarveyConsult" ADD CONSTRAINT "HarveyConsult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
