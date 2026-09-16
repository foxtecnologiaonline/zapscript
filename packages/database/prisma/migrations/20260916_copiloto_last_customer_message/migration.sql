-- Corrige a definição de "não lida" no painel do Copiloto: lastMessageAt subia
-- com QUALQUER mensagem ('in' do cliente ou 'out' do dono), então uma
-- conversa que o dono já respondia direto no WhatsApp (sem passar pelo painel)
-- ficava marcada como "não lida" pra sempre — e o botão "Atualizar" nunca
-- zerava a fila, porque processBrief nunca encontrava mensagem 'in' nova pra
-- brifar. lastCustomerMessageAt rastreia só a última mensagem do CLIENTE.

ALTER TABLE "CopilotoConversation" ADD COLUMN "lastCustomerMessageAt" TIMESTAMP(3);

-- Backfill a partir do histórico real de mensagens já persistido.
UPDATE "CopilotoConversation" c
SET "lastCustomerMessageAt" = (
  SELECT MAX(m."createdAt")
  FROM "CopilotoMessage" m
  WHERE m."conversationId" = c.id AND m.direction = 'in'
);
