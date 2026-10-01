-- ════════════════════════════════════════════════════════════════════════════
-- BLINDAGEM DO BANCO — RLS deny-all + revogação de grants da API pública
--
-- Problema: o Supabase expõe o schema "public" via PostgREST (/rest/v1) para as
-- roles "anon" e "authenticated". A anon key é pública (vai no bundle do browser:
-- NEXT_PUBLIC_SUPABASE_ANON_KEY). Sem RLS, qualquer pessoa com essa chave lia e
-- ESCREVIA em User, Subscription, RefreshToken, ApiKey, CreditWallet etc.
--
-- Todo acesso legítimo passa pela API/Worker via Prisma (role "postgres", que tem
-- BYPASSRLS) ou pela service_role (BYPASSRLS) no Storage — nenhum dos dois é
-- afetado. O front só usa Supabase Storage com signed upload URL (não depende de
-- policies em public). Logo: RLS ligada sem nenhuma policy = deny-all para
-- anon/authenticated, que é exatamente o desejado.
--
-- Idempotente. Seguro rodar mais de uma vez.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  -- 1) RLS em TODAS as tabelas do schema public (inclui _prisma_migrations)
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;

  -- 2) Defesa em profundidade: remove qualquer privilégio das roles da API pública
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $$;
