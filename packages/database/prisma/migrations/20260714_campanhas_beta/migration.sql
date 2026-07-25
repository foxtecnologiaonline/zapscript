-- ZapScript Campanhas — promove o módulo de 'planned' para 'beta' (contratável).
-- Motivo: schema (Campanha/CampanhaContato/CampanhaOptOut), serviço Meta Graph,
-- rotas /modules/campanhas/*, worker de disparo e webhook (status de entrega +
-- opt-out por palavra-chave) já implementados. Libera contratação/checkout em
-- produção — ver packages/modules/catalog.ts (fonte da verdade) e billing.ts
-- (gate: product.status === 'planned' | 'discovery' bloqueia checkout).
-- Idempotente: UPDATE sem efeito colateral se já estiver em 'beta'.

UPDATE "Product"
SET status = 'beta', "updatedAt" = now()
WHERE key = 'campanhas';
