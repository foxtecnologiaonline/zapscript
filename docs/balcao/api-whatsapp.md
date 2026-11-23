# Balcão Virtual — API do canal WhatsApp (broker Meta Cloud API)

Frente `whatsapp` — código em `apps/api/src/balcao/channels/whatsapp`, prefixo HTTP `/balcao/whatsapp`.
Atende o TR 1.1.3.1.2.2 (broker nativo para a API Oficial do WhatsApp Business) e alimenta os itens de cobrança
**7 (`WA_SERVICE`)**, **8 (`WA_UTILITY`)** e **9 (`WA_MARKETING`)** do painel do fiscal.
Erros seguem `{ error: { code, message, details? } }`.

## 1. Como configurar no painel da Meta

1. Crie/abra o app em *developers.facebook.com* com o produto **WhatsApp** e anote: **Phone number ID**, **WhatsApp Business Account ID (WABA)**, **App Secret** (Configurações do app → Básico) e um **token de acesso permanente** (usuário do sistema do Business Manager, permissões `whatsapp_business_messaging` e `whatsapp_business_management`).
2. No Balcão, `PUT /balcao/whatsapp/config` com `accessToken`, `phoneNumberId`, `wabaId`, `appSecret` (o `verifyToken` é gerado se omitido). A resposta traz `webhook.url` e `webhook.verifyToken`.
3. No painel Meta → WhatsApp → Configuração → **Webhook**: URL de callback = `webhook.url` (`https://api.zapscript.me/balcao/whatsapp/webhook`), Verify token = `webhook.verifyToken`. Assine os campos **`messages`**, **`message_template_status_update`** e **`template_category_update`**.
4. `POST /balcao/whatsapp/config/test` confirma token/número/WABA (grava `status` OK/ERROR).
5. Crie templates (`POST /templates` → `/templates/:id/submit`) ou importe os existentes (`POST /templates/sync`).

O webhook da Meta é **único por app**: o órgão é resolvido pelo `phone_number_id` do payload (mensagens/status) ou pelo `entry.id` = WABA (templates). Um mesmo número/WABA só pode pertencer a um órgão (409 `whatsapp.number_in_use`). No `GET` de verificação, o `hub.verify_token` é comparado (tempo constante) com o de todas as integrações.

## 2. Endpoints

Perm. = permissão do núcleo (`core/permissions.ts`).

| Método e rota | Perm. | Descrição |
|---|---|---|
| `GET /webhook` | pública | Verificação da Meta (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`) → 200 `text/plain` com o challenge; senão 403 |
| `POST /webhook` | pública + HMAC | Eventos da Meta. Valida `x-hub-signature-256` (HMAC-SHA256 do **corpo bruto** com o `appSecret` do órgão dono do número). Número/WABA desconhecido → 200 `{ignored:true}`; assinatura inválida → 401; falha de persistência → 500 (a Meta reenvia; idempotente por wamid) |
| `GET /config` | `integration:manage` | Config com segredos mascarados (`accessToken`, `appSecret` = `••••••`), `status`, `lastCheckAt`, `lastError`, `webhook {url, verifyToken, fields}` |
| `PUT /config` | `integration:manage` | Cria/atualiza (parcial; segredo omitido ou `••••••` = mantém). Campos: `accessToken, phoneNumberId, wabaId, appSecret, verifyToken?, graphVersion? (padrão v23.0), enabled?, mock?, apiBase?` (`mock`/`apiBase` só em dev/teste). Audita e versiona (`recordConfigVersion`) |
| `POST /config/test` | `integration:manage` | Chama a Graph (`GET /{phoneNumberId}` e `GET /{wabaId}`) → `{ok, phone:{displayPhoneNumber, verifiedName, qualityRating}, waba}` ou `{ok:false, error:{code,message}}` |
| `GET /health` | `integration:manage` | `configured, enabled, status, mock, windowHours, lastInboundAt, lastOutboundAt, failedOutbound24h, templates:{STATUS:n}` |
| `GET /templates?status=&category=` · `GET /templates/:id` | `conversation:reply` | Lista/consulta templates do órgão |
| `POST /templates` | `integration:manage` | `{name (a-z0-9_), language (pt_BR), category (UTILITY\|MARKETING\|AUTHENTICATION), components[]}` → cria `DRAFT` (valida componentes/variáveis localmente) |
| `PUT /templates/:id` | `integration:manage` | Edita `category`/`components` (só `DRAFT`/`REJECTED`) |
| `DELETE /templates/:id` | `integration:manage` | Remove (na Meta também, se não for rascunho; `?force=1` remove só local) |
| `POST /templates/:id/submit` | `integration:manage` | Cria na Meta (`POST /{waba}/message_templates`) → `PENDING`/`APPROVED`, guarda `metaTemplateId` |
| `POST /templates/sync` | `integration:manage` | Lê `GET /{waba}/message_templates` (paginado): atualiza status/categoria/`rejectedReason` e **importa** os que só existem na Meta → `{created, updated, unchanged, total}` |
| `POST /send-template` | `conversation:reply` | Dispara template: `{contactId \| phone \| conversationId, templateName, language?, params?, components?}`. Reaproveita conversa WhatsApp aberta do número; senão `openConversation` (`ACTIVE` atribuída ao usuário; com token de API → `WAITING`). Pré-valida aprovação/parâmetros/cota **antes** de abrir conversa. 201 `{conversationId, protocol, message, usageItem}` |
| `POST /dev/simulate-inbound` | `integration:manage` + `BV_DEV_SIMULATORS=1` | `{from, name?, text, orgId?}` injeta mensagem pelo mesmo pipeline do webhook (sem HMAC). `orgId`, se enviado, deve ser o do usuário |
| `POST /dev/simulate-status` | idem | `{wamid, status: sent\|delivered\|read\|failed, errorCode?}` |

### `params` de template
- `string[]` → variáveis do BODY (`{{1}}…`). Objeto: `{ header?: string[] | {type:'image'|'video'|'document', link|id, filename?}, body?: string[], buttons?: [{index, type:'url'|'quick_reply', param}] }`.
- Alternativa: `components` já no formato da Graph (usado como está).
- Quebras de linha/tabs/4+ espaços são normalizados (a Meta recusa com 132018). Contagem divergente → `whatsapp.template_params_mismatch`.
- O corpo gravado na conversa é o texto do template **já preenchido** (cabeçalho texto + corpo + rodapé).

## 3. Regras de entrada (webhook → `ingestInbound`)

- Tipos: texto, imagem, áudio, vídeo, documento, sticker (→ `IMAGE`), localização (texto + `channelMeta.wa.location`), `interactive` (botão/lista → texto = título; `channelMeta.wa.interactive {id,title}`), `button` (resposta rápida de template), contatos. **Reações e mensagens de sistema são ignoradas.**
- `ingestInbound({channel:'WHATSAPP', channelRef: wa_id, externalId: wa_id, name: profile.name, message:{kind, body, channelMessageId: wamid, channelMeta:{wa:{…}}}})`. Idempotente por wamid. Processamento por contato é serializado (webhooks concorrentes do mesmo cidadão novo) e repete em `P2002`.
- **Mídia**: a mensagem é ingerida imediatamente (resposta 200 rápida) e o arquivo é baixado **em segundo plano** (Graph: `GET /{mediaId}` → url → bytes; só segue hosts da Meta — anti-SSRF; confere `sha256`; limite 100 MB), gravado com `putObject` (`<orgId>/attachments/…`) e registrado em `BvMessage.attachments` (`{key,name,mime,size,sha256}`); socket `message:attachments`. Estado em `channelMeta.wa.mediaStatus` (`PENDING`→`STORED`/`FAILED`, `mediaAttempts`, `mediaError`). Falha transitória fica `PENDING` e o job `whatsapp.media_retry` (60 s, até 5 tentativas) reprocessa.
- **`WA_SERVICE` (item 7)**: 1 por **abertura de janela** (bloco fixo de `settings.whatsapp.windowHours`, padrão 24 h, a partir da 1ª mensagem do cidadão), marcador atômico em `conversation.metadata.whatsapp.windowOpenedAt`. Não conta por mensagem, nem em reentrega (dedupe), nem se o mesmo contato já abriu janela em outra conversa dentro do período.
- Status (`statuses[]`) → `BvMessage.status` (`SENT→DELIVERED→READ`, nunca rebaixa) e `errorCode`; `pricing.category` fica em `channelMeta.wa.billedCategory`. Status que chega antes de o wamid ser gravado é reaplicado em segundo plano (3 tentativas). Socket `message:status {conversationId, messageId, status, errorCode}`.
- `message_template_status_update` / `template_category_update` atualizam `BvWaTemplate` (status, `rejectedReason`, categoria).

## 4. Regras de saída (`registerChannelSender('WHATSAPP')`)

- **Texto livre, mídia e interativos só dentro da janela** (`conversation.lastInboundAt` + `settings.whatsapp.windowHours`). Fora dela: `ChannelSendError('whatsapp.outside_window')` sem chamar a Graph (use template).
- Texto > 4096 é dividido (o 1º wamid fica na mensagem). Botões (`channelMeta.interactive = {type:'button', buttons:[{id,title}]}` até 3) e listas (`{type:'list', buttonText, sections:[{title, rows:[{id,title,description?}]}]}`).
- Mídia: o anexo é lido do storage (chave **deve** começar com o `orgId`), enviada à Graph (`POST /{phoneId}/media`, multipart) e depois enviada por id; imagem JPEG/PNG ≤ 5 MB, áudio AAC/MP4/MPEG/AMR/OGG e vídeo MP4/3GP ≤ 16 MB, documento ≤ 100 MB. Legenda = `body` (áudio: texto separado).
- **Template** (`kind:'TEMPLATE'`, `channelMeta {templateName, language, params|components}`): exige `BvWaTemplate` **APPROVED** local; consome `assertQuota` do item da categoria (`MARKETING`→`WA_MARKETING`; `UTILITY` e `AUTHENTICATION`→`WA_UTILITY`); `QuotaExceededError` → `whatsapp.quota_exceeded`. O consumo (`recordUsage`) só é registrado após o envio bem-sucedido. Funciona fora da janela.
- Retry com backoff exponencial (+ jitter, respeita `Retry-After`) para 5xx, 429, códigos de limite de taxa e falha de rede; 3 tentativas por padrão (`configureWaRuntime`). POST de envio **não** repete em timeout (evita duplicar).
- **Modo mock** (`config.mock=true`, só com `BV_DEV_SIMULATORS=1`): não chama a Graph, devolve `wamid.mock.*` e marca `SENT`; templates aprovam no `submit` e contam consumo — serve para demonstrar a PoC sem conta Meta.

## 5. Mapeamento de erros (`BvMessage.errorCode`)

| errorCode | Origem (Graph) |
|---|---|
| `whatsapp.outside_window` | local (janela) ou 131047 |
| `whatsapp.invalid_recipient` | 131026, 131030, 131021 |
| `whatsapp.rate_limited` | 130429, 131056, 131048, 80007, 4, 17, 32, 613, HTTP 429 |
| `whatsapp.template_not_approved` | local, ou 132001/132015/132016 |
| `whatsapp.template_params_mismatch` | local, ou 132000/132005/132007/132012/132018 |
| `whatsapp.quota_exceeded` | local (cota BLOCK do item) |
| `whatsapp.auth_failed` | 190, 10, 102, 131005, 200–299, HTTP 401/403 |
| `whatsapp.payment_issue` / `account_restricted` / `not_delivered_policy` | 131042 / 131031, 368 / 131049 |
| `whatsapp.unsupported_message_type`, `media_error`, `invalid_parameter` | 131051 / 131052-3 / 131008-9 |
| `whatsapp.unavailable`, `network_error` | HTTP 5xx / falha de rede (após retries) |
| `whatsapp.not_configured`, `disabled` | integração ausente / desabilitada |
| `whatsapp.invalid_attachment`, `unsupported_media`, `media_too_large` | validações locais de mídia |
| `whatsapp.send_failed` | demais |

## 6. Variáveis de ambiente

| Variável | Uso |
|---|---|
| `BV_DEV_SIMULATORS=1` | Habilita `/dev/*`, `config.mock` e `config.apiBase`. **Nunca em produção.** |
| `BV_PUBLIC_API_URL` | Base pública exibida em `webhook.url` (padrão `https://api.zapscript.me`) |
| `BV_STORAGE_DIR` | (núcleo) destino das mídias recebidas |

Credenciais ficam só em `BvIntegration.configEnc` (cifradas). Sem novas dependências. Job registrado: `whatsapp.media_retry`. Eventos de socket: `message:status`, `message:attachments`.

## 7. Testes

`pnpm exec jest --runInBand src/balcao/channels/whatsapp` — 43 casos contra um servidor HTTP local que imita a Graph (`__tests__/fake-graph.ts`): HMAC válido/inválido/adulterado, verificação GET, texto + mídia, dedupe, status e ordem, janela 24 h (e `windowHours`), template + cota BLOCK/ALERT, contagem WA_SERVICE/UTILITY/MARKETING, retries, erros mapeados, templates (CRUD/submit/sync/webhook), mock/simulador, isolamento entre órgãos e permissões. O teste monta um app Fastify só com este plugin (independe das demais frentes).

## 8. Não verificado (depende da Graph/Meta reais)

- Nenhuma chamada foi feita à Graph real: formatos de payload e códigos de erro seguem a documentação pública da Cloud API (v23.0) e o servidor simulado; precisam de homologação com número/WABA reais.
- Contagem de cobrança: `WA_SERVICE` por janela e `WA_UTILITY/MARKETING` **por template enviado** são a aproximação do Balcão; a fatura da Meta (modelo de preço por mensagem/categoria, reclassificação de categoria pela Meta — ver `channelMeta.wa.billedCategory`) pode divergir. `AUTHENTICATION` está sendo somado a `WA_UTILITY`.
- Template falhado depois de aceito pela Graph (status `failed` assíncrono) **não estorna** o consumo já registrado.
- `wa_id` de números brasileiros pode vir sem o 9º dígito; `send-template` por `phone` usa o número normalizado informado — a Meta pode devolver outro `wa_id` na resposta (não reconciliado).
- Formato exato de `example`/handles de mídia em templates com cabeçalho de mídia (upload resumível da Meta) não é automatizado: o `header_handle` deve ser informado pelo usuário.
- Aprovação/qualidade/limites de mensagens do número, tier de envio, opt-in/opt-out e política comercial da Meta: contratação/operacional do órgão.
- Corridas entre instâncias: janela `WA_SERVICE` é atômica no banco; cota (`assertQuota` + `recordUsage`) não é atômica (pequena folga possível sob concorrência alta).
- Mídias referenciadas por `id` expiram na Meta (30 dias); mídia pendente por mais de 7 dias não é reprocessada.
