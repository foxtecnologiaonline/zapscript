-- Seed do catálogo de módulos (Product) + backfill do entitlement `core` para
-- usuários existentes. Idempotente (ON CONFLICT).
--
-- Motivo: prisma/seed.ts já faz este trabalho, mas o startCommand do Render
-- roda apenas `prisma migrate deploy` (não roda o seed) — sem isto, GET /modules,
-- GET /modules/me e o campo `modules` de /auth/me ficam vazios em produção para
-- TODOS os usuários, inclusive quem já paga e usa o Core (transcrição) hoje.
-- Ver MODULOS_ARQUITETURA.md e packages/modules/catalog.ts (fonte da verdade).

INSERT INTO "Product" (id, key, name, status, "priceMonthly", "priceYearly", "dependsOn", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'core',             'ZapScript',            'ga',        39.90, 383.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'atende',           'ZapScript Atende',     'beta',      49.90, 479.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'cobranca',         'ZapScript Cobrança',   'planned',   29.90, 287.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'campanhas',        'ZapScript Campanhas',  'planned',   59.90, 575.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'crm',              'ZapScript CRM',        'planned',   39.90, 383.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'atende-qualidade', 'Atende Qualidade',     'planned',   24.90, 239.04, ARRAY['atende']::TEXT[], now()),
  (gen_random_uuid()::text, 'legenda',          'ZapScript Legendas',   'planned',   34.90, 335.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'vendas',           'ZapScript Vendas',     'planned',   44.90, 431.04, ARRAY[]::TEXT[],         now()),
  (gen_random_uuid()::text, 'multicanal',       'ZapScript Multicanal', 'discovery', 29.90, 287.04, ARRAY[]::TEXT[],         now())
ON CONFLICT ("key") DO UPDATE SET
  name           = EXCLUDED.name,
  status         = EXCLUDED.status,
  "priceMonthly" = EXCLUDED."priceMonthly",
  "priceYearly"  = EXCLUDED."priceYearly",
  "dependsOn"    = EXCLUDED."dependsOn",
  "updatedAt"    = now();

-- Backfill: todo usuário existente ganha o entitlement do módulo `core`.
-- Seguro: `core` é a base já em uso por todos (tier free/pro continua 100%
-- governado por Plan/Subscription/MinuteBalance) — isto só faz o launcher/
-- /auth/me reconhecerem o Core que a pessoa já usa, sem mudar cota ou cobrança.
INSERT INTO "Entitlement" (id, "userId", "productKey", status, source, "updatedAt")
SELECT gen_random_uuid()::text, u.id, 'core', 'active', 'bundle', now()
FROM "User" u
WHERE u."deletedAt" IS NULL
ON CONFLICT ("userId", "productKey") DO NOTHING;
