# MKT-Fast — Bot de Missões de Marketing

> **O que é:** motor genérico de **"missão de divulgação"** — você cadastra 1 missão (o quê
> divulgar, em quais canais, até quando, qual meta de alcance) e o MKT-Fast a executa, seja
> **postando sozinho** nos canais que já controla, seja **convocando pessoas** para cumprir a
> parte que só um humano consegue (compartilhar no próprio story, postar num grupo que participa).
> Primeira missão real: divulgar o **ZapScript.me**. Construído de forma **genérica** desde o
> início para caber qualquer missão futura (lançamento de módulo, campanha sazonal, pedir review).

Status: **proposta de arquitetura (planejamento)**. Data: 2026-09-13. Branch:
`claude/laughing-turing-bjtdyu`.

Decisões já fechadas com o usuário (não reabrir sem motivo novo):

| Decisão | Escolha |
|---|---|
| Executor | **Híbrido** — bot posta sozinho onde tem credencial/API; humano executa e prova onde não dá |
| Canais v1 | **Multicanal**: WhatsApp (reusa Campanhas) + Instagram + Facebook (novo) |
| É vendável? | **Não por enquanto** — ferramenta interna (só a equipe ZapScript cria/roda missões), mas o schema é genérico o bastante para virar módulo do catálogo depois |
| Critério de sucesso | **Alcance simples** — nº de destinatários/posts entregues, não clique/conversão |

---

## 1. Conceito de domínio

Duas entidades novas, agnósticas de canal:

- **`Mission`** — o quê divulgar, para quais canais, até quando, qual meta.
- **`MissionExecution`** — 1 linha por (missão × canal × alvo): o que efetivamente rodou, quem
  executou (bot ou humano), e quanto alcançou.

Uma missão "multicanal" nada mais é do que N execuções com `channel` diferente. Isso é o que
torna o motor genérico: adicionar um canal novo = adicionar um **adapter**, não mudar o schema.

```prisma
// packages/database — aditivo, não toca em nada existente

model Mission {
  id            String    @id @default(cuid())
  key           String?   @unique          // slug opcional, ex: 'lanca-zapscript-set26'
  title         String
  objective     String                     // texto livre — o "porquê" (contexto p/ humano e log)
  content       Json                       // { text, mediaUrl?, linkUrl?, hashtags? } — payload cru por canal
  channels      String[]                   // ['whatsapp_groups','whatsapp_broadcast','instagram_feed','instagram_story','facebook_page','human_share']
  targetReach   Int?                       // meta de alcance total (null = "o quanto der")
  status        String    @default("draft")// draft | scheduled | running | completed | canceled
  scheduledAt   DateTime?
  startedAt     DateTime?
  completedAt   DateTime?
  createdBy     String                     // userId do admin que criou
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  executions    MissionExecution[]
}

model MissionExecution {
  id            String    @id @default(cuid())
  missionId     String
  channel       String                     // um dos values de Mission.channels
  executor      String                     // 'bot' | 'human'
  targetRef     String?                    // id do grupo/número/conta IG, ou userId do humano convocado
  status        String    @default("pending") // pending|sent|posted|failed|proof_submitted|approved|rejected
  proofUrl      String?                    // link/print — só quando executor='human'
  reachCount    Int?                       // alcance simples desta execução
  errorReason   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  mission       Mission   @relation(fields: [missionId], references: [id], onDelete: Cascade)

  @@index([missionId, status])
  @@index([executor, status])
}
```

`content` como `Json` (em vez de campo por canal) evita migração toda vez que um canal novo tem
um formato diferente — cada adapter lê do JSON só o que precisa.

---

## 2. Contrato de canal (adapter) — o que faz o motor ser genérico

```ts
// packages/modules/mktfast/channel.ts
interface MissionChannelAdapter {
  key: string;                 // 'whatsapp_groups', 'instagram_feed', ...
  executor: 'bot' | 'human';
  resolveTargets(mission: Mission): Promise<string[]>;      // quem/o quê vai receber
  publish(mission: Mission, targetRef: string): Promise<{ status: 'sent'|'posted'|'failed'; reachCount?: number; errorReason?: string }>;
}
```

Um canal novo (ex.: Google Meu Negócio, LinkedIn) = implementar essa interface e registrar num
registry — igual ao padrão `ZapModule` já usado na plataforma (`PLATAFORMA_BASE.md`). Nenhuma
rota, fila ou tela precisa mudar.

### 2.1 Adapters da v1

| Canal | Executor | Como publica | Reuso de infra |
|---|---|---|---|
| `whatsapp_groups` | bot | Envia via Evolution API para grupos que a própria ZapScript participa | **100%** — mesma fila/serviço de envio do módulo Campanhas |
| `whatsapp_broadcast` | bot | Envia para contatos com **opt-in de marketing** (ver §5 — bloqueio) | **100%** — `campanhasQueue`, rate limiter, opt-out já existentes |
| `instagram_feed` / `instagram_story` | bot | Instagram Content Publishing API (Graph API): cria container de mídia → publica | **Novo** — sem integração hoje no projeto |
| `facebook_page` | bot | Facebook Graph API — publica na Page | **Novo** — sem integração hoje no projeto |
| `human_share` | humano | Convoca por WhatsApp ("aceitar missão" → compartilhar no story/grupo próprio → enviar prova) | Reusa mensageria para convocar; fluxo de prova/aprovação é novo |

**Bloqueador real para `instagram_feed`/`instagram_story`/`facebook_page`:** preciso confirmar
3 coisas antes de codar esse adapter — sem isso o Graph API rejeita toda chamada:
1. Existe uma **Facebook Page** + **Instagram Business Account** vinculados que a ZapScript já
   controla (login comercial)?
2. O **app Meta** usado (o mesmo do WhatsApp Cloud API, em `meta-embedded.ts`, ou um novo?) tem
   os escopos `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`
   aprovados? Esses escopos exigem **App Review** da Meta (pode levar dias) se ainda não tiver.
3. Token de página de longa duração já existe/rotina de refresh está prevista?

Enquanto isso não estiver confirmado, a Fase 2 (§4) fica bloqueada — mas Fase 0 (WhatsApp) não
depende disso e entrega a primeira missão real sozinha.

---

## 3. Fluxo de execução

```
Admin cria Mission (draft) → define channels + content + targetReach
        │
        ▼
POST /admin/mktfast/missions/:id/start (ou scheduler tick se scheduledAt no passado)
        │
        ├─ p/ cada canal 'bot' (whatsapp_*, instagram_*, facebook_page):
        │     resolveTargets() → cria N MissionExecution(status=pending)
        │     → mktfastQueue.addBulk (jobId determinístico missionId:channel:targetRef)
        │     worker chama adapter.publish() → atualiza status/reachCount
        │
        └─ p/ canal 'human_share':
              resolveTargets() = lista de convocados (ver §3.1)
              → envia mensagem WhatsApp individual "Nova missão: <título> — aceitar?"
              → humano aceita → executa fora do sistema → volta e envia prova (link/print)
              → MissionExecution(status=proof_submitted)
              → admin aprova/rejeita manualmente em v1 (sem verificação automática ainda)
              → approved conta reachCount (padrão: 1 por execução aprovada, admin pode ajustar)

Mission.status vira 'completed' quando: todas as execuções terminaram (sent/posted/failed/
approved/rejected) OU targetReach foi atingido (soma de reachCount) OU admin encerra manualmente.
```

### 3.1 Quem são os "convocados" do `human_share`? (a confirmar)

Duas opções, não fecho sozinho porque muda o modelo de recompensa:

- **(a) Só equipe interna** — v1 mais simples, sem tocar em dinheiro/crédito.
- **(b) Base de afiliados** (`REGULAMENTO_AFILIADOS.md`) — reusaria a carteira de créditos já
  existente como recompensa por missão cumprida (ex.: +N créditos por post aprovado). Exige
  decidir um valor/regra nova (esse regulamento hoje só cobre indicação, não missão).

Recomendo **(a) para a Fase 1** — zero risco financeiro/jurídico novo — e (b) como Fase 3
opcional, com o próprio Consultor de Marketing validando o incentivo antes de expor a afiliados.

---

## 4. Fases de entrega

| Fase | Entrega | Depende de | Risco |
|---|---|---|---|
| **0 — Fundação + WhatsApp** | Schema `Mission`/`MissionExecution`, fila `mktfast`, rotas admin CRUD, adapter `whatsapp_groups`/`whatsapp_broadcast` (reusa Campanhas), tela admin simples de criar/acompanhar missão | nada — infra 100% existente | Baixo |
| **1 — `human_share` (equipe)** | Convocação via WhatsApp, submissão de prova, aprovação manual, contagem de alcance | Fase 0 | Baixo |
| **2 — Instagram/Facebook** | Adapter Graph API (Content Publishing), setup de app/token/permissões Meta | Confirmação em §2.1 (pode ter fila de App Review da Meta) | **Médio-alto** (depende de terceiro) |
| **3 — opcional/futuro** | `human_share` para afiliados com recompensa em crédito; verificação automática de prova (IA lê print); virar módulo vendável no catálogo (`packages/modules/catalog.ts`, entitlement, self-service) | Fases 0-2 validadas | — |

**Recomendação:** entregar a Fase 0 primeiro — já cumpre literalmente o pedido ("postar 1
missão, bot cumprir a missão") usando só WhatsApp, sem esperar aprovação de app da Meta nem
decisão sobre afiliados.

---

## 5. Guardrails (não pular)

- **Opt-in de marketing no `whatsapp_broadcast`**: o próprio `CAMPANHAS_ARQUITETURA.md` já
  registra como Risco P0 a ausência histórica de checagem de opt-in. O MKT-Fast **não** cria
  exceção — `whatsapp_broadcast` só pode mirar contato com opt-in de marketing confirmado
  (mesma tabela/checagem do módulo Campanhas). `whatsapp_groups` (grupos que a ZapScript já
  participa) não tem esse problema porque não é mensagem direta a terceiro.
- **Rate limit compartilhado**: adapter de WhatsApp entra na mesma fila/limiter do Campanhas
  (`campanhasQueue`/token bucket Redis) — não criar um segundo caminho de envio concorrente
  para o mesmo número, senão duplica o risco de ban descrito em `CAMPANHAS_ARQUITETURA.md`.
- **Instagram/Facebook**: respeitar limite da Meta (~25 posts/24h por conta IG) — o adapter
  deve recusar agendar além disso, não só logar erro depois.
- **Não vendável ainda**: sem entrada em `packages/modules/catalog.ts`, sem `requireModule` —
  acesso via `requireAdmin` simples (mesmo guard usado em outras telas internas).

---

## 6. Esboço de rotas (Fase 0)

```
apps/api/src/routes/admin/mktfast.ts   (preHandler: app.authenticate, requireAdmin)

POST   /admin/mktfast/missions                      cria (draft)
GET    /admin/mktfast/missions                       lista + progresso agregado (reach/meta)
GET    /admin/mktfast/missions/:id                   detalhe + execuções
POST   /admin/mktfast/missions/:id/schedule          define scheduledAt
POST   /admin/mktfast/missions/:id/start             dispara agora (canais bot)
POST   /admin/mktfast/missions/:id/cancel
POST   /admin/mktfast/executions/:execId/proof       humano envia prova (Fase 1)
POST   /admin/mktfast/executions/:execId/approve     admin aprova prova (Fase 1)
POST   /admin/mktfast/executions/:execId/reject
```

```
apps/worker/src/queues/mktfast.ts       Worker('mktfast', concurrency=...)
apps/worker/src/mktfast-scheduler.ts    tick 60s: scheduled → running (updateMany atômico, igual campanhas-scheduler.ts)
```

Web: tela nova em `/admin/mktfast` (fora do app shell de módulos — é ferramenta interna, não
aparece no launcher `/app`).

---

## 7. Perguntas em aberto antes de codar a Fase 2+ (não bloqueiam a Fase 0)

1. Facebook Page + Instagram Business Account da ZapScript já existem e estão em mãos de quem
   (credenciais)?
2. O app Meta do WhatsApp Cloud API serve para pedir os escopos de publicação, ou precisa de um
   app separado?
3. `human_share`: equipe interna (Fase 1) ou já abrir para afiliados com recompensa (Fase 3)?

## 8. Próximo passo recomendado

Implementar a **Fase 0** agora: migração Prisma (`Mission`/`MissionExecution`), fila `mktfast`,
rotas admin, adapter WhatsApp reusando o serviço de envio do Campanhas, e uma tela simples para
cadastrar a missão "Divulgar ZapScript.me" e acompanhar o alcance. Isso já cumpre o pedido
original de ponta a ponta sem esperar nenhuma dependência externa.
