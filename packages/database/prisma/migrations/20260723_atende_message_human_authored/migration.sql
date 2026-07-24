-- Atende: marca mensagens de saída realmente escritas pelo dono (fromMe capturado
-- durante takeover), distinguindo de fallback do bot (aiGenerated=false também, mas
-- não é resposta humana real) — usado por Feature 5 (aprender com histórico) e 6 (KB a partir de escalação)
ALTER TABLE "AtendeMessage" ADD COLUMN "humanAuthored" BOOLEAN NOT NULL DEFAULT false;
