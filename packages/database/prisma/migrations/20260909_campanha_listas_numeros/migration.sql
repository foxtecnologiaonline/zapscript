-- ZapScript Campanhas — "Listas de números": grupos de contatos salvos e
-- reutilizáveis pelo usuário, independentes de qualquer Campanha (item do
-- redesenho do fluxo "Nova campanha" em wizard: escolher campanha → escolher
-- números → enviar). Uma lista é aplicada a uma campanha copiando seus
-- números pra CampanhaContato (POST /:id/contatos/from-lista) — editar a
-- lista depois não afeta campanhas que já a usaram.

CREATE TABLE "CampanhaLista" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaLista_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampanhaListaContato" (
    "id" TEXT NOT NULL,
    "listaId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaListaContato_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampanhaLista_userId_idx" ON "CampanhaLista"("userId");

CREATE INDEX "CampanhaListaContato_listaId_idx" ON "CampanhaListaContato"("listaId");

CREATE UNIQUE INDEX "CampanhaListaContato_listaId_phone_key" ON "CampanhaListaContato"("listaId", "phone");

ALTER TABLE "CampanhaLista" ADD CONSTRAINT "CampanhaLista_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampanhaListaContato" ADD CONSTRAINT "CampanhaListaContato_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "CampanhaLista"("id") ON DELETE CASCADE ON UPDATE CASCADE;
