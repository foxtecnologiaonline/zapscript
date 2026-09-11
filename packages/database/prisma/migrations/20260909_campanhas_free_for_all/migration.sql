-- ZapScript Campanhas deixa de ser perk pago do Profissional/Empresas e passa
-- a ser gratuito pra todos os usuários (decisão de produto, 2026-09-09) —
-- reverte a direção do migration 20260908_campanhas_bundled. O gate de
-- verdade sai do código (getUserModules() em lib/moduleGate.ts passa a
-- incluir 'campanhas' sempre); aqui só sincroniza catálogo/copy pra não
-- ficar incoerente com isso. Idempotente.

UPDATE "Product"
SET status = 'free', "priceMonthly" = 0, "priceYearly" = 0, "updatedAt" = now()
WHERE key = 'campanhas';

UPDATE "Plan" SET
  features = '["Tudo do Core, sem limite de áudios","🤖 Atendimento automático 24/7 por IA","📥 Fila de conversas + assumir conversa manualmente","📊 Métricas de atendimento e efetividade","🔔 Avisos e alertas internos","📨 Avisos ao cliente (cobrança, agendamento, mercadoria pronta...)","📚 Base de conhecimento própria","🗓️ Resumo diário do atendimento"]'::jsonb
WHERE name = 'profissional';

UPDATE "Plan" SET
  features = '["Tudo do Profissional","📊 CRM — funil de vendas no WhatsApp","✅ Tarefas — designação e controle na equipe","👥 Até 5 usuários com papéis (admin/manager/agent)"]'::jsonb
WHERE name = 'empresas';
