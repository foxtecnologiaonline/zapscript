# WhatsApp oficial (Embedded Signup) — checklist de go-live

> Tudo abaixo está **preparado** na branch `feat/whatsapp-official-embedded-signup`.
> O modo Evolution (automação) continua funcionando lado a lado — `connectionType` decide o caminho por número.
> **NÃO fazer o cutover sem confirmação.** A migração de schema só vai a produção junto com o merge.

## Modelo adotado
- **Tech Provider / System User token único** (`META_SYSTEM_USER_TOKEN`) opera as WABAs dos clientes.
- Cada número guarda `wabaId` + `metaPhoneId`; o webhook roteia por `phone_number_id`.
- `connectionType`: `evolution` (padrão) | `official`. Coexistência total.

## Pré-requisitos no painel Meta (developers.facebook.com)
1. App com produto **WhatsApp** + **Facebook Login for Business**.
2. Criar uma **configuração de Embedded Signup** → anotar o **Config ID**.
3. Criar **System User** (Business Settings) com escopos `whatsapp_business_management` + `whatsapp_business_messaging`; gerar token → `META_SYSTEM_USER_TOKEN`.
4. Webhook do app apontando para `https://<API>/webhook/whatsapp`, campo `messages` assinado, verify token = `META_WEBHOOK_VERIFY_TOKEN` (= `WHATSAPP_WEBHOOK_TOKEN`).

## Variáveis de ambiente (Render + Vercel)
- **API + Worker (Render):** `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, `META_DEFAULT_REGISTER_PIN`.
  (Legados `WHATSAPP_APP_SECRET`/`WHATSAPP_WEBHOOK_TOKEN`/`WHATSAPP_API_TOKEN` servem de fallback.)
- **Web (Vercel):** `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID`.
  Sem estas, o botão "Conectar oficial" não aparece (rollout seguro).

## Sequência do cutover
1. Configurar as env vars acima (sem `NEXT_PUBLIC_*` ainda → UI não muda).
2. **Merge da branch + `prisma migrate deploy`** na mesma janela (o Render faz auto-deploy do master;
   os novos campos precisam existir no banco antes do código novo rodar — a migration
   `20260610_whatsapp_official_fields` usa `ADD COLUMN IF NOT EXISTS`, segura para reaplicar).
3. Validar webhook GET (verificação) e POST (HMAC) com o número de teste da Meta.
4. Ligar `NEXT_PUBLIC_*` no Vercel → botão "Conectar oficial" aparece.
5. Testar um número real: Embedded Signup → recebe áudio → transcrição volta pelo número certo.
6. Migrar clientes gradualmente; números antigos seguem em Evolution até reconectarem.

## Rollback
- Desligar `NEXT_PUBLIC_*` esconde o botão; números `official` existentes continuam funcionando.
- As colunas novas são aditivas e não quebram o fluxo Evolution.
