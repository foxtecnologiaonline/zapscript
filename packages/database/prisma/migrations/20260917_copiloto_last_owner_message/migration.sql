-- Segunda metade do fix de "não lida"/"pendente" (ver 20260916_...): rastreia
-- a última mensagem do DONO (qualquer canal) pra decidir se um briefing
-- 'pending' antigo (da era do push em self-chat, antes do painel sob
-- demanda) já foi resolvido na prática — o dono respondeu o contato depois
-- do briefing ser gerado, só nunca clicou em nada no painel/self-chat pra
-- fechar o card formalmente.

ALTER TABLE "CopilotoConversation" ADD COLUMN "lastOwnerMessageAt" TIMESTAMP(3);

-- Backfill a partir do histórico real de mensagens já persistido.
UPDATE "CopilotoConversation" c
SET "lastOwnerMessageAt" = (
  SELECT MAX(m."createdAt")
  FROM "CopilotoMessage" m
  WHERE m."conversationId" = c.id AND m.direction = 'out'
);
