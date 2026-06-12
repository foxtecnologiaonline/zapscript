-- Remover a funcionalidade "Notas de Voz" das features de todos os planos
-- ─────────────────────────────────────────────────────────────────────────
-- Reconstrói o array Plan.features filtrando qualquer item que mencione
-- "Notas ... de Voz" (cobre "Notas Pessoais de Voz", "🎤 Notas Pessoais de Voz"
-- e "Notas de Voz", com ou sem emoji).

UPDATE "Plan" p
SET "features" = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(p."features"::jsonb) AS elem
    WHERE elem::text NOT ILIKE '%Notas%de Voz%'
  ),
  '[]'::jsonb
)
WHERE p."features"::text ILIKE '%Notas%de Voz%';
