-- ZapScript 2.0 — Tiers anuais (SPEC Jul/2026), modelo "tiers absorvem os
-- módulos": cada tier empacota um conjunto fixo de módulos já existentes na
-- suíte (Atende, CRM, Vendas, Campanhas, Cobrança) em vez de vendê-los avulso.
--
-- Puramente aditivo: 3 linhas novas em "Plan" (atende/profissional/empresas).
-- free/pro/executive NÃO são renomeados nem alterados — assinantes atuais
-- continuam exatamente como estão; os tiers novos são um catálogo à parte.
-- O preço anual (680/1308/2148) vive em PLAN_PRICES_YEARLY
-- (apps/api/src/routes/billing.ts), mesmo padrão já usado por pro/executive.
--
-- Escrita à mão (não gerada por `prisma migrate dev`, indisponível neste
-- ambiente) e guardada com ON CONFLICT para poder ser reaplicada com segurança.

INSERT INTO "Plan" (id, name, label, "minutesPerMonth", "audiosPerMonth", "maxNumbers", "priceBrl", features)
VALUES
  (gen_random_uuid()::text, 'atende', 'Atende', 300, 500, 2, 59,
    '["Áudios ilimitados","2 números WhatsApp","🎙️ Conversão automática","✨ Resumo com IA","🤖 Atendimento automático 24/7 no WhatsApp","📚 Base de conhecimento própria"]'::jsonb),
  (gen_random_uuid()::text, 'profissional', 'Profissional', 400, 500, 3, 109,
    '["Tudo do Atende","📊 CRM — funil de vendas no WhatsApp","🗣️ Vendas — grave a visita, vira nota no CRM","3 números WhatsApp"]'::jsonb),
  (gen_random_uuid()::text, 'empresas', 'Empresas', 500, 500, 5, 179,
    '["Tudo do Profissional","📣 Campanhas — disparo em massa via API oficial","💰 Cobrança — lembrete automático de vencimento","👥 Equipe — múltiplos usuários","5 números WhatsApp"]'::jsonb)
ON CONFLICT ("name") DO UPDATE SET
  label              = EXCLUDED.label,
  "minutesPerMonth"  = EXCLUDED."minutesPerMonth",
  "audiosPerMonth"   = EXCLUDED."audiosPerMonth",
  "maxNumbers"       = EXCLUDED."maxNumbers",
  "priceBrl"         = EXCLUDED."priceBrl",
  features           = EXCLUDED.features;
