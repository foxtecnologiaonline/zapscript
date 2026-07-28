-- Revisão de tiers ZapScript 2.0 (pré-lançamento — nenhum tier novo tinha
-- assinante real ainda, então redefinir é seguro):
--   Core (free)   = completo e grátis, até 100 áudios/mês (era 15), Modo
--                   Privado liberado (desligado por padrão).
--   Atende        deixa de ser tier avulso — vira parte do Profissional.
--   Profissional  = Core + Atende, 1 usuário / 1 conexão.
--   Empresas      = Core + Atende + CRM + Tarefas (módulo novo), até 5 usuários.
--   Vendas/Cobrança/Campanhas/Legendas seguem fora dos tiers (Legendas e
--   Campanhas já ocultos; Vendas e Cobrança passam a ficar ocultos também).
--
-- Puramente aditivo/atualização — nenhuma tabela ou coluna é removida.

UPDATE "Plan" SET
  "audiosPerMonth" = 100,
  features = '["Até 100 áudios/mês","1 número WhatsApp","🎙️ Conversão automática","✨ Resumo com IA","🔒 Modo Privado (opcional)","📋 Histórico de conversões","📅 Filtros por data e contato","🔍 Busca por conversão"]'::jsonb
WHERE name = 'free';

UPDATE "Plan" SET
  label = 'Profissional',
  "maxNumbers" = 1,
  features = '["Tudo do Core, sem limite de áudios","🤖 Atendimento automático 24/7 por IA","📥 Fila de conversas + assumir conversa manualmente","📊 Métricas de atendimento e efetividade","🔔 Avisos e alertas internos","📨 Avisos ao cliente (cobrança, agendamento, mercadoria pronta...)","📚 Base de conhecimento própria","🗓️ Resumo diário do atendimento"]'::jsonb
WHERE name = 'profissional';

UPDATE "Plan" SET
  label = 'Empresas',
  "maxNumbers" = 2,
  features = '["Tudo do Profissional","📊 CRM — funil de vendas no WhatsApp","✅ Tarefas — designação e controle na equipe","👥 Até 5 usuários com papéis (admin/manager/agent)"]'::jsonb
WHERE name = 'empresas';

-- Módulo Tarefas (Empresas) — cadastro do catálogo (Product), rotas/UI
-- ainda em construção. Ver packages/modules/catalog.ts.
INSERT INTO "Product" (id, key, name, status, "priceMonthly", "priceYearly", "dependsOn", "updatedAt")
VALUES (gen_random_uuid()::text, 'tarefas', 'ZapScript Tarefas', 'planned', 0, 0, ARRAY[]::TEXT[], now())
ON CONFLICT ("key") DO UPDATE SET "updatedAt" = now();
