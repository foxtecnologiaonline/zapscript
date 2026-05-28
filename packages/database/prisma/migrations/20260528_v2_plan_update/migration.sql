-- ZapScript v2.0 — Atualização dos planos
-- Pro: 150→100 min/mês, R$29,90→R$39,90
-- Ultra: R$59,90→R$69,90
-- Free: atualizar features string
-- Executive: mantido no banco, apenas oculto na UI

UPDATE "Plan"
SET
  "minutesPerMonth" = 100,
  "priceBrl" = 39.90,
  "features" = '["100 min/mês","2 números WhatsApp","Transcrição automática","Resumo com pontos-chave IA","Histórico completo de transcrições"]'
WHERE name = 'pro';

UPDATE "Plan"
SET
  "priceBrl" = 69.90,
  "features" = '["300 min/mês","3 números WhatsApp","Transcrição automática","Resumo com pontos-chave IA","Histórico completo de transcrições","Filtros por data e contato","Busca no histórico"]'
WHERE name = 'ultra';

UPDATE "Plan"
SET
  "features" = '["20 min/mês","1 número WhatsApp","Transcrição automática","Resumo com pontos-chave IA"]'
WHERE name = 'free';
