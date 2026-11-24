# Balcão Virtual — API do IAM (`balcao/iam`)

Autenticação, MFA, usuários/perfis, configuração do órgão, feriados, tokens de API e consulta à auditoria.
Código: `apps/api/src/balcao/iam`; CLIs: `apps/api/src/balcao/cli`. Prefixo final: `/balcao/auth/*` e `/balcao/admin/*`.

## Convenções

- Erros: `{ "error": { "code": "dominio.codigo", "message": "…", "details"?: … } }`. Validação: `400 validation.failed` com `details: [{path,message}]`.
- Autenticação: `Authorization: Bearer <accessToken>` (JWT HS256 do Balcão, 15 min) ou token de API `bvt_…` (somente rotas com o escopo explícito; nunca `user:manage`/`org:manage`/`security:manage`).
- Todas as consultas filtram por `orgId` do chamador; recurso de outro órgão responde `404`.
- Respostas que contêm senha temporária ou token de API trazem `Cache-Control: no-store`.

## /auth

| Método e caminho | Perm. | Corpo | Resposta |
|---|---|---|---|
| `POST /auth/login` | pública | `{email, password, orgSlug?}` | `200 {accessToken, refreshToken, expiresIn, user{id,orgId,name,email,role}, mustChangePassword, mfaSetupRequired, totpEnabled}` ou, com MFA, `200 {mfaRequired:true, mfaToken, expiresIn:300}` |
| `POST /auth/login/mfa` | pública | `{mfaToken, code}` (6 dígitos) **ou** `{mfaToken, recoveryCode}` (`XXXX-XXXX`, com/sem hífen, maiúsculas ou minúsculas); exatamente um dos dois (senão `400`) | mesma sessão do login. Com `recoveryCode`: acrescenta `recoveryCodesRemaining` e, se ≤ 2, `recoveryCodesWarning`. Código inválido/já usado → `401 auth.invalid_recovery_code` |
| `POST /auth/refresh` | pública | `{refreshToken}` | nova sessão (rotação; token antigo deixa de valer) |
| `POST /auth/logout` | opcional | `{refreshToken?}` (ou Bearer) | `{ok:true}` |
| `GET /auth/me` | sessão | — | `{user{…,orgName,orgSlug,sectorId,skills,sipExtension…}, permissions[], mustChangePassword, totpEnabled, recoveryCodesRemaining (0 sem MFA), mfaSetupRequired}` |
| `POST /auth/password` | sessão | `{currentPassword, newPassword}` | `{ok, otherSessionsRevoked}`; revoga as demais sessões; limpa `mustChangePassword` |
| `POST /auth/mfa/setup` | sessão | — | `{secret (base32), otpauthUrl, digits, period, algorithm}`; segredo guardado cifrado, ainda desabilitado |
| `POST /auth/mfa/enable` | sessão | `{code}` | `{ok, totpEnabled:true, recoveryCodes:[10 × "XXXX-XXXX"], recoveryCodesRemaining:10}` — **os códigos só aparecem aqui** (`Cache-Control: no-store`); o front deve exigir que o usuário os guarde |
| `POST /auth/mfa/recovery-codes/regenerate` | sessão | `{password, code}` (senha + TOTP atual) | `{ok, recoveryCodes[10], recoveryCodesRemaining:10}` (`no-store`); invalida o conjunto anterior (inclusive os não usados). `409 mfa.not_enabled`; `403 auth.invalid_credentials` |
| `POST /auth/mfa/disable` | sessão | `{password, code}` | `{ok, totpEnabled:false}` (apaga também os códigos de recuperação) |

Regras:
- Erro de credencial é sempre `401 auth.invalid_credentials` / "E-mail ou senha inválidos." (usuário inexistente, inativo ou senha errada). E-mail presente em mais de um órgão sem `orgSlug` → `409 auth.org_required` (só depois de a senha conferir em algum deles; `details.orgs` lista os candidatos).
- 5 falhas (senha ou código MFA) → conta bloqueada por 15 min (`423 auth.locked`, header `Retry-After`), mesmo com a senha correta. O contador só zera após login completo.
- Rate limit por IP + órgão: 20 tentativas/10 min → `429 auth.rate_limited` (Redis; sem Redis não bloqueia).
- Código TOTP já usado não é aceito de novo (anti-replay, 90 s).
- **Códigos de recuperação** (`recovery.ts`): 10 por conjunto, formato `XXXX-XXXX`, alfabeto de 32 símbolos sem ambiguidade (sem I, O, 0, 1; 40 bits cada). No banco só o `sha256` (`hashToken("mfa-recovery:<código>")`) em `BvUser.mfaRecoveryHashes`. Uso único e atômico (`UPDATE … array_remove … RETURNING`, seguro contra corrida), comparação em tempo constante contra todos os hashes. Falha de `recoveryCode` conta para o mesmo lockout do TOTP (5 → `423 auth.locked`; com a conta bloqueada nada é consumido). Uso audita `auth.mfa_recovery_used` (`meta.remaining`, nunca o código). `reset-mfa` do admin e `mfa/disable` limpam os hashes.
- Reuso de refresh token já rotacionado/revogado → `401` e **todas** as sessões do usuário são revogadas (`auth.refresh_reuse` auditado).
- `security.requireMfaRoles` (settings do órgão): perfil listado sem MFA ativo recebe `mfaSetupRequired:true` (login e `/me`). **O backend não bloqueia as demais rotas** — o front deve forçar o fluxo de setup.
- `mustChangePassword:true` (senha temporária) idem: sinalizado, o front deve forçar `/auth/password`.
- Políticas: senha ≥ 12 caracteres com letras e números.

## /admin

Permissão entre parênteses. `:id` sempre do próprio órgão.

**Órgão** (`org:manage`)
- `GET /admin/org` → `{id,name,slug,settings (efetivas, com padrões), overrides (JSON bruto), security{requireMfaRoles}}`
- `PATCH /admin/org` — corpo (todos opcionais, ao menos um, chaves desconhecidas rejeitadas): `name, timezone (IANA), businessHours{sun..sat:[["HH:mm","HH:mm"]]}, protocolPrefix, language, contactCategories, recordingNotice, outsideHoursMessage, retention{messagesDays,recordingsDays,auditDays,logsDays}, sla{firstResponseSec,resolutionSec}, ai{enabled,mode,confidenceThreshold,welcomeMessage,escalationKeywords,maxBotTurns}, csat{enabled,prompt}, webchat{allowedOrigins,title,primaryColor,offlineMessage}, whatsapp{windowHours}, reopenWindowSec, security{requireMfaRoles[]}`. Merge profundo (objetos) / substituição (arrays). Para fechar um dia envie `"mon": []`. Grava `BvConfigVersion('org-settings')` e audita `org.update` com antes/depois.

**Setores** — `GET /admin/sectors?active=` (`user:manage` ou `queue:manage`); `POST` `{name,email?}`, `PATCH /:id` `{name?,email?,active?}`, `DELETE /:id` (`user:manage`; `409 sector.in_use` se houver usuários/filas — desative com `active:false`).

**Usuários** (`user:manage`)
- `GET /admin/users?q=&role=&active=&sectorId=&limit=&cursor=` → `{items,total,nextCursor}` (ordem nome, id)
- `GET /admin/users/:id`
- `POST /admin/users` `{email,name,role,skills?,maxConcurrent?,sectorId?,sipExtension?}` → `201 {user, temporaryPassword}` (senha mostrada uma única vez, `mustChangePassword=true`). `409 user.email_taken | user.sip_taken`.
- `PATCH /admin/users/:id` `{name?,role?,skills?,maxConcurrent?,sectorId?|null,sipExtension?|null}`
- `POST /admin/users/:id/deactivate | activate | reset-password | reset-mfa | unlock` (reset-password devolve `{user,temporaryPassword}`; desativar/reset revogam sessões)
- `POST /admin/users/bulk[?format=csv]` `{users:[{email,name,role,skills?,sectorId?|sectorName?}]}` (1–500 linhas). Resposta `{total,created,failed,results:[{row,email,ok,id?,temporaryPassword?,error?{code,message}}]}`; linha inválida/duplicada não impede as demais. `422` se nada foi criado e houve falhas. Com `format=csv`: `linha,email,ok,senha_temporaria,erro`.
- Salvaguardas: ninguém altera o próprio perfil nem se desativa/reseta senha por esta rota (`403 user.self_change`); nunca se remove o último ADMIN ativo (`409 user.last_admin`, com lock `SELECT … FOR UPDATE`, seguro contra corrida).

**Feriados** (`org:manage`) — `GET /admin/holidays?year=`, `POST {day:"AAAA-MM-DD",name}`, `POST /bulk {items[]}` (upsert), `PATCH /:id`, `DELETE /:id`. Invalidam o cache do core (`invalidateHolidays`).

**Tokens de API** (`security:manage`) — `GET /admin/tokens`; `POST {name, scopes[]}` → `201 {id,name,scopes,token:"bvt_…"}` (em claro só nesta resposta; banco guarda hash); `DELETE /:id` revoga (idempotente). Escopos = permissões do core, exceto `user:manage`, `org:manage`, `security:manage`.

**Auditoria** (`audit:read`) — `GET /admin/audit?actorId=&action=&entityType=&entityId=&from=&to=&limit=&cursor=&format=`. `action` exato ou prefixo com `*` (`user.*`). JSON: `{items[{…,actorName}],nextCursor}` (mais recentes primeiro). `format=csv` exporta (até 50 000 linhas, `X-Truncated: true` se cortar) e audita `audit.export`.

Ações auditadas: `auth.login|login_failed|login_blocked|lockout|mfa_failed (meta.method totp|recovery)|mfa_recovery_used|mfa_recovery_regenerate(_failed)|logout|refresh_reuse|password_change(_failed)|mfa_setup|mfa_enable|mfa_disable(_failed)`, `org.update`, `sector.*`, `user.create|update|deactivate|activate|reset_password|reset_mfa|unlock|bulk_create`, `holiday.*`, `apitoken.create|revoke`, `audit.export`. Senhas, segredos e tokens nunca entram em `before/after/meta`.

## Variáveis de ambiente

Usa as do core (`JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`). Opcionais do IAM (padrão entre parênteses):
`BV_LOGIN_RL_MAX` (20), `BV_LOGIN_RL_WINDOW_SEC` (600), `BV_LOGIN_MAX_FAILS` (5), `BV_LOGIN_LOCK_MIN` (15). CLIs: `BV_ADMIN_PASSWORD`, `BV_DEMO_PASSWORD`. (Registrar em `docs/balcao/ENV.md` na consolidação.)

## CLIs

Rodam em `apps/api` com `ts-node`, leem `DATABASE_URL`, são idempotentes.

```bash
cd apps/api
# Órgão + primeiro ADMIN (senha por env, política ≥12 com letras e números)
BV_ADMIN_PASSWORD='SenhaForte12345' npx ts-node src/balcao/cli/create-org.ts \
  --name "TJTO" --slug tjto --admin-email admin@tjto.jus.br [--admin-name "Nome"] [--reset-password]

# Órgão demo (slug demo): 1 ADMIN, 1 SUPERVISOR, 3 ATENDENTE (ramais 6001–6003), 1 FISCAL,
# 3 setores, 3 filas com membros/categorias, 10 artigos de FAQ APPROVED, feriados nacionais 2026–2027, 6 cotas
BV_DEMO_PASSWORD='DemoSenha12345' npx ts-node src/balcao/cli/seed-demo.ts [--slug demo]
```
Usuários demo: `admin|supervisor|atendente1..3|fiscal@demo.balcao.local`. Sem `BV_DEMO_PASSWORD`, uma senha é gerada e impressa uma vez (usuários já existentes mantêm a senha). Os artigos de FAQ são textos genéricos de exemplo — o órgão deve revisá-los.

## Testes

`source <scratchpad>/bv-env.sh && cd apps/api && npx jest --runInBand src/balcao/iam` (34 testes, incluindo `mfa-recovery.test.ts` — geração/unicidade, hash no banco, uso único e concorrente, reuso recusado, regeneração invalida os antigos, lockout, disable/reset-mfa limpam —; login/lockout/rate limit/MFA/refresh+reuso/logout/senha/RBAC/usuários/corrida do último admin/bulk/token de API/auditoria/org/feriados/isolamento/CLIs). Exige Postgres e Redis locais.

## Não verificado

- Execução contra o **plugin raiz completo** (`/balcao` com todas as frentes): os testes montam só o plugin IAM; o prefixo `'/'` aninhado foi coberto pelo teste do core.
- Compatibilidade com **apps autenticadores reais** (Google Authenticator/Authy): o TOTP foi validado contra implementação própria RFC 6238 (SHA1, 6 dígitos, 30 s), não contra um app.
- **Revogação imediata do access token**: `bvAuth` (core) não consulta `BvSession`; após logout/troca de senha/reuso o *access token* já emitido segue válido até expirar (≤ 15 min). Refresh é bloqueado na hora; usuário desativado é barrado em ≤ 10 s (cache; instantâneo no mesmo processo).
- Cache de settings/feriados do core é por processo (TTL 30 s): com várias réplicas da API, a alteração propaga em até 30 s nas demais.
- Carga: cadastro em massa de 500 linhas foi testado com ~120 linhas (scrypt assíncrono, concorrência 8); não houve teste de carga de ~290 logins simultâneos.
- Rate limit de login fail-open sem Redis (por projeto); bloqueio por conta continua valendo.
- Execução dos CLIs em produção (Vultr/Supabase) — rodados apenas contra o Postgres local.
- Códigos de recuperação: 40 bits de entropia por código, protegidos só pelo lockout (5 falhas → 15 min) e pelo rate limit por IP (fail-open sem Redis); não há expiração do conjunto nem aviso por e-mail ao usar um código. Sem código nem dispositivo, a recuperação continua sendo `reset-mfa` por um ADMIN. A exibição/impressão dos códigos e a obrigação de o usuário guardá-los são do front.
- Migração `20261124_balcao_virtual_3` (`mfaRecoveryHashes`) aplicada só ao Postgres local; usuários que já tinham MFA ativo ficam com 0 códigos (gerar via `regenerate`).
- OIDC/gov.br: fora desta frente (integrations).
