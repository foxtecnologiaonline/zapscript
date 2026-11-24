# Balcão Virtual — API de segurança (`balcao/security`)

LGPD (direitos do titular), retenção, rotação de chaves de campo, exportação integral de fim de contrato, postura de
segurança, incidentes (prazo de 24 h) e guarda legal. Código: `apps/api/src/balcao/security`; infra: `infra/backup`, `infra/ha`.
Prefixo final: `/balcao/security/*`. Infra, certificações e residência de dados: `INFRA-BR-CERTIFICACOES.md`.

## Convenções

- Erros: `{ "error": { "code": "dominio.codigo", "message": "…" } }`; validação `400 validation.failed`. Tudo filtra por `orgId` do chamador (recurso de outro órgão → `404`).
- Somente JWT de usuário: **tokens de API (`bvt_…`) nunca passam** nesta frente. Perfis: ADMIN tem tudo; SUPERVISOR tem `contact:lgpd` e `audit:read`; FISCAL tem `audit:read`.
- Toda ação relevante vai para a trilha de auditoria (append-only, trigger no banco). Nenhum log contém corpo de mensagem, CPF, token ou chave.

## Endpoints

| Método e caminho | Perm. | Descrição |
|---|---|---|
| `POST /public/dsr` | pública (rate limit 10/h/IP e 3/h/e-mail) | `{org (slug), email, type, justification?}` → `202` sempre igual (não revela se e-mail/órgão existem). Envia e-mail com link de **uso único** (TTL `BV_DSR_VERIFY_TTL_SEC`, padrão 1 h). |
| `GET /public/dsr/confirm?token=` | pública | Página mínima com botão (o GET não consome o token: scanners de e-mail não confirmam sozinhos). |
| `POST /public/dsr/verify` | pública | `{token}` → consome o token (DEL atômico no Redis), localiza o titular pelo e-mail e abre `BvDataSubjectRequest` `OPEN` (`origin: PUBLIC`); notifica ADMIN/SUPERVISOR. **Nunca** executa exclusão/anonimização sozinho. |
| `POST /dsr` | `contact:lgpd` ou `security:manage` | `{contactId, type: ACCESS\|EXPORT\|DELETE\|ANONYMIZE, note?, justification?}` → `201` (ou `200` se já havia igual aberta). |
| `GET /dsr?status=&limit=` · `GET /dsr/:id` | idem | Lista/detalhe (inclui `report` quando concluída). |
| `POST /dsr/:id/process` | idem | `{justification?, redactAllMessages?}`. ACCESS/EXPORT geram JSON do titular (sha256, expira em 30 d). ANONYMIZE: corpo das mensagens do titular, anexos, gravações, números, IP/UA, comentário de CSAT, **texto das sugestões de IA** e identidades removidos; métricas e trilha de auditoria permanecem. DELETE exige justificativa (≥ 10 caracteres). **Sob guarda legal** DELETE/ANONYMIZE são recusados (`REJECTED`, registrado). Idempotente. |
| `POST /dsr/:id/reject` | idem | `{reason}` (≥ 5 caracteres). |
| `GET /dsr/:id/export` | idem | Baixa o JSON do titular (autenticado, `Range`, auditado a cada requisição). |
| `POST /retention/run?dryRun=1&batchSize=&maxBatches=` | `security:manage` | Executa/simula a retenção do órgão. `409` se já houver execução. |
| `GET /retention/runs` | `security:manage` ou `audit:read` | Últimas 100 execuções (`BvRetentionRun`). |
| `GET /legal-hold` · `PUT /legal-hold` | leitura: `security:manage`/`audit:read`; escrita: `security:manage` | `{active, basis (obrigatório se active), until?}`; versionado e auditado. Suspende retenção (mensagens, gravações, auditoria), anonimização e exclusão. |
| `GET /keys/status` | `security:manage` | Contagem de registros por `kid` e coluna (nunca material de chave). |
| `POST /keys/rotate` | `security:manage` | `{batchSize?, maxRows? (padrão 20 000)}` → recifra para `BV_FIELD_KEY_CURRENT`; `done` e `remaining`. Idempotente/retomável. |
| `POST /export` | `security:manage` **e** `org:manage` | `{format: JSON\|CSV\|XML\|SQL, includeDocuments=false, includeFiles=true}` → `202 {id}`. Um por vez (`409 export.busy`). |
| `GET /exports` · `GET /exports/:id` | `security:manage` | Estado, progresso, `sha256`, tamanho, totais. |
| `GET /exports/:id/download` | `security:manage` | `.tar.gz` (streaming, `Range`, `X-Content-SHA256`); **cada requisição é auditada** (`security.export.download`, com o `Range`). Expira em 7 dias. |
| `GET /posture` | `security:manage` ou `audit:read` | Checagens objetivas (chaves, JWT, MFA, retenção, backup/restauração, TLS via proxy, permissões do storage, trigger de auditoria, residência declarada, DSR vencidas, incidentes). Sem segredos. |
| `POST /incidents` · `PATCH /incidents/:id` | `security:manage` | `{title, description, dataAffected[], affectedSubjects?, severity, awareAt, notifiedAt?, notifiedTo?, measures?, status?}`. Prazo = `awareAt + 24 h`. |
| `GET /incidents` · `GET /incidents/:id` | `security:manage` ou `audit:read` | Lista/detalhe com histórico de versões. |

### Exportação integral — conteúdo

`.tar.gz` com `data/<entidade>.<json|csv|xml|sql>` (≈ 40 entidades: usuários, filas, regras, URA, KB, contatos, conversas, eventos, mensagens **decifradas**, chamadas, tarefas, auditoria, uso, cotas, integrações **sem segredos**, DSR, retenção…),
`files/<chave>` (anexos e gravações) e `manifest.json` (sha256, bytes e linhas de cada arquivo, arquivos ausentes). Não exporta hash de senha, TOTP, tokens nem credenciais. CPF/CNPJ só com `includeDocuments:true` (auditado separadamente). Verificação: `tar -xzf` e conferir `sha256sum` de cada arquivo com o manifesto.

## Jobs (registrados em `core/scheduler`, com lock Redis — seguros com N réplicas; desligados com `BV_JOBS=off`)

| Job | Intervalo | O que faz |
|---|---|---|
| `balcao.security.retention` | 24 h | Retenção de todos os órgãos: mensagens (corpo/anexos/metadados do canal e texto de sugestões de IA), gravações (e máscara de números), logs de integração, auditoria (≥ `BV_AUDIT_MIN_DAYS`), exportações vencidas. Grava `BvRetentionRun` e auditoria. |
| `balcao.security.exports` | 60 s | Retoma exportações `PENDING` órfãs e marca `RUNNING` > 6 h como falha. |
| `balcao.security.incident-reminders` | 15 min | Lembra ADMINs quando faltam ≤ 6 h para as 24 h (e a cada hora depois de vencido). |

## CLIs

```sh
# no contêiner da API (WORKDIR /app):
node apps/api/dist/balcao/security/cli/rotate-field-keys.js --status [--org <orgId>]
node apps/api/dist/balcao/security/cli/rotate-field-keys.js [--org <orgId>] [--batch 200] [--max 100000]
# desenvolvimento: cd apps/api && npx ts-node src/balcao/security/cli/rotate-field-keys.ts --status
```
Saída só com contagens; código 1 se sobrou registro/falha. Scripts de infra: `infra/backup/*.sh`, `infra/ha/scripts/*`; carga: `apps/api/scripts/balcao-smoke-load.ts`.

## Variáveis de ambiente (seção security; ver também `ENV.md`)

| Variável | Uso |
|---|---|
| `ENCRYPTION_KEY` | 64 hex; chave mestra (deriva a chave de campo `0`). Obrigatória. |
| `BV_FIELD_KEYS` | JSON `{"1":"<64 hex>","2":"<64 hex>"}` — chaves de campo versionadas (AES-256-GCM). |
| `BV_FIELD_KEY_CURRENT` | `kid` usado para cifrar novos valores (padrão: maior kid de `BV_FIELD_KEYS`, senão `0`). |
| `BV_AUDIT_MIN_DAYS` | Piso de retenção da auditoria (padrão 365). |
| `BV_DSR_VERIFY_TTL_SEC` | Validade do link do titular (padrão 3600). |
| `BV_PUBLIC_API_URL` (ou `API_URL`) | Base do link enviado por e-mail ao titular. |
| `BV_STORAGE_DIR` | Raiz do storage de objetos (anexos, gravações, exportações). |
| `BV_JOBS=off` | Desliga os jobs (ex.: réplica auxiliar). |
| `BV_BACKUP_STATUS_FILE` | JSON gerado por `infra/backup` que a postura lê. |
| `BV_BACKUP_DIR`, `BV_PG_URL`, `BV_BACKUP_AGE_RECIPIENT`, `BV_BACKUP_AGE_IDENTITY_FILE`, `BV_BACKUP_KEY_FILE`, `BV_BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, `BV_BACKUP_UPLOADER`, `BV_BACKUP_S3_URI`, `BV_BACKUP_S3_ENDPOINT`, `BV_BACKUP_RCLONE_DEST`, `BV_BACKUP_ALERT_WEBHOOK`, `BV_RESTORE_PG_URL`, `BV_STORAGE_BACKUP_EXPORTS` | Scripts de backup/restauração (**não** lidas pela API) — `infra/backup/backup.env.example`. |
| `BV_DATA_RESIDENCY=BR` | Atestação do operador de que banco, storage, backup e LLM estão no Brasil. **Declarar só após confirmar** (não é prova técnica). |
| `BV_SMOKE_BASE/EMAIL/PASSWORD/ORG/TOKEN` | Só para `balcao-smoke-load.ts`. |

Configuração por órgão (`settings`): `retention {messagesDays, recordingsDays, auditDays, logsDays}`; `security.requireMfaRoles` (iam); `security.legalHold` (endpoint acima).

## Runbooks

### Restauração de backup
Procedimento completo em `infra/backup/README.md` (verificar sha256 → decifrar com a chave privada age/openssl guardada fora do servidor → `pg_restore` em banco novo → restaurar o storage do **mesmo dia** → subir a API com as **mesmas** `ENCRYPTION_KEY` e `BV_FIELD_KEYS` → `rotate-field-keys --status` e `GET /posture`). Prova periódica: `pg-restore-test.sh` (mensal) grava `rtoSeconds`. DR de site: `infra/ha/RUNBOOK-failover.md`.

### Rotação de chave de campo
1. Gerar: `openssl rand -hex 32`. Acrescentar ao `.env` do servidor **sem remover as antigas**: `BV_FIELD_KEYS={"1":"…","2":"<nova>"}` e `BV_FIELD_KEY_CURRENT=2`. Guardar a nova chave no cofre (junto do histórico). Reiniciar as réplicas (uma por vez: `infra/ha/scripts/rolling-restart.sh`).
2. `GET /keys/status` (ou a CLI `--status`): novos registros já usam `kid 2`; os antigos aparecem com `kid 1`/`_plain`.
3. `POST /keys/rotate` repetidamente (ou a CLI, fora do horário de pico) até `done:true`/`remaining:0`. Falhas são contadas por tabela, nunca com valores.
4. Só depois de `remaining:0` **e** de expirar a rotação dos backups que usam a chave antiga (`BV_BACKUP_KEEP_*`) é que a chave antiga pode sair do `.env` — mantenha-a no cofre enquanto existir backup/exportação cifrado com ela. Cobre: `BvMessage.body`, `BvContact.documentEnc`, `BvUser.totpSecretEnc`, `BvIntegration.configEnc` e o texto de sugestões de IA em `BvConversationEvent.data.textEnc`.
5. Chave comprometida: trocar `BV_FIELD_KEY_CURRENT` imediatamente, rotacionar tudo, tratar como incidente (abaixo) e considerar `ENCRYPTION_KEY`/`JWT_SECRET`/credenciais de integração.

### Pedido de titular (DSR) — prazo legal de 15 dias (LGPD art. 19, II)
1. Entrada: titular em `/public/dsr` (e-mail verificado) ou atendente em `POST /dsr`. A postura acusa solicitações abertas há > 15 dias.
2. Confirmar identidade (e-mail verificado já cobre acesso básico; para exclusão, validar também por GOV.BR/documento conforme a política do órgão).
3. `ACCESS/EXPORT`: `POST /dsr/:id/process` → entregar o JSON por canal seguro (`GET /dsr/:id/export`). `ANONYMIZE`: preferível à exclusão (preserva métricas). `DELETE`: exige justificativa/base legal.
4. Se houver **guarda legal** (`PUT /legal-hold`), a recusa é automática e deve ser comunicada ao titular com a base (LGPD art. 16, I). Backups antigos não são reescritos; expiram pela rotação (documentar no RIPD).
5. Evidência: relatório em `GET /dsr/:id` e entradas `dsr.*` na auditoria.

### Incidente de segurança (DPA/Anexo G: comunicar o contratante em até 24 h da ciência)
1. Conter (revogar sessões/chaves, isolar host, `PUT /legal-hold` se for necessário preservar evidências) e **registrar imediatamente** `POST /incidents` com `awareAt` = momento da ciência (começa o relógio; ADMINs são notificados).
2. Comunicar o TJ-TO pelo canal formal do contrato; registrar `PATCH /incidents/:id {notifiedAt, notifiedTo}`. Lembretes automáticos a partir de 6 h antes do prazo; a postura mostra `FAIL` se vencido.
3. Atualizar `dataAffected`, `affectedSubjects`, `measures`, `status` (CONTAINED → CLOSED); todo estado fica versionado. Avaliar comunicação à ANPD/titulares (LGPD art. 48) com o encarregado do órgão — decisão jurídica, fora do sistema.

## Não verificado

- Backups: os scripts foram testados contra o Postgres local (backup → restauração → contagens; falhas provocadas), mas **não** contra o Supabase/Vultr de produção, nem com upload S3/rclone real, nem as imagens Docker (`docker build`), systemd/cron e `shellcheck` (indisponíveis no ambiente).
- HA: nginx (sem `nginx -t`), HAProxy/Sentinel/pgBackRest e os composes de HA **não foram subidos**; só `docker compose config` e uma réplica Postgres em streaming com promoção (local, sem TLS/pgBackRest) foram exercitados. Multi-zona real depende de contratação.
- Rotação, retenção, DSR, exportação, postura e incidentes: cobertos por testes automatizados (Postgres/Redis locais); **não** testados com volume de produção (exportação/rotação de milhões de linhas, tempo e memória).
- E-mail de verificação do titular: testado com mailer simulado; o envio real (Resend, hoje possivelmente fora do Brasil) não foi exercitado.
- `BV_DATA_RESIDENCY`, ISO 27001/SOC 2/ISO 27017, DPA e prazos contratuais: declarativos/contratuais — ver `INFRA-BR-CERTIFICACOES.md`.
- Exclusão de titular não alcança `BvKbSuggestion`/texto livre de tarefas e notas internas (a frente `ai`/`tasks` deve garantir que não gravam PII); conferir no RIPD.
- Posture `tls.proxy` só vê `X-Forwarded-Proto` da requisição de quem consulta; não prova o TLS dos demais caminhos.
- O storage de objetos é disco local: replicação multi-host/DR de arquivos depende de storage S3 no Brasil (mudança em `core/storage.ts`, fora desta frente).
- Voz: `startVoice` abre ARI em cada réplica da API; não há exclusão mútua verificada para 2+ réplicas.
