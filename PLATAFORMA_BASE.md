# ZapScript.me como Plataforma-Base (kernel + módulos)

> Complemento de `MODULOS_ARQUITETURA.md`. Enquanto aquele define **titularidade**
> (quem tem acesso a quê — já implementado na Fase 1), este define como o
> **ZapScript.me deixa de ser "o produto de transcrição" e passa a ser a base comum**
> onde Atende, Atende Qualidade, Cobrança, CRM (Gestão Clientes), Campanhas, Multicanal
> e Legenda plugam.

Data: 2026-07-07. Branch: `claude/zapscript-modules-nv95eb`.

---

## 1. O acoplamento-raiz (diagnóstico do código atual)

Hoje "receber uma mensagem" **é** "transcrever" — os dois estão soldados:

- `apps/api/src/routes/evolution-webhook.ts` importa `transcriptionQueue` e, ao detectar
  áudio, enfileira **direto** na fila `transcriptions`. Só sabe falar de áudio/transcrição.
- `apps/worker/src/index.ts` (`routeJob`) despacha por **transporte** (`manual` |
  `whatsapp-twilio` | `whatsapp-evolution` | `official`), **não por módulo**. Toda a lógica é transcrição.
- O envio de saída está espalhado: `services/whatsapp.ts`, `whatsapp-official.ts`,
  `twilio.ts`, `evolution.ts` — cada caller escolhe o transporte na mão.

Consequência: adicionar `atende` (responder), `crm` (registrar no funil) ou `cobranca`
(agendar lembrete) exigiria **editar o webhook e o worker de transcrição** — exatamente o
acoplamento que impede a plataforma. Um mesmo áudio recebido precisa, dependendo do que o
usuário contratou, ser **transcrito E respondido E registrado E medido** ao mesmo tempo.

---

## 2. Alvo: Kernel (base comum) + Módulos (plug-ins)

### 2.1 Kernel — serviços compartilhados (já existem; falta reconhecê-los como "SDK da plataforma")

| Capacidade do kernel | Onde vive hoje |
|----------------------|----------------|
| Identidade / SSO (login único) | Supabase Auth + `@fastify/jwt` + `/auth/me` |
| **Titularidade** (Product/Entitlement, `requireModule`) | `lib/moduleGate.ts` (Fase 1) |
| Billing (assinatura agregada Asaas) | `routes/billing.ts`, `lib/asaas.ts` |
| **Messaging Gateway** (entrada + saída) | Evolution/Oficial/Twilio — **a extrair** |
| Motor de IA (transcrição Whisper/Groq, resumo Claude) | `apps/worker` |
| Storage de mídia | Supabase Storage |
| Observabilidade (logs, Sentry, health) | `lib/logger.ts`, `services/health-monitor.ts` |
| Admin, e-mails, notificações | `routes/admin*`, `lib/mailer.ts` |
| App shell / launcher | `apps/web/src/app/app` (Fase 1) |

### 2.2 Módulos — plugam no kernel via um contrato

`core` (transcrição) deixa de ser "o app" e vira **só mais um módulo**, no mesmo pé de
`atende`, `crm`, etc. Todos consomem o kernel; nenhum fala direto com o transporte.

```
                         ┌────────────────────────────────────────┐
   WhatsApp / IG  ─────► │  Messaging Gateway (entrada)           │
   webhooks             │  normaliza → InboundMessage canônico    │
                         └───────────────┬────────────────────────┘
                                         │ publica  messages.inbound
                                 ┌───────▼─────────┐
                                 │   Dispatcher    │  resolve dono do número
                                 │ (fan-out p/     │  + módulos ATIVOS (entitlement)
                                 │  módulos ativos)│
                                 └───┬───┬───┬───┬─┘
             queue:core ◄───────────┘   │   │   └────────► queue:crm
             queue:atende ◄─────────────┘   └────────────► queue:atende-qualidade
                    │                                             │
        (cada módulo processa e, se responde, envia via)         │
                    └────────►  Messaging Gateway (saída)  ◄──────┘
                                send(channel, to, payload)
```

---

## 3. Contrato de módulo (`ZapModule`)

Uma interface única que todo módulo implementa e registra no kernel. O kernel só invoca
handlers de módulos que o usuário **contratou** (gate por entitlement).

```ts
// packages/modules/contract.ts  (kernel-facing)
export interface ZapModule {
  key: string;                                   // == catalog.ts / Product.key

  /** Rotas HTTP do módulo (Fastify). Prefixo padrão /m/<key>. */
  registerRoutes?(app: FastifyInstance): void;

  /** Filas BullMQ próprias do módulo (nome sugerido: `queue:<key>`). */
  queues?: { name: string; process: (job: Job) => Promise<void> }[];

  /** Consumidor do barramento de entrada — chamado no fan-out se o módulo estiver ativo. */
  onInboundMessage?(msg: InboundMessage, ctx: ModuleContext): Promise<void>;

  /** Webhooks externos que o módulo expõe (ex.: cobranca → status de pagamento). */
  webhooks?: { path: string; handler: RouteHandler }[];

  /** Jobs agendados (ex.: cobranca varre vencimentos diários). */
  cron?: { schedule: string; run: (ctx: ModuleContext) => Promise<void> }[];
}
```

`ModuleContext` é o **SDK do kernel** entregue ao módulo: `{ userId, gateway (envio),
ai (transcrição/resumo), prisma, logger, storage }`. O módulo nunca importa Evolution/Asaas
direto — recebe capacidades pelo contexto (inversão de dependência → testável e desacoplado).

---

## 4. Barramento de eventos — o coração da integração

Sem infra nova: **Redis + BullMQ já instalados**.

1. **Entrada normalizada.** Os webhooks (`evolution-webhook`, `whatsapp-webhook` oficial,
   futuro `instagram-webhook`) param de conhecer transcrição. Cada um só faz: validar →
   **normalizar** para `InboundMessage` `{ userId, numberId, channel, from, kind: 'audio'|'text'|'image', media?, text? }`
   → publicar na fila `messages.inbound`.
2. **Dispatcher (fan-out).** Um consumidor de `messages.inbound` resolve o dono do número e,
   via `getUserModules(userId)`, faz `queue:<key>.add(msg)` para **cada módulo ativo** cujo
   `onInboundMessage` aceite aquele `kind`. Ex.: áudio recebido por um usuário com
   `core+atende+crm` → 3 jobs paralelos.
3. **Saída única.** `MessagingGateway.send(channel, to, payload)` encapsula Evolution / Cloud
   API / Twilio / IG. Módulos só chamam o gateway; trocar de transporte é problema do kernel.

Ganho: adicionar um módulo = **implementar o contrato e registrá-lo**. Zero edição no webhook
ou no worker de transcrição. É o padrão *event-driven + coreografia* aplicado ao que já existe.

---

## 5. Isolamento de dados

Um único schema Prisma (monólito modular), com **prefixo de módulo** nas tabelas:

- **Kernel:** `User`, `Product`, `Entitlement`, `Subscription`, `WhatsappNumber`, `AuditLog`…
- `core`: `Transcription` (já existe).
- `crm`: `crm_lead`, `crm_stage`, `crm_note`.
- `cobranca`: `cobranca_cliente`, `cobranca_cobranca`, `cobranca_agendamento`.
- `campanhas`: `campanha`, `campanha_envio`.
- `atende`: `atende_conversa`, `atende_mensagem` (já há `SupportAtendimento`/`KnowledgeBase`).
- `atende-qualidade`: lê dados de `atende` (não tem tabelas próprias de origem; só agrega/materializa).

Regra de ouro: **toda tabela de módulo carrega `userId`** e toda query filtra por ele
(multi-tenant por usuário). Nunca vazar dados/menus de módulo não contratado (§ do doc de arquitetura).

---

## 6. Refatoração incremental (strangler fig — sem big-bang)

- **Passo 0 — feito (Fase 1):** entitlements + `requireModule` + launcher `/app`.
- **Passo 1 — Messaging Gateway (saída):** criar `services/gateway.ts` como fachada única sobre
  os enviadores atuais; migrar callers aos poucos. Comportamento idêntico, risco baixo.
- **Passo 2 — Barramento de entrada:** webhook passa a publicar `InboundMessage` em
  `messages.inbound`; um dispatcher enfileira em `queue:core`. **Externamente nada muda** —
  `core` é o único consumidor e transcreve como hoje. Prova o backbone sem alterar o produto.
- **Passo 3 — Extrair o módulo `core`:** mover as features de transcrição para
  `modules/core/*` atrás do `ZapModule`. O kernel deixa de "ser" transcrição.
- **Passo 4 — Provisionamento billing → entitlement:** webhook Asaas cria/cancela `Entitlement`
  e recomputa o valor da assinatura agregada. Aqui "contratar" passa a liberar acesso de verdade.
- **Passo 5+ — Novos módulos plugam pelo contrato:** `cobranca` primeiro (reusa 100% o gateway;
  não depende do fan-out de entrada), depois `campanhas`, `crm`, `atende-qualidade`, etc.

Cada passo é reversível e entregável isoladamente. Nenhum exige parar o produto atual.

---

## 7. Estrutura de código alvo

```
packages/
  modules/
    catalog.ts            ← catálogo (feito)
    contract.ts           ← ZapModule + InboundMessage + ModuleContext  (Passo 3)
  database/               ← schema único, tabelas prefixadas por módulo

apps/api/src/
  kernel/
    gateway.ts            ← Messaging Gateway (saída)             (Passo 1)
    inbound.ts            ← normalização + publish messages.inbound (Passo 2)
    dispatcher.ts         ← fan-out por entitlement                (Passo 2)
    registry.ts           ← registra ZapModules ativos e suas rotas/filas
    moduleGate.ts         ← (já em lib/, movido p/ kernel)
  modules/
    core/                 ← transcrição (extraída)                (Passo 3)
    cobranca/             ← 1º módulo novo                        (Passo 5)
    crm/  campanhas/  atende/  atende-qualidade/  multicanal/  legenda/

apps/worker/src/
  kernel/dispatcher-worker.ts  ← consome messages.inbound
  modules/<key>/worker.ts      ← processa queue:<key>
```

---

## 8. Resumo da decisão

- **Kernel = capacidades** (identidade, titularidade, billing, gateway, IA, storage, observabilidade).
- **Módulo = plugin** que implementa `ZapModule` e recebe o kernel via `ModuleContext`.
- **Integração = barramento** (entrada normalizada → fan-out por entitlement → saída única),
  em cima do Redis/BullMQ **que já existe**.
- **Migração = strangler** em 5 passos reversíveis; o `core` (transcrição) vira só mais um módulo.
