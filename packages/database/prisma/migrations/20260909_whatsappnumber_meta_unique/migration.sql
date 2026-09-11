-- Corrige a ambiguidade de dono ao resolver WhatsappNumber por número: o webhook
-- oficial (routes/whatsapp-webhook.ts) atribuía mensagem/status/opt-out de campanha
-- a "o primeiro WhatsappNumber que bater com esse phoneNumber" (findFirst sem
-- desempate), porque phoneNumber nunca teve constraint única no schema — ver
-- CAMPANHAS_ARQUITETURA.md §7.6.
--
-- Verificado em produção antes de aplicar (read-only, 2026-09-09):
--   • 1 duplicata existente hoje: phoneNumber='...229', provider='evolution',
--     2 linhas do MESMO userId (não é colisão entre tenants) — por isso a
--     constraint abaixo é restrita a provider='meta', que hoje tem ZERO linhas
--     (Campanhas ainda não tem nenhum número Meta conectado em produção).
--   • Nenhuma duplicata de metaPhoneNumberId.
-- Portanto ambas as constraints entram limpas, sem necessidade de backfill/cleanup.
--
-- 1) metaPhoneNumberId — ID atribuído pela própria Meta, globalmente único por
--    natureza. UNIQUE padrão (não parcial): Postgres permite múltiplos NULL sob uma
--    constraint UNIQUE normal, então não impacta as linhas 'evolution' (sempre NULL).
CREATE UNIQUE INDEX "WhatsappNumber_metaPhoneNumberId_key" ON "WhatsappNumber"("metaPhoneNumberId");

-- 2) phoneNumber — só faz sentido único DENTRO do provider 'meta' (evolution pode
--    legitimamente repetir por outros motivos, e 'pending' é o placeholder usado por
--    toda linha ainda não conectada). Índice parcial — não representável no DSL do
--    Prisma, mantido só como SQL de migration; ver comentário em schema.prisma.
CREATE UNIQUE INDEX "WhatsappNumber_meta_phoneNumber_unique_idx"
  ON "WhatsappNumber" ("phoneNumber")
  WHERE provider = 'meta' AND "phoneNumber" <> 'pending';
