-- Atende: nível de confiança (3 níveis) + frequência de resumo periódico ao dono
ALTER TABLE "AtendeConfig" ADD COLUMN "confidenceLevel" TEXT NOT NULL DEFAULT 'equilibrado';
ALTER TABLE "AtendeConfig" ADD COLUMN "digestFrequency" TEXT NOT NULL DEFAULT 'off';
