-- Atualizar plano Pro: 100min → 200min, R$29,90 → R$39,90
-- Motivo: novo Pro é o plano flagship com todas as features (exceto webhook personalizado)
UPDATE "Plan"
SET
  "minutesPerMonth" = 200,
  "priceBrl"        = 39.90,
  "label"           = 'Pro',
  "features"        = '["200 min/mês","2 números WhatsApp","Transcrição automática","Resumo com IA","Histórico completo","Notas de Voz","Modo Privado"]'
WHERE "name" = 'pro';
