-- Letra (A/B/C...) pra desambiguar briefings pendentes simultâneos do mesmo
-- número (contatos diferentes) — resolve "1/2/3 sempre agia no mais recente,
-- mesmo se eu quisesse responder a um mais antigo ainda pendente".

ALTER TABLE "CopilotoBriefing" ADD COLUMN "pendingLabel" TEXT;
