# Plataforma ZapScript — API pública, eventos, log e templates

> Fecha os itens 1 a 8 do escopo `ZAPSCRIPT_VS_TWILIO.md` (gaps P0/P1 de
> plataforma). Data: 2026-10-02.

Antes desta leva, o ZapScript tinha um produto bom e uma **plataforma ausente**:
a API pública era só leitura de conversas e contatos, o webhook era uma URL por
conta sem histórico nem reentrega, "esta mensagem saiu?" não tinha resposta
única, e todo erro chegava como uma frase em português impossível de programar
contra. Esta é a referência do que passou a existir.

---

## Índice dos 8 itens

| Item | O que é | Onde vive |
|------|---------|-----------|
| 1 | **API de escrita** — `POST /public/v1/messages` | `routes/public/messages.ts`, `services/outbound-send.ts`, fila `messages-out` |
| 2 | **Sistema de eventos** — webhooks por tipo, com retry e histórico | `services/events.ts`, `routes/webhook-endpoints.ts`, fila `webhooks` |
| 3 | **Idempotência** — `Idempotency-Key` nas escritas | `lib/idempotency.ts`, tabela `IdempotencyRecord` |
| 4 | **Templates in-app** — criar/listar/apagar sem sair do app | `services/meta-templates.ts`, `routes/templates.ts` |
| 5 | **Log de mensagens** — tabela única de tudo que entra e sai | `services/message-log.ts`, tabela `MessageLog` |
| 6 | **Códigos de erro** — catálogo estável e programável | `lib/apiErrors.ts` (+ cópia idêntica no worker) |
| 7 | **Métricas** — entrega, falha por motivo, saúde de webhook | `services/metrics.ts`, `GET /public/v1/metrics` |
| 8 | **Header de mídia** — template com imagem/vídeo/PDF no cabeçalho | `services/template-components.ts` |

No painel, tudo isso aparece em **/dashboard/plataforma** (abas Mensagens,
Webhooks e Templates). As chaves de API ficam em **Equipe → API pública**.

---

## 1. Autenticação e escopos

A API pública usa `X-Api-Key` (não o JWT da sessão). Chaves são criadas pelo
dono do tier Empresas em `/api-keys`, e cada chave carrega escopos:

| Escopo | Permite |
|--------|---------|
| `conversations:read` | listar conversas do Atende |
| `contacts:read` | listar contatos do CRM |
| `messages:read` | ler o log de mensagens |
| `messages:write` | **enviar** mensagem |
| `templates:read` | listar templates do WABA |
| `templates:write` | reservado para criação por API (hoje a criação é no painel) |
| `events:read` | ler o histórico de eventos |
| `webhooks:read` / `webhooks:write` | reservado para gestão de endpoints por API |
| `metrics:read` | ler métricas agregadas |

Leitura e escrita são escopos separados de propósito: uma automação que só lê
conversas nunca deve poder disparar mensagem no WhatsApp dos contatos do cliente.

`GET /public/v1/me` devolve os escopos da chave e os números da conta — é a
chamada de "teste de conexão" e também de onde sai o `numberId`.

---

## 2. Envelope de erro (item 6)

Todo erro de `/public/v1/*` e das rotas novas do painel sai assim:

```json
{
  "error": {
    "code": "message.outside_window",
    "message": "Fora da janela de 24h: use uma mensagem de template aprovado.",
    "docUrl": "https://zapscript.me/docs/erros/message.outside_window",
    "retryable": false,
    "requestId": "req-42",
    "details": { "...": "opcional" }
  }
}
```

- **`code` é contrato.** Nunca é renomeado nem muda de status HTTP. Um teste
  (`__tests__/apiErrors.test.ts`) trava os códigos já publicados.
- **`message` não é contrato** — pode mudar com qualquer revisão de texto.
- **`retryable`** diz se repetir a MESMA requisição pode funcionar
  (indisponibilidade, throttle, timeout). O worker usa o mesmo campo para
  decidir entre retentar o job e marcar falha definitiva.
- **`requestId`** é o que o suporte usa para achar a linha no log do servidor.

Código desconhecido deve ser tratado pelo prefixo de domínio (`message.`,
`template.`, `number.`…) ou pelo status HTTP — códigos novos podem aparecer a
qualquer momento.

### Erro de provedor virou erro nosso

O ponto central do item 6 é que erro da Meta **não vaza cru**. A tabela em
`lib/apiErrors.ts` traduz o código numérico para o nosso:

| Meta | ZapScript | Significado prático |
|------|-----------|---------------------|
| 131047 | `message.outside_window` | passou das 24h — precisa de template |
| 131026 | `message.undeliverable` | número sem WhatsApp, ou bloqueou |
| 132001 | `template.not_found` | template não existe nesse WABA |
| 132000 / 132012 | `template.param_mismatch` | variáveis não casam com o aprovado |
| 132015 / 132016 | `template.not_approved` | pausado ou desabilitado |
| 133010 | `number.not_registered` | remetente não registrado |
| 131031 / 368 | `account.restricted` | conta restrita pela Meta |
| 131042 | `account.balance_insufficient` | pagamento/elegibilidade |
| 130429 / 80007 | `message.throttled` | limite de mensageria |
| 190 / 0 | `number.missing_credentials` | token expirado — reconectar |

Erro da Evolution (texto livre) é casado por padrão; erro de rede vira
`provider.timeout` / `provider.unavailable`. Código novo da Meta nunca quebra
nada: cai em `provider.rejected`.

---

## 3. Enviar mensagem (itens 1, 3 e 8)

```http
POST /public/v1/messages
X-Api-Key: zsk_live_...
Idempotency-Key: pedido-8814-confirmacao
Content-Type: application/json

{
  "to": "5511999999999",
  "numberId": "ckx...",          // opcional com 1 número; obrigatório com 2+
  "type": "text",                 // text | template | image | audio | video | document
  "text": "Seu pedido saiu para entrega!"
}
```

Resposta — **202 Accepted**, não 200:

```json
{ "data": { "id": "ckz...", "status": "queued", "to": "5511999999999", ... } }
```

### Por que assíncrono

A requisição **aceita e enfileira**; quem fala com o provedor é o worker (fila
`messages-out`). É o mesmo contrato do Twilio, e por três razões concretas:

1. o retry fica com o BullMQ (e o job esgotado cai no DLQ, como o resto do
   sistema) em vez de exigir que o cliente retente e arrisque duplicar;
2. a resposta HTTP não fica presa ao tempo da Graph API;
3. o ciclo de vida (`queued → sent → delivered → read`) vira evento de webhook.

Acompanhe por `GET /public/v1/messages/{id}` ou pelos eventos `message.*`.

### Template com header de mídia (item 8)

```json
{
  "to": "5511999999999",
  "type": "template",
  "template": {
    "name": "boleto_mensal",
    "language": "pt_BR",
    "variables": ["João", "R$ 149,90"],
    "header": {
      "type": "document",
      "link": "https://seucdn.com/boletos/8814.pdf",
      "filename": "Boleto outubro.pdf"
    }
  }
}
```

A mídia do header vai em **cada envio** — a Meta só guarda o exemplo usado na
aprovação. Antes do enfileiramento, validamos contra o template aprovado:

- template inexistente → `template.not_found`
- não aprovado → `template.not_approved`
- nº de variáveis diferente → `template.param_mismatch` (com `expected`/`received`)
- header de mídia faltando → `template.header_media_required`
- tipo de header errado → `template.header_media_unsupported`
- URL não-HTTPS ou extensão incompatível → `message.media_url_invalid`

Tudo isso **antes** de gastar uma chamada ao provedor. Era exatamente o que
antes chegava como `132012` opaco, no meio de um disparo, mensagem por mensagem.

### Idempotência (item 3)

`Idempotency-Key` é opcional, mas é o que torna o retry seguro:

- **com a chave**: a 1ª chamada executa e grava a resposta; repetições devolvem
  a resposta gravada, com `X-Idempotent-Replay: true`. Nada é reexecutado.
- **mesma chave, corpo diferente** → `422 idempotency.request_mismatch`.
- **chave em execução** → `409 idempotency.in_progress` (retryable).
- **sem a chave**: derivamos uma do próprio corpo, válida por uma janela curta
  (`IDEMPOTENCY_AUTO_WINDOW_SECONDS`, padrão **10s**). Isso absorve o retry
  automático de rede — que acontece em segundos — sem engolir um reenvio
  deliberado do usuário minutos depois. `0` desliga.

O registro vale 24h (`IDEMPOTENCY_TTL_HOURS`). Falha transitória (5xx, timeout)
**libera** a chave, senão o cliente ficaria impedido de reenviar o que nunca saiu.

---

## 4. Log de mensagens (item 5)

```http
GET /public/v1/messages?status=failed&direction=outbound&since=2026-10-01T00:00:00Z&limit=25
```

```json
{
  "data": [{
    "id": "ckz...", "direction": "outbound", "channel": "meta", "source": "campanha",
    "status": "failed", "to": "5511999999999", "type": "template",
    "templateName": "promo_verao", "providerMessageId": "wamid...",
    "error": { "code": "message.outside_window", "message": "Re-engagement message" },
    "queuedAt": "...", "sentAt": "...", "deliveredAt": null, "readAt": null, "failedAt": "..."
  }],
  "hasMore": true,
  "nextCursor": "ckz..."
}
```

Filtros: `status`, `direction`, `numberId`, `source`, `to`, `since`, `until`,
`limit` (máx. 100), `startingAfter` (cursor). Paginação é por **keyset**, não
`offset`: a página 200 de um cliente grande continua rápida.

`source` diz de onde a mensagem veio: `api`, `campanha`, `atende`, `aviso`,
`cobranca`, `copiloto`, `zapscreve`, `transcricao`, `suporte`, `sistema`. É o
que faz a pergunta "esta mensagem saiu?" ter **uma** resposta, em vez de
depender de saber por onde ela saiu.

Status é o **estado atual**, não acumulado: uma mensagem lida conta só em
`read`. Webhooks de status da Meta chegam fora de ordem, e o log nunca regride —
um `delivered` atrasado não apaga um `read`.

Retenção: `MESSAGE_LOG_RETENTION_DAYS` (padrão 90; `0` guarda para sempre).

---

## 5. Eventos e webhooks (item 2)

### Tipos

`message.queued`, `message.sent`, `message.delivered`, `message.read`,
`message.failed`, `message.received`, `transcription.completed`,
`transcription.failed`, `campaign.started`, `campaign.completed`,
`conversation.escalated`, `contact.opted_out`.

Um endpoint assina `["*"]` (tudo, inclusive tipos futuros), tipos exatos, ou
prefixo (`"message.*"`).

### Payload e headers

```json
{
  "id": "evt_...",
  "type": "message.delivered",
  "createdAt": "2026-10-02T12:00:00.000Z",
  "data": { "message": { "...igual ao GET /messages/{id}..." } }
}
```

| Header | Serve para |
|--------|-----------|
| `X-ZapScript-Event` | tipo do evento |
| `X-ZapScript-Event-Id` | **deduplicar** do seu lado |
| `X-ZapScript-Delivery-Id` | correlacionar com o histórico de entregas |
| `X-ZapScript-Attempt` | nº da tentativa (1-based) |
| `X-ZapScript-Signature` | `t=<unix>,v1=<hmac_sha256("<t>.<body>")>` |

Validação (Node):

```js
const [tPart, vPart] = req.header('X-ZapScript-Signature').split(',');
const t = tPart.slice(2);
const esperado = crypto.createHmac('sha256', SEGREDO).update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(vPart.slice(3)), Buffer.from(esperado));
// recuse se Math.abs(Date.now()/1000 - Number(t)) > 300  → proteção contra replay
```

O timestamp entra **dentro** do HMAC de propósito: sem ele, quem capturou uma
entrega válida poderia reenviá-la ao seu endpoint para sempre, com assinatura boa.

### Entrega, retry e circuit breaker

- 6 tentativas com espera exponencial (30s → ~8min).
- Cada tentativa fica registrada: status HTTP, início do corpo da resposta,
  código de erro e quando é a próxima tentativa.
- `410 Gone` desativa o endpoint na hora (é um "não me mande mais" explícito).
- `WEBHOOK_DISABLE_AFTER` falhas consecutivas (padrão 15 — mais de uma hora de
  indisponibilidade) desativam o endpoint; reativar no painel limpa o contador.
- A URL é **revalidada antes de cada entrega** (anti-SSRF): um host que passou a
  apontar para a rede interna é bloqueado e o endpoint, desativado.

### Compatibilidade com o webhook antigo

Quem já tinha `WebhookConfig` configurado **não para de receber**. Na primeira
emissão, ele é migrado para um `WebhookEndpoint` com `signatureScheme: 'legacy'`:
mesma URL, mesmo segredo e o mesmo formato de assinatura
(`sha256=<hmac(body)>`) que a integração em produção já valida. Alterações em
`/webhook-config` continuam espelhadas nesse endpoint.

### Eventos só existem com ouvinte

Se a conta **não tem nenhum endpoint ativo**, o evento não é gravado. Motivo:
uma campanha de 10 mil contatos geraria 10 mil linhas que ninguém leria — e o
que aconteceu já está no `MessageLog`, que é a fonte de verdade da mensagem.
Configurar o primeiro endpoint passa a gravar (cache de 60s).

Histórico: `GET /public/v1/events` (filtros `type`, `resourceId`, `since`,
`until`, cursor). É o que permite varrer o que se perdeu depois de uma queda do
seu endpoint, em vez de descobrir o buraco por acidente.

Retenção: `EVENT_RETENTION_DAYS` (padrão 30; `0` guarda para sempre).

---

## 6. Templates (itens 4 e 8)

No painel (`/dashboard/plataforma` → Templates):

| Rota | O que faz |
|------|-----------|
| `GET /templates` | lista **todos** — inclusive `PENDING` e `REJECTED` com o motivo |
| `POST /templates` | cria (nasce `PENDING` na Meta) |
| `POST /templates/media-handle` | sobe a mídia de **exemplo** do header (item 8) |
| `DELETE /templates/:name` | apaga |
| `POST /templates/refresh` | ignora o cache de 60s e relê da Meta |

Criar/apagar exige papel **admin**: template reprovado afeta a qualidade do
número da conta inteira.

Pela API pública, `GET /public/v1/templates` devolve o que falta para montar um
`POST /messages` correto na primeira tentativa:

```json
{ "data": [{
  "name": "boleto_mensal", "language": "pt_BR", "status": "APPROVED",
  "headerFormat": "DOCUMENT", "requiresHeaderMedia": true,
  "bodyVariableCount": 2, "bodyText": "Olá {{1}}, seu boleto de {{2}}...",
  "rejectedReason": null
}]}
```

Para criar template com header de mídia, a Meta **não aceita URL**: exige um
`header_handle` obtido pela Resumable Upload API. `POST /templates/media-handle`
faz isso. Requer `META_APP_ID` e `META_APP_SECRET` no servidor — sem eles, a
resposta é `501 template.media_upload_unavailable` (falta de configuração do
servidor, não erro do cliente).

---

## 7. Métricas (item 7)

```http
GET /public/v1/metrics?since=2026-09-25T00:00:00Z&granularity=day
```

Devolve, para o período:

- **messages**: total, `byStatus` / `byDirection` / `byChannel` / `bySource`,
  `deliveryRate`, `failureRate`, `readRate`, série temporal e
  `topErrorCodes` (por **código do catálogo**, não por frase do provedor);
- **webhooks**: endpoints ativos/desativados e taxa de entrega;
- **events**: total por tipo.

Taxas são `null`, não `0`, quando não há base para calcular — "não houve
mensagem" é diferente de "nada foi entregue". A base de entrega são as mensagens
que chegaram ao provedor (`sent + delivered + read + failed`); `queued` fica
fora porque ainda vai sair. Entregas `pending` ficam fora da taxa de webhook
pelo mesmo motivo.

Limites: janela máxima de 92 dias (8 dias com `granularity=hour`). Tudo é
agregado no Postgres (`groupBy` / `date_trunc`) — nunca carregando linhas para
somar em memória.

### Operação

`GET /internal/metrics` (header `X-Internal-Token`) expõe no formato do
Prometheus, **sem rótulo por usuário** (cardinalidade por tenant explodiria o
Prometheus, e seria dado de cliente num sistema de observabilidade):

```
zapscript_messages_24h{status="delivered"} 1423
zapscript_messages_by_channel_24h{channel="meta"} 1680
zapscript_message_errors_24h{code="message.outside_window"} 12
zapscript_webhook_deliveries_24h{status="failed"} 3
zapscript_messages_stuck_queued 0
```

`zapscript_messages_stuck_queued` é o sinal mais acionável do conjunto:
mensagem aceita que não saiu em 10 minutos significa fila parada ou worker fora
do ar. **Alerte nisso.**

---

## 8. Variáveis de ambiente

| Variável | Padrão | O que controla |
|----------|--------|----------------|
| `IDEMPOTENCY_TTL_HOURS` | 24 | validade do registro de idempotência |
| `IDEMPOTENCY_AUTO_WINDOW_SECONDS` | 10 | janela da chave derivada (0 = desliga) |
| `MESSAGE_LOG_RETENTION_DAYS` | 90 | retenção do log (0 = guarda sempre) |
| `EVENT_RETENTION_DAYS` | 30 | retenção de eventos e entregas |
| `MESSAGES_OUT_CONCURRENCY` | 4 | concorrência da fila de saída |
| `MESSAGES_OUT_STUCK_MINUTES` | 5 | idade para o sweep reenfileirar presas |
| `WEBHOOKS_CONCURRENCY` | 5 | concorrência da entrega de webhooks |
| `WEBHOOK_TIMEOUT_MS` | 10000 | espera pelo endpoint do cliente |
| `WEBHOOK_DISABLE_AFTER` | 15 | falhas consecutivas que desativam o endpoint |
| `META_TEMPLATES_CACHE_SECONDS` | 60 | cache da listagem de templates |
| `META_APP_ID` / `META_APP_SECRET` | — | upload do exemplo de header de mídia |
| `DOCS_ERRORS_BASE_URL` | zapscript.me/docs/erros | base do `docUrl` |

Como o resto, essas variáveis vivem no `.env` do servidor Vultr (ver `CLAUDE.md`).

---

## 9. Migrações e deploy

Três migrações novas, aplicadas por `prisma migrate deploy` (roda no runner do
GitHub Actions, antes de tocar no servidor — ver `ops.yml`):

- `20261002_platform_api_write` — `IdempotencyRecord`, `MessageLog`
- `20261002_platform_events` — `PlatformEvent`, `WebhookEndpoint`, `WebhookDelivery`
- `20261002_campanha_header_media` — `Campanha.headerMedia*`

Duas filas novas no worker: `messages-out` e `webhooks`. Elas sobem com o worker
(`apps/worker/src/index.ts`), entram no `ALL_WORKERS` do graceful shutdown e
usam o DLQ existente.

Deploy: push em `master` já publica o Web (Vercel). API e Worker ainda exigem o
passo manual — workflow **"Ops — Vultr / Migração"** com `action=deploy`.

---

## 10. Nota de compatibilidade

Uma mudança é visível para quem já usa a API pública: os **erros** de
`/public/v1/*` passaram de `{ "error": "frase" }` para o envelope com `code`.
Era o objetivo do item 6 — sem isso nenhum cliente consegue tratar erro de forma
programática. O corpo de **sucesso** das rotas que já existiam
(`/me`, `/conversations`, `/contacts`) não mudou de forma incompatível: `/me`
ganhou o objeto `data` ao lado do `ok: true` que já devolvia.
