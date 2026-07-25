-- Módulo Cobrança — lembretes automáticos de vencimento via WhatsApp (ver MODULOS_ARQUITETURA.md).
-- Puramente aditivo: 3 tabelas novas, nenhuma coluna/tabela existente é tocada.
-- Escrita à mão (não gerada por `prisma migrate dev`, indisponível neste ambiente)
-- e guardada com IF NOT EXISTS / duplicate_object para poder ser reaplicada com
-- segurança caso a migração seja repetida manualmente (ver incidentes de
-- migrate não aplicado em produção — MODULOS_ARQUITETURA.md / runbook de deploy).

-- CreateTable
CREATE TABLE IF NOT EXISTS "CobrancaCliente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "documento" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CobrancaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CobrancaCobranca" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CobrancaCobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CobrancaEnvio" (
    "id" TEXT NOT NULL,
    "cobrancaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,

    CONSTRAINT "CobrancaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CobrancaCliente_userId_deletedAt_idx" ON "CobrancaCliente"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CobrancaCobranca_userId_status_vencimento_idx" ON "CobrancaCobranca"("userId", "status", "vencimento");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CobrancaCobranca_clienteId_idx" ON "CobrancaCobranca"("clienteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CobrancaEnvio_cobrancaId_tipo_idx" ON "CobrancaEnvio"("cobrancaId", "tipo");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CobrancaCliente" ADD CONSTRAINT "CobrancaCliente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CobrancaCobranca" ADD CONSTRAINT "CobrancaCobranca_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CobrancaCobranca" ADD CONSTRAINT "CobrancaCobranca_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "CobrancaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CobrancaEnvio" ADD CONSTRAINT "CobrancaEnvio_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "CobrancaCobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
