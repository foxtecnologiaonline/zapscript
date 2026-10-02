# Escopo de execução — Itens 1 a 8 (`ZAPSCRIPT_VS_TWILIO.md`)

> Preparado 2026-10-02. Fecha os gaps P0/P1 de plataforma identificados na análise
> ZapScript × Twilio. **6 fases, 6 prompts** — rodar em ordem, uma conversa por fase.

## Ordem de execução (por dependência, não pela numeração)

| Fase | Item(s) | Por que nesta posição |
|---|---|---|
| 0 | **6** — códigos de erro | Fundação. Itens 1, 2 e 5 todos expõem código de erro. Barato |
| 1 | **3 + 1** — idempotência + API de escrita | 3 é pré-requisito duro de 1: sem ele, retry duplica mensagem |
| 2 | **2** — sistema de eventos | Independente. Reusa BullMQ/DLQ |
| 3 | **5** — log de mensagens | Depende da Fase 0 |
| 4 | **4 + 8** — template in-app + header de mídia | Mesma superfície (Graph API `message_templates` + envio) |
| 5 | **7** — métricas | Independente; melhor com 1, 2 e 5 já emitindo dado |

**Não paralelizar Fase 0 com as outras.** O resto pode ir em paralelo depois dela.

## Convenções do repo (obrigatórias em toda fase)

- **Migration:** `packages/database/prisma/migrations/20261002_<snake_case>/migration.sql` — SQL escrito à mão, segue o padrão de `20260923_failed_job_dlq`.
- **Validação:** zod em `apps/api/src/lib/validation.ts`, exportando `<nome>Schema`; consumir via `validateRequest(schema)(req.body)`.
- **Teste:** jest (`npm test` em `apps/api`, `--runInBand`), mock de `../lib/prisma` com `jest.fn()` por model — ver `apps/api/src/__tests__/campanhas.test.ts`.
- **Rate limit por rota:** `config: { rateLimit: { max, timeWindow } }`.
- **Log:** `logger` de `lib/logger` (pino), prefixo `[Modulo]`.
- **Segredo em repouso:** `encryptStr`/`decryptStr` de `services/encryption.ts`.
- **Não quebrar o contrato atual** de `/public/v1/{me,conversations,contacts}` nem de `transcription.completed`.

---

## Fase 0 — Item 6: códigos de erro normalizados

**Problema:** `CampanhaContato.errorMessage` é texto livre cortado em 500 chars. Suporte não consegue agrupar nem documentar falha.

**Entregar:**
- `packages/modules/error-codes.ts` — catálogo único (igual padrão de `catalog.ts`: dado puro, zero import). Cada entrada: `code` (ex. `ZS-1001`), `httpStatus`, `message` PT-BR, `retryable: boolean`, `docUrl`.
- Faixas: `1xxx` auth/permissão · `2xxx` validação · `3xxx` canal WhatsApp (Meta/Evolution) · `4xxx` quota/billing · `5xxx` interno.
- Mapear erro da Graph API → código ZapScript em `apps/api/src/services/whatsapp-campaigns.ts` e `whatsapp-official.ts`.
- `CampanhaContato.errorCode String?` + índice `[campanhaId, errorCode]`. **Manter `errorMessage`** (texto cru pra debug).
- Helper `toZapError(err): { code, message, retryable }`.

**Pronto quando:** todo `reply.code(4xx|5xx)` em `routes/modules/campanhas.ts` e `publicApi.ts` devolve `{ error, code }`; falha de envio grava `errorCode`; teste cobre 3 erros reais da Graph API (template inexistente, rate limit, número inválido).

---

## Fase 1 — Itens 3 + 1: idempotência + API de escrita

**Problema:** `publicApi.ts` só lê (`/me`, `/conversations`, `/contacts`). Sem escrita não há Zapier/Make/n8n nem ERP — e o tier Empresas não se sustenta.

### Item 3 primeiro (pré-requisito)
- Model `IdempotencyKey`: `key`, `userId`, `endpoint`, `requestHash`, `responseStatus`, `responseBody Json`, `createdAt`, `@@unique([userId, key])`, índice em `createdAt` (TTL 24h via cron no worker).
- Middleware `lib/idempotency.ts`: lê header `Idempotency-Key` (obrigatório nas rotas de escrita).
  - Chave nova → executa, grava resposta.
  - Chave repetida **com mesmo** `requestHash` → devolve a resposta gravada + header `X-Idempotent-Replay: true`.
  - Chave repetida **com body diferente** → `409` + código da Fase 0.

### Item 1 — rotas (todas em `/public/v1`, auth `requireApiKey`)
| Rota | Escopo novo | Observação |
|---|---|---|
| `POST /messages` | `messages:write` | Envia texto por um número do usuário. Respeita opt-out, janela 24h e tier |
| `POST /contacts` | `contacts:write` | Cria/atualiza `CrmContact` (upsert por `phone`) |
| `PATCH /contacts/:id` | `contacts:write` | Move de estágio, atualiza tags/valor |
| `POST /campanhas` | `campanhas:write` | Cria campanha em `draft` |
| `POST /campanhas/:id/contacts` | `campanhas:write` | Adiciona contatos em lote (máx. 1000/req) |
| `POST /campanhas/:id/start` | `campanhas:write` | Dispara — reusa a lógica do painel, **não duplicar** |

**Regras duras:**
- Estender `ALLOWED_SCOPES` em `lib/apiKeyAuth.ts`; chave existente **não** ganha escopo novo automaticamente.
- `POST /messages`: reusar `sendTextWithRetry` / `sendTemplateMessage`. **Zero caminho de envio novo.**
- Debitar `CampanhaBalance` pelo mesmo helper do painel (`lib/campanha-credit.ts`).
- Rate limit de escrita mais apertado que leitura: `max: 20, timeWindow: '1 minute'`.
- Paginação por cursor nos GETs existentes (`?cursor=&limit=`), mantendo o formato `{ data }` e adicionando `{ next_cursor }`.

**Pronto quando:** `POST /messages` com a mesma `Idempotency-Key` duas vezes envia **uma** mensagem; sem o header devolve 400; escopo faltando devolve 403 com código; Swagger atualizado.

---

## Fase 2 — Item 2: sistema de eventos

**Problema:** `dispatchWebhook` (`apps/worker/src/index.ts:662`) é fire-and-forget (`.catch(() => null)`), 1 URL por usuário (`WebhookConfig.userId @unique`), **1 evento só**, timeout 5s, sem retry e sem log.

**Entregar:**
- Models:
  - `WebhookEndpoint` — `userId`, `url`, `secret` (cifrado), `events String[]`, `active`, `description`. **Vários por usuário** (máx. 5). Migrar cada `WebhookConfig` existente pra 1 endpoint com `events: ['transcription.completed']`.
  - `WebhookDelivery` — `endpointId`, `event`, `payload Json`, `responseStatus`, `attempts`, `error`, `deliveredAt`, `nextRetryAt`. Índices `[endpointId, createdAt]` e `[nextRetryAt]`. Retenção 7 dias.
- Fila BullMQ `webhooks` (`attempts: 5`, `backoff: exponential 10s` → 10s/20s/40s/80s/160s), esgotada vai pro DLQ existente via `lib/dlq.ts`.
- Eventos: `transcription.completed` (manter), `message.received`, `message.sent`, `delivery.status`, `conversation.escalated`, `campaign.completed`, `campaign.paused`, `contact.optout`.
- Emissor único `services/events.ts` → `emitEvent(userId, event, data)`. Chamar dos pontos que já existem (webhook Evolution/Meta, `atende-agent`, `campanhas.ts` do worker).
- Assinatura: manter `X-ZapScript-Signature` (HMAC-SHA256) + `X-ZapScript-Event` + novo `X-ZapScript-Delivery` (id). Reusar o guard anti-SSRF de `routes/webhook-config.ts` — **extrair pra `lib/safe-url.ts`, não copiar**.
- `GET /webhook-endpoints/:id/deliveries` — últimas 100 entregas + `POST .../deliveries/:id/replay`.
- Liberar do plano `executive` para `profissional` e `empresas`.

**Pronto quando:** endpoint que devolve 500 é retentado 5x com backoff e aparece em `WebhookDelivery` com `attempts: 5`; URL interna é rejeitada; evento não assinado não é entregue; `transcription.completed` continua chegando igual pra quem já tinha webhook.

---

## Fase 3 — Item 5: log de mensagens do usuário

**Problema:** `FailedJob`/DLQ existe mas só no admin (`/sys/g5r8t2/failed-jobs`). O cliente não vê por que a mensagem falhou.

**Entregar:**
- `GET /messages/log` (sessão JWT) — união de `AtendeMessage`, `CampanhaContato` e `Transcription` numa view normalizada: `{ id, direction, channel, phone, status, errorCode, errorMessage, origin, createdAt }`.
- Filtros: `?status=`, `?errorCode=`, `?phone=`, `?from=`, `?to=`, `?origin=atende|campanha|transcricao`, cursor.
- `GET /messages/log/:id` — timeline da mensagem (`queued → sent → delivered → read`/`failed`) com tentativas.
- Escopo de time via `teamScope.ts` (`agent` vê só o que atende; `manager`+ vê tudo).
- Telefone **mascarado** por `lib/mask.ts` para role `agent`.
- Página `/app/logs` no Next.js — tabela, filtro, badge de status, tema claro/escuro.

**Pronto quando:** falha de campanha aparece no log com código da Fase 0 em < 5s; `agent` não vê telefone inteiro; filtro por `errorCode` funciona.

---

## Fase 4 — Itens 4 + 8: template in-app + header de mídia

**Problema:** cliente precisa ir ao Business Manager criar template (maior fricção do canal Meta). Decisão §6.3 era adiar — **revertida**: `listTemplates` já fala com `/{waba}/message_templates`; criar é o mesmo endpoint em `POST`.

**Entregar (item 4):**
- `services/whatsapp-campaigns.ts`: `createTemplate(accessToken, wabaId, spec)` e `getTemplateStatus(...)`.
- `POST /modules/campanhas/templates` — body: `name`, `language`, `category` (`MARKETING|UTILITY|AUTHENTICATION`), `components`.
- `DELETE /modules/campanhas/templates/:name`.
- Model `TemplateDraft` — rascunho local + `metaStatus` (`PENDING|APPROVED|REJECTED`) + `rejectedReason`. Poll de status no scheduler do worker (a cada 30min, só os `PENDING`).
- UI em `/app/campanhas/templates`: builder com preview estilo WhatsApp, contador de variáveis, validação de categoria.
- Emitir `template.approved` / `template.rejected` pelo emissor da Fase 2.

**Entregar (item 8):**
- Header de mídia (`IMAGE|VIDEO|DOCUMENT`) no builder e no envio — `templateComponents` já é `Json`, aceita `{ type: 'header', parameters: [{ type: 'image', image: { link } }] }`.
- Upload do asset: reusar o multipart já configurado (teto 15MB) + validação de `media-validation.ts`.
- Preencher o header no envio em `apps/worker/src/modules/campanhas.ts` (variante A e B).

**Pronto quando:** template criado no painel aparece `PENDING` e vira `APPROVED` sem ação manual; campanha com header de imagem entrega a imagem; template rejeitado mostra o motivo da Meta.

---

## Fase 5 — Item 7: métricas (§5 de `CAMPANHAS_ARQUITETURA.md`)

**Problema:** o próprio doc abre com *"Nenhuma dessas métricas existe hoje"*.

**Entregar:**
- `GET /analytics/campanhas` — por campanha: taxa de entrega (`(delivered+read)/sent`), taxa de falha, opt-out gerado, quebra por `errorCode` (Fase 0), métrica por variante A/B.
- `GET /analytics/numero/:id` — série de `quality_rating` e `messaging_limit_tier` no tempo + % do tier diário consumido.
- Model `NumberHealthSnapshot` — `numberId`, `qualityRating`, `messagingLimitTier`, `sentToday`, `capturedAt`. Snapshot de hora em hora no scheduler (reusa `getPhoneNumberLimits`).
- Admin: nº de campanhas auto-pausadas/dia e nº de números em `RED` (papel de Tech Provider Meta).
- Dashboard: gráfico de entrega por campanha + alerta quando `quality_rating` cai.

**Pronto quando:** queda de `GREEN → YELLOW` aparece no dashboard em < 1h e dispara `number.quality_degraded` pela Fase 2.

---

# Prompts otimizados

> Uma conversa por fase. Colar o prompt da fase; não misturar fases.

## Prompt — Fase 0

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 0) e CLAUDE.md antes de escrever código.

Implemente o item 6: códigos de erro normalizados.

Contexto que você NÃO precisa descobrir:
- Catálogo de dado puro segue o padrão de packages/modules/catalog.ts (zero import externo).
- Erros da Graph API passam por apps/api/src/services/whatsapp-campaigns.ts (formatError)
  e whatsapp-official.ts (_formatError).
- CampanhaContato.errorMessage hoje é string cortada em 500 chars.
- Migration: packages/database/prisma/migrations/20261002_error_codes/migration.sql,
  SQL à mão no padrão de 20260923_failed_job_dlq.
- Teste: jest em apps/api, mock de ../lib/prisma (ver __tests__/campanhas.test.ts).

Restrições:
- MANTER errorMessage (texto cru). errorCode é campo novo, não substituição.
- NÃO alterar o contrato de /public/v1/* além de ADICIONAR a chave `code`.
- Faixas: 1xxx auth, 2xxx validação, 3xxx canal, 4xxx quota/billing, 5xxx interno.

Pronto quando: campanhas.ts e publicApi.ts devolvem { error, code } em todo 4xx/5xx;
falha de envio grava errorCode; teste cobre template inexistente, rate limit da Meta e
número inválido.

Rode `npm test` em apps/api e mostre o resultado antes de commitar.
Commit na branch de trabalho. NÃO abra PR, NÃO deploye.
```

## Prompt — Fase 1

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 1) e CLAUDE.md. A Fase 0 (códigos de erro) já está
mergeada — use packages/modules/error-codes.ts.

Implemente os itens 3 e 2 NESTA ORDEM: idempotência primeiro, API de escrita depois.
Não comece a escrita antes da idempotência passar nos testes.

Contexto que você NÃO precisa descobrir:
- apps/api/src/routes/publicApi.ts é a API pública (prefix /public/v1), hoje SÓ LEITURA.
- Auth por X-Api-Key via lib/apiKeyAuth.ts; escopos vivem em ALLOWED_SCOPES.
- Envio já existe: services/send-with-retry.ts (sendTextWithRetry) e
  services/whatsapp-campaigns.ts (sendTemplateMessage). Débito de saldo: lib/campanha-credit.ts.
- Validação zod em lib/validation.ts via validateRequest(schema)(req.body).
- Migration: 20261002_idempotency_keys.

Restrições NÃO NEGOCIÁVEIS:
- ZERO caminho de envio novo. Reusar os helpers acima — se precisar mudar um, extraia,
  não duplique.
- Débito de saldo pelo MESMO helper do painel.
- Chave de API existente NÃO ganha escopo novo automaticamente.
- Idempotency-Key obrigatório em toda rota de escrita. Mesma chave + body diferente = 409.
- Rate limit de escrita: max 20/minuto (leitura segue 60).
- GETs existentes ganham ?cursor=&limit= sem quebrar o formato { data } atual.

Pronto quando: POST /messages com a mesma Idempotency-Key duas vezes envia UMA mensagem
e a 2ª resposta traz X-Idempotent-Replay: true; sem header = 400; escopo faltando = 403
com código; Swagger atualizado.

Rode `npm test` em apps/api e mostre o resultado antes de commitar.
Commit na branch de trabalho. NÃO abra PR, NÃO deploye.
```

## Prompt — Fase 2

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 2) e CLAUDE.md.

Implemente o item 2: substituir o webhook atual por um sistema de eventos de verdade.

Contexto que você NÃO precisa descobrir:
- O webhook atual é dispatchWebhook em apps/worker/src/index.ts:662 — fire-and-forget
  com .catch(() => null), timeout 5s, sem retry, sem log, 1 evento só.
- WebhookConfig tem userId @unique (1 URL por usuário) — precisa virar N endpoints.
- Config/guard anti-SSRF está em apps/api/src/routes/webhook-config.ts (isSafeWebhookUrl).
- Fila: BullMQ, padrão em apps/worker/src/lib/queue.ts. DLQ pronta em lib/dlq.ts.
- Migration: 20261002_webhook_events.

Restrições NÃO NEGOCIÁVEIS:
- MIGRAR os WebhookConfig existentes pra WebhookEndpoint com events:
  ['transcription.completed']. Quem já tem webhook não pode parar de receber.
- EXTRAIR isSafeWebhookUrl pra lib/safe-url.ts e usar nos dois lugares. Não copiar.
- Esgotar attempts manda pro DLQ existente, não cria mecanismo novo.
- Emissor ÚNICO em services/events.ts. Chamar dos pontos que já existem —
  não espalhar lógica de webhook pelo código.
- Máx. 5 endpoints por usuário. Retenção de WebhookDelivery: 7 dias.
- Liberar pra profissional + empresas (hoje é só executive).

Eventos: transcription.completed (manter), message.received, message.sent,
delivery.status, conversation.escalated, campaign.completed, campaign.paused,
contact.optout.

Pronto quando: endpoint devolvendo 500 é retentado 5x com backoff exponencial e fica
registrado com attempts: 5; URL interna é rejeitada; transcription.completed continua
chegando igual pra quem já tinha webhook configurado.

Rode `npm test` em apps/api e apps/worker. Commit na branch. NÃO abra PR, NÃO deploye.
```

## Prompt — Fase 3

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 3) e CLAUDE.md. Fases 0 e 2 já mergeadas.

Implemente o item 5: log de mensagens visível pro próprio usuário.

Contexto que você NÃO precisa descobrir:
- Hoje só existe o DLQ do admin em /sys/g5r8t2/failed-jobs — o cliente não vê nada.
- Dado está espalhado em 3 models: AtendeMessage, CampanhaContato, Transcription.
- Escopo de time: lib/teamScope.ts (agent < manager < admin < owner).
- Mascaramento de telefone: lib/mask.ts.
- Padrão de página Next.js com tema claro/escuro: ver as páginas de Campanhas.

Restrições:
- NÃO criar tabela nova de log. Normalizar em leitura sobre os 3 models existentes
  (duplicar escrita vira drift).
- role 'agent' vê telefone MASCARADO e só o que atende; manager+ vê tudo.
- Cursor obrigatório — sem endpoint que varre tabela inteira.
- errorCode vem da Fase 0.

Pronto quando: falha de campanha aparece no log com errorCode em < 5s; agent não vê
telefone inteiro; filtro por errorCode funciona; /app/logs renderiza nos dois temas.

Rode `npm test` em apps/api. Commit na branch. NÃO abra PR, NÃO deploye.
```

## Prompt — Fase 4

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 4) e CLAUDE.md. Fases 0 e 2 já mergeadas.

Implemente os itens 4 e 8: criação de template in-app + header de mídia.

ATENÇÃO: CAMPANHAS_ARQUITETURA.md §6.3 diz "template in-app: não construir agora".
Essa decisão foi REVERTIDA — está no escopo. Atualize o §6.3 do doc dizendo isso.

Contexto que você NÃO precisa descobrir:
- listTemplates já chama GET /{waba}/message_templates em
  apps/api/src/services/whatsapp-campaigns.ts. Criar é POST no mesmo endpoint.
- Campanha.templateComponents já é Json — aceita header de mídia sem migration.
- Envio do template: apps/worker/src/modules/campanhas.ts (trata variante A e B).
- Upload: multipart já configurado com teto de 15MB; validação em lib/media-validation.ts.
- Poll de status: usar o scheduler do worker (padrão em campanhas-scheduler.ts).
- Migration: 20261002_template_draft.

Restrições:
- Poll de status só nos PENDING, a cada 30min. Não varrer todos os templates.
- Header de mídia tem que funcionar na variante A E na B do A/B test.
- Emitir template.approved / template.rejected pelo emissor da Fase 2.
- Preview no builder tem que mostrar contagem de variáveis e travar categoria inválida.

Pronto quando: template criado no painel aparece PENDING e vira APPROVED sem ação
manual; campanha com header de imagem entrega a imagem; template rejeitado mostra o
motivo da Meta.

Rode `npm test` em apps/api e apps/worker. Commit na branch. NÃO abra PR, NÃO deploye.
```

## Prompt — Fase 5

```
Leia ESCOPO_PLATAFORMA_API.md (Fase 5), CAMPANHAS_ARQUITETURA.md §5 e CLAUDE.md.
Fases 0 e 2 já mergeadas.

Implemente o item 7: as métricas que o §5 lista como inexistentes.

Contexto que você NÃO precisa descobrir:
- getPhoneNumberLimits (services/whatsapp-campaigns.ts) já lê quality_rating e
  messaging_limit_tier da Graph API — hoje só em leitura pontual, nada é guardado.
- tierToNumericCap converte tier em teto numérico.
- CampanhaContato já tem sentAt/deliveredAt/readAt/failedAt — a taxa de entrega é
  derivável sem campo novo.
- Scheduler: apps/worker/src/campanhas-scheduler.ts.
- Migration: 20261002_number_health_snapshot.

Restrições:
- Snapshot de hora em hora, não a cada envio. Uma chamada por número conectado.
- Taxa de entrega é DERIVADA dos timestamps existentes — não criar contador novo
  (o doc §11.9 já alerta sobre drift de contador).
- Quebra por errorCode vem da Fase 0.
- Alerta de queda de quality dispara number.quality_degraded pela Fase 2.

Pronto quando: queda GREEN → YELLOW aparece no dashboard em < 1h e dispara o evento;
taxa de entrega por campanha e por variante A/B confere com o banco; admin vê nº de
campanhas auto-pausadas/dia e números em RED.

Ao terminar, marque no §5 de CAMPANHAS_ARQUITETURA.md o que passou a existir.

Rode `npm test` em apps/api e apps/worker. Commit na branch. NÃO abra PR, NÃO deploye.
```

---

## Riscos a vigiar

| Risco | Fase | Mitigação |
|---|---|---|
| API de escrita vira vetor de spam | 1 | Opt-out e tier checados no mesmo helper do painel; rate limit 20/min; escopo separado |
| Migração de `WebhookConfig` perde webhook de cliente | 2 | Migration copia antes de dropar; teste cobre o caso |
| Fila de webhook afoga a de transcrição | 2 | Fila `webhooks` separada, concorrência própria |
| Template criado por API fere política da Meta e derruba o WABA | 4 | Categoria obrigatória + validação antes do POST; `quality_rating` monitorado na Fase 5 |
| Snapshot horário estoura rate limit da Graph API | 5 | 1 chamada/número/hora, com backoff |

## Fora de escopo (decisão consciente)

SDKs oficiais (prematuro antes da Fase 1 em produção) · multicanal · sandbox/subcontas · SMS/Voz/Vídeo · Studio/flow builder. Ver `ZAPSCRIPT_VS_TWILIO.md` §"Não copiar".
