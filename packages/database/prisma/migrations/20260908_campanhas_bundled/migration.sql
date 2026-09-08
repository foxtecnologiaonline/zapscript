-- ZapScript Campanhas passa a vir incluso no Profissional e no Empresas
-- (revisão de tiers) — deixa de ser vendido avulso. Sincronizado em
-- activatePlan() via TIER_MODULE_BUNDLES (routes/billing.ts). Quem já era
-- assinante avulso (Entitlement source='paid') mantém o acesso; só a
-- contratação nova avulsa é bloqueada (product.status === 'bundled').
-- Idempotente.

UPDATE "Product"
SET status = 'bundled', "updatedAt" = now()
WHERE key = 'campanhas';

UPDATE "Plan" SET
  features = '["Tudo do Core, sem limite de áudios","🤖 Atendimento automático 24/7 por IA","📥 Fila de conversas + assumir conversa manualmente","📊 Métricas de atendimento e efetividade","🔔 Avisos e alertas internos","📨 Avisos ao cliente (cobrança, agendamento, mercadoria pronta...)","📚 Base de conhecimento própria","🗓️ Resumo diário do atendimento","📣 Campanhas — disparo em massa via WhatsApp oficial"]'::jsonb
WHERE name = 'profissional';

UPDATE "Plan" SET
  features = '["Tudo do Profissional","📊 CRM — funil de vendas no WhatsApp","✅ Tarefas — designação e controle na equipe","👥 Até 5 usuários com papéis (admin/manager/agent)","📣 Campanhas — disparo em massa via WhatsApp oficial"]'::jsonb
WHERE name = 'empresas';
