# ZapScript — API pública v1

API de mensageria de WhatsApp para integração servidor-a-servidor, no mesmo
espírito da API da Twilio: um recurso `messages` com id durável e status
consultável, webhooks assinados para eventos de entrada, e escopos por chave.

- **Base URL**: `https://api.zapscript.me`
- **Prefixo**: `/public/v1`
- **Autenticação**: header `X-Api-Key` (não é o JWT do dashboard)

---

## 1. Autenticação

Crie a chave no dashboard (`/dashboard` → API) ou via `POST /api-keys` com a
sessão do dono. O token aparece **uma única vez**, na criação — depois só o
hash SHA-256 fica no banco e não há como recuperá-lo.

```
X-Api-Key: zsk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Escopos

Peça só o que a integração usa — uma chave de terceiro que só precisa disparar
mensagem não deve carregar leitura do CRM.

| Escopo | Permite |
|---|---|
| `messages:send` | `POST /messages`, `GET /numbers` |
| `messages:read` | `GET /messages`, `GET /messages/:id` |
| `webhooks:manage` | `POST /webhooks`, `GET /webhooks/deliveries` |
| `conversations:read` | `GET /conversations` |
| `contacts:read` | `GET /contacts` |

Chave sem o escopo exigido recebe `403`; chave ausente, inválida ou revogada
recebe `401`.

### Limites de uso

| Rota | Limite |
|---|---|
| `POST /messages` | 30 / minuto |
| Demais rotas | 60 / minuto |

O limite de envio é mais baixo de propósito: cada chamada vira uma mensagem de
WhatsApp real para uma pessoa real, e um laço acidental no integrador viraria
spam em nome do cliente — com risco de banimento do número na Meta, que é dano
irreversível.

---

## 2. Testar a conexão

```bash
curl https://api.zapscript.me/public/v1/me \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY"
```

```json
{
  "ok": true,
  "plan": "empresas",
  "scopes": ["messages:send", "messages:read", "webhooks:manage"],
  "webhook": { "url": "https://...", "active": true, "events": ["message.received"] },
  "availableEvents": ["message.received", "message.status", "transcription.completed"]
}
```

---

## 3. Enviar mensagem

Primeiro descubra o `numberId` do número conectado:

```bash
curl https://api.zapscript.me/public/v1/numbers \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY"
```

```json
{ "data": [ { "id": "clx...", "phoneNumber": "5511999999999", "status": "connected", "connected": true } ] }
```

Envie (`connected: true` é obrigatório — número desconectado devolve `422`):

```bash
curl -X POST https://api.zapscript.me/public/v1/messages \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: consulta-8842-confirmacao" \
  -d '{
    "numberId": "clx...",
    "to": "5511999999999",
    "body": "Olá, Maria! Confirma sua consulta de amanhã às 14h? Responda SIM ou NÃO."
  }'
```

```json
{
  "id": "clz...",
  "status": "sent",
  "to": "5511999999999",
  "body": "Olá, Maria! Confirma sua consulta...",
  "numberId": "clx...",
  "attempts": 1,
  "failureReason": null,
  "idempotencyKey": "consulta-8842-confirmacao",
  "sentAt": "2026-10-02T14:30:01.000Z",
  "createdAt": "2026-10-02T14:30:00.000Z"
}
```

### Campos

| Campo | Obrigatório | Observação |
|---|---|---|
| `numberId` | sim | de `GET /numbers` |
| `to` | sim | com DDI e DDD; aceita `+55 11 99999-9999` e normaliza para dígitos |
| `body` | sim | 1 a 1000 caracteres |
| `idempotencyKey` | não | no body ou no header `Idempotency-Key` |

### Status

`status` reflete o resultado **real** do envio no momento da resposta — não é
um "aceito, confie em nós":

| Status | Significado |
|---|---|
| `sent` | entregue à Evolution API com sucesso |
| `failed` | as 3 tentativas falharam; veja `failureReason` |
| `queued` | registro criado, envio ainda não concluído |

O `POST` só responde **depois** de tentar enviar, então a resposta já vem com
`sent` ou `failed` — `queued` praticamente não aparece ali. Ele existe para o
caso de leitura concorrente e para a borda em que o processo da API é
reiniciado no meio do envio: nesse cenário o registro fica em `queued` e o
status real deve ser confirmado pelo evento `message.status` ou por uma nova
consulta.

### Timeout do seu cliente HTTP

Como o `POST` aguarda o envio, use um timeout de cliente **de pelo menos 60s**.
São até 3 tentativas e cada uma tem teto de 15s contra a Evolution API, então o
pior caso (instância pendurada três vezes) chega a ~45s. No caminho normal a
resposta sai em 1–2s.

Se o seu cliente desistir antes, **reenvie com a mesma `idempotencyKey`**: a
chamada seguinte devolve o registro original em vez de mandar a mensagem de
novo. É exatamente para isso que a chave existe.

### Idempotência

Mande uma `idempotencyKey` por **intenção de envio** (ex.: o id da consulta +
o tipo de aviso). Um POST repetido com a mesma chave devolve o registro
original, com `200` em vez de `201`, e **não reenvia** a mensagem. Isso cobre
timeout do seu lado, retry automático de biblioteca HTTP e redeploy no meio da
requisição — sem a chave, cada um desses casos mandaria a mensagem de novo
para o cliente final.

A chave é única por conta, então ela nunca colide com a de outro cliente.

### Consultar depois

```bash
curl https://api.zapscript.me/public/v1/messages/clz... \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY"

# histórico (filtro opcional por status)
curl "https://api.zapscript.me/public/v1/messages?limit=50&status=failed" \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY"
```

---

## 4. Webhooks (receber eventos)

### Assinar

```bash
curl -X POST https://api.zapscript.me/public/v1/webhooks \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://meuapp.com/api/webhooks/zapscript",
    "events": ["message.received"]
  }'
```

```json
{
  "id": "clw...",
  "url": "https://meuapp.com/api/webhooks/zapscript",
  "events": ["message.received"],
  "active": true,
  "secret": "f3a9...64 hex"
}
```

> **Uma URL por conta.** A configuração de webhook é única por conta ZapScript:
> chamar `POST /webhooks` de novo (ou configurar pelo dashboard) **substitui** a
> URL e a lista de eventos anterior. Não é possível hoje mandar
> `transcription.completed` para um destino e `message.received` para outro —
> aponte todos os eventos para a mesma URL e roteie por `event` do seu lado.

Guarde o `secret` — é com ele que você valida a assinatura. A URL precisa ser
HTTPS e pública: endereços internos, loopback e metadata de nuvem são
recusados (anti-SSRF), tanto no cadastro quanto **em cada disparo** (protege
contra DNS rebinding).

### Eventos

| Evento | Quando dispara |
|---|---|
| `message.received` | contato enviou mensagem de **texto** para um número seu |
| `message.status` | um envio seu mudou de status (`sent` / `failed`) |
| `transcription.completed` | transcrição de áudio concluída |

Você só recebe os eventos que assinou. Uma config existente que nunca declarou
`events` continua valendo como `["transcription.completed"]`, então nada novo
chega sem você pedir.

### Headers de cada entrega

| Header | Conteúdo |
|---|---|
| `X-ZapScript-Signature` | `sha256=<hmac_sha256(secret, corpo_cru)>` |
| `X-ZapScript-Event` | nome do evento |
| `X-ZapScript-Delivery` | id único desta entrega — **use para deduplicar** |
| `X-ZapScript-Timestamp` | ISO-8601 do disparo |

### Payload

```json
{
  "event": "message.received",
  "timestamp": "2026-10-02T14:30:00.000Z",
  "data": {
    "numberId": "clx...",
    "contactPhone": "5511999999999",
    "contactName": "Maria Silva",
    "text": "sim",
    "messageId": "3EB0C767D0D8B6A1E2F1"
  }
}
```

`message.status`:

```json
{
  "event": "message.status",
  "timestamp": "2026-10-02T14:30:01.000Z",
  "data": {
    "id": "clz...",
    "numberId": "clx...",
    "to": "5511999999999",
    "status": "failed",
    "attempts": 3,
    "failureReason": "instance offline"
  }
}
```

### Validar a assinatura (Node.js / Next.js)

O HMAC é calculado sobre o **corpo cru**, então leia o body como texto antes de
fazer `JSON.parse` — se você passar o objeto reserializado, a assinatura não
vai bater (a ordem das chaves e o espaçamento mudam).

```ts
import crypto from 'crypto';

export async function POST(req: Request) {
  const raw = await req.text();                       // corpo CRU, não req.json()
  const received = req.headers.get('x-zapscript-signature') ?? '';

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.ZAPSCRIPT_WEBHOOK_SECRET!)
    .update(raw)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response('assinatura inválida', { status: 401 });
  }

  const payload = JSON.parse(raw);

  // Replay: o timestamp está DENTRO do corpo assinado, então é confiável.
  const age = Date.now() - new Date(payload.timestamp).getTime();
  if (age > 5 * 60_000) return new Response('payload expirado', { status: 401 });

  // Dedupe: a mesma entrega pode chegar duas vezes (retry após timeout seu).
  const deliveryId = req.headers.get('x-zapscript-delivery');
  if (deliveryId && (await jaProcessado(deliveryId))) {
    return new Response('ok (duplicado)', { status: 200 });
  }

  if (payload.event === 'message.received') {
    const { contactPhone, text } = payload.data;
    // ... casa pelo telefone, atualiza status
  }

  return new Response('ok', { status: 200 });   // responda 2xx rápido
}
```

### Entrega e retry

Responda **2xx rápido** e processe de forma assíncrona. Comportamento do nosso
lado:

- timeout de 8s por tentativa;
- 5 tentativas com backoff exponencial (10s → 20s → 40s → 80s → 160s);
- `5xx`, `408`, `429` e erro de rede → reentrega;
- outros `4xx` → considerado recusa definitiva, sem retry.

Como há retry, **a mesma entrega pode chegar mais de uma vez**. Deduplique por
`X-ZapScript-Delivery`.

### Depurar entregas

```bash
curl https://api.zapscript.me/public/v1/webhooks/deliveries \
  -H "X-Api-Key: $ZAPSCRIPT_API_KEY"
```

Devolve as últimas tentativas com `success`, `httpStatus`, `attempt` e `error`
— dá para ver se o evento saiu e o que a sua URL respondeu, sem abrir suporte.

---

## 5. Exemplo completo: confirmação de consulta

1. **Uma vez**, assine o evento e guarde o secret:
   `POST /public/v1/webhooks` com `events: ["message.received"]`.
2. Ao agendar, mande a pergunta:
   `POST /public/v1/messages` com `Idempotency-Key: consulta-<id>-confirmacao`.
3. Receba a resposta em `message.received`, valide o HMAC, case pelo
   `contactPhone` e atualize `pending → confirmed | cancelled`.
4. Opcional: assine `message.status` para saber se a pergunta chegou a sair.

### Observação importante sobre palavras reservadas

Algumas respostas do contato são interceptadas pelo próprio ZapScript **antes**
de chegarem ao seu fluxo, por serem convenção de opt-out de campanhas:

- `PARAR`, `SAIR`, `STOP`, `CANCELAR`, `UNSUBSCRIBE` → registram opt-out e o
  contato recebe uma confirmação automática do ZapScript;
- `SIM` → se houver opt-in de campanha pendente para aquele telefone, é
  consumido como confirmação de opt-in.

**O evento `message.received` é disparado de qualquer forma** — ele é o
primeiro consumidor do texto, justamente para que a integração nunca perca uma
resposta. Mas o contato **também** vai receber a resposta automática de
campanhas nesses casos.

Portanto: ao desenhar a pergunta, prefira alternativas que não colidam com
essas palavras. Em vez de *"responda SIM para confirmar ou CANCELAR para
desmarcar"*, use algo como *"responda **1** para confirmar ou **2** para
desmarcar"*.

---

## 6. Erros

| Código | Quando |
|---|---|
| `400` | corpo inválido (veja `error`), evento desconhecido, telefone fora de 10–15 dígitos |
| `401` | chave ausente, inválida ou revogada |
| `402` | plano não habilitado para a API pública |
| `403` | chave sem o escopo exigido |
| `404` | recurso não encontrado (número, mensagem, webhook) |
| `422` | número existe mas não está conectado ao WhatsApp |
| `429` | limite de uso excedido |

Formato: `{ "error": "mensagem legível" }`.
