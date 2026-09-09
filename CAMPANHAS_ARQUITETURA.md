# ZapScript Campanhas — Arquitetura, Riscos e Roadmap

> **Achado prévio:** o módulo `campanhas` **já existe e está em produção** (`status: 'bundled'`
> no catálogo, incluso no Profissional/Empresas desde a migração `20260908_campanhas_bundled`).
> Isto não é um plano de feature nova — é um levantamento sênior do as-built, com
> especificação técnica concreta dos itens de maior risco, no formato de
> `MODULOS_ARQUITETURA.md`/`PLATAFORMA_BASE.md`.

Data: 2026-09-09 (revisão 3 — auditoria de segurança aplicada) · Branch: `claude/laughing-ritchie-3n4vj1`

## TL;DR

- **O que é:** disparo em massa via WhatsApp Cloud API oficial (Meta), com template
  pré-aprovado — a única via legal pós-fechamento de bots não autorizados (política Meta
  dez/2025). Fluxo completo (CSV → agendamento/disparo → status de entrega → opt-out) já
  funciona e é bem construído (idempotência, dedupe, isolamento por tenant).
- **Risco nº 1 (P0):** o módulo não sabe quantos contatos o número do cliente pode alcançar
  em 24h nem o `quality_rating` dele — uma campanha grande pode simplesmente ser rejeitada em
  massa pela Meta, e o único mecanismo de proteção hoje é um teto artificial de 10 msg/s
  **compartilhado por todos os tenants**.
- **Risco nº 2 (P0):** não há checagem de opt-in — só opt-out reativo. Maior exposição
  LGPD/política Meta da suíte inteira.
- **Correção desta revisão:** a v1 sugeria rate-limit "por grupo" do BullMQ — isso é recurso
  do **BullMQ Pro**; o projeto usa `bullmq` OSS (`^5.8.4`, confirmado em `package.json`), que
  não tem isso. Substituído por um design concreto de token bucket em Redis (§5.3).
- **Não fazer agora:** migrar o módulo para o contrato `ZapModule`/kernel de
  `PLATAFORMA_BASE.md` — nenhum outro módulo o usa ainda; sem ganho imediato.
- **Auditoria de código (revisão 3):** o único ponto de confiança externo do módulo —
  `whatsapp-webhook.ts`, que alimenta status de entrega e opt-out de `CampanhaContato` — tinha
  três problemas reais de robustez/segurança, já corrigidos nesta revisão (§7). Um quarto item
  (`WHATSAPP_APP_SECRET` pode estar ausente em produção) **não pôde ser confirmado** — o
  sandbox não tem acesso SSH ao Vultr — e precisa de verificação manual (§7.4).

---

## 1. Arquitetura atual (as-built)

```
apps/web (/app/campanhas): lista → nova (CSV) → detalhe (stats) → optouts
        │ REST (Fastify)
apps/api/routes/modules/campanhas.ts  (auth + requireModule('campanhas'))
  GET  /                lista + stats agregados         POST /              cria rascunho
  GET  /templates        APPROVED do WABA (Graph API)     POST /:id/contatos  upload CSV (dedupe 3x)
  GET  /optouts           lista opt-out do usuário          POST /:id/schedule|unschedule
                                                             POST /:id/start|pause|cancel
        │ campanhasQueue.addBulk (jobId determinístico campanhaId:contatoId)
        ▼
apps/worker: Worker('campanhas', concurrency=CAMPANHAS_WORKER_CONCURRENCY[=3])
             limiter: { max: 10, duration: 1000 }  ← teto GLOBAL, todos os tenants
             + campanhas-scheduler.ts (tick 60s: scheduled→running, updateMany atômico)
        │ sendTemplateMessage() — services/whatsapp-campaigns.ts
        ▼
   Graph API Meta (token por WhatsappNumber do próprio cliente, nunca global)
        │ webhook assíncrono de status
        ▼
apps/api/routes/whatsapp-webhook.ts
  status sent/delivered/read/failed → CampanhaContato.wamid (índice hot path)
  opt-out por palavra-chave (PARAR/SAIR/STOP/CANCELAR/UNSUBSCRIBE) → CampanhaOptOut.upsert
```

Único container de worker (sem réplicas no `docker-compose.yml` atual) — importante para o
design do rate limiter em §5.3: hoje um contador em memória já resolveria, mas o código já
assume explicitamente a possibilidade de múltiplas réplicas (`campanhas-scheduler.ts` usa
`updateMany` atômico "para não duplicar entre réplicas"), então vale manter a mesma disciplina
e ir direto para uma solução em Redis.

**Modelo de dados:** `Campanha` (dono, número, template, status, contadores) →
`CampanhaContato` (1 por destinatário, status `pending|sent|delivered|read|failed|optout`,
`wamid`) → `CampanhaOptOut` (por `userId`+`phone`, não global — correto para LGPD/Meta).

**O que já está bem resolvido (não reinventar):** idempotência ponta a ponta (jobId
determinístico + `updateMany` filtrado por status evita corrida scheduler/worker/webhook),
pausa sem matar jobs em voo (reconfere status ao vivo em vez de remover do BullMQ), opt-out
cobrindo fila futura e em voo, CSV parser com dedupe em 3 camadas, credencial 100% por tenant.

---

## 2. Matriz de priorização (risco × esforço)

```
                    ESFORÇO BAIXO                    ESFORÇO ALTO
              ┌───────────────────────────┬───────────────────────────────┐
   RISCO      │ FAZER AGORA (P0)           │ PLANEJAR (P1/P2)               │
   ALTO       │ • Tier/quality rating      │ • Rate limit por tenant (§5.3) │
              │   (§5.1)                   │ • Auto-pausa em throttling     │
              │ • Opt-in + auditoria (§5.4)│   (§5.2, acopla no mesmo work) │
              ├───────────────────────────┼───────────────────────────────┤
   RISCO      │ QUICK WIN                  │ BACKLOG                        │
   BAIXO      │ • Validar nº de variáveis  │ • Audiência reutilizável        │
              │   do template vs. CSV      │ • Header de mídia + preview     │
              │ • Painel admin de taxa de  │ • Atribuição campanha→resposta  │
              │   falha/opt-out            │ • Criação de template in-app    │
              └───────────────────────────┴───────────────────────────────┘
```

O quadrante "fazer agora" concentra os dois riscos que **crescem com o sucesso do produto**:
quanto mais campanhas grandes rodarem sem eles, maior a chance de um cliente levar o próprio
WABA a degradar (tier/quality) ou de a plataforma se expor legalmente (opt-in). Os demais
itens são importantes mas não compostos pelo tempo.

---

## 3. Especificação técnica — itens P0

### 3.1 Tier de mensageria e quality rating

**Schema** (`WhatsappNumber`, migration nova):

```prisma
metaMessagingLimitTier String?   // 'TIER_250'|'TIER_1K'|'TIER_10K'|'TIER_100K'|'UNLIMITED'
metaQualityRating      String?   // 'GREEN'|'YELLOW'|'RED'|'UNKNOWN'
metaLimitsSyncedAt     DateTime?
```

**Origem do dado:** `GET /{phone-number-id}?fields=quality_rating,messaging_limit_tier`
(confirmar nomes exatos de campo na versão vigente da Graph API antes de implementar — a Meta
já renomeou/reestruturou isso mais de uma vez). Refresh em dois gatilhos:

1. **Sob demanda**, sempre que o usuário abre a tela de criar/agendar campanha (`GET
   /templates` já faz uma chamada à Graph API nesse fluxo — dá pra piggyback sem round-trip
   extra).
2. **Assíncrono**, se a conta de developer da Meta estiver inscrita no campo de webhook de
   qualidade (verificar disponibilidade — quando existe, é preferível a polling porque chega
   no exato momento da mudança, sem lag).

**Gate em `/:id/start` e `/:id/schedule`** (`routes/modules/campanhas.ts`): antes de
enfileirar, comparar `audienceCount` (pendentes) contra o teto numérico do
`metaMessagingLimitTier`; se exceder, **não bloquear** (isso mataria campanhas legítimas que
enviam em lotes ao longo de vários dias) — em vez disso, **avisar** no response e deixar a
decisão de negócio para §5.2 decidir o ritmo real de envio.

### 3.2 Auto-pausa em erro de rate-limit da Graph API

Hoje (`processCampanhaJob`, `apps/worker/src/modules/campanhas.ts`) qualquer erro de
`sendTemplateMessage` vira uma tentativa de retry do BullMQ e, ao esgotar, o contato é marcado
`failed` — sem distinguir "número inválido" (falha permanente, correto marcar failed) de
"throttled pela Meta" (falha temporária, o contato teria sucesso depois).

```ts
// dentro de processCampanhaJob, ao capturar erro de sendTemplateMessage:
if (isMetaThrottleError(err)) {           // checar err.code / subcode de rate-limit
  await prisma.campanha.updateMany({
    where: { id: campanhaId, status: 'running' },
    data:  { status: 'paused' },          // idempotente — só a 1ª chamada efetiva
  });
  throw err;                              // NÃO marca o contato como failed — ele
}                                          // continua 'pending' e some da fila junto
                                           // com a campanha pausada (mesma semântica de
                                           // pausa manual já existente em §"pontos fortes")
```

Isso reaproveita 100% a máquina de estados que já existe (`/pause` já é um estado suportado
pelo worker); só falta o próprio worker acionar essa transição sozinho, com um motivo
registrado para a UI explicar ao usuário *por que* pausou (novo campo opcional
`Campanha.pausedReason`, ou reaproveitar `errorMessage` a nível de campanha — hoje só existe a
nível de contato).

### 3.3 Rate limit por tenant/número (Redis token bucket)

**Problema real:** o `limiter: { max: 10, duration: 1000 }` do `Worker('campanhas')` é
avaliado pelo BullMQ **globalmente**, somando os envios de todos os clientes. Duas campanhas
simultâneas de clientes diferentes competem pela mesma cota de 10 msg/s — ruído entre
inquilinos, sem isolamento.

**Correção OSS-compatível** (sem depender de BullMQ Pro): mover o rate limit por número para
dentro do próprio `processCampanhaJob`, com uma sliding-window simples em Redis (o Redis já é
dependência obrigada do projeto — zero infra nova):

```ts
async function allowSend(numberId: string, maxPerSec = 5): Promise<boolean> {
  const key = `campanhas:rl:${numberId}:${Math.floor(Date.now() / 1000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 2); // janela de 1s + margem de clock skew
  return count <= maxPerSec;
}

// no processor, antes de enviar:
if (!(await allowSend(campanha.whatsappNumberId))) {
  throw new Error('RATE_LIMIT_LOCAL'); // BullMQ agenda retry com backoff já configurado
}
```

Mantém o teto global de 10 msg/s do `Worker` como cinto-de-segurança (protege a conta/app
parceiro da Meta como um todo) e adiciona um teto por número **abaixo** dele — evita que um
único cliente monopolize a cota compartilhada. `maxPerSec` por número pode inclusive variar
pelo `metaMessagingLimitTier` de §5.1 (número em tier maior aguenta mais).

### 3.4 Opt-in com auditoria

**Schema** (`CampanhaContato` ou nível de `Campanha` — recomendo nível de `Campanha`, é mais
barato e reflete a realidade: o consentimento é declarado sobre a lista importada, não
per-linha):

```prisma
// em Campanha:
consentConfirmedAt DateTime?
consentConfirmedIp String?
```

**Fluxo:** checkbox obrigatório e não pré-marcado em `/:id/start` ("Confirmo que tenho
consentimento (opt-in) destes contatos para receber mensagens de marketing, conforme LGPD e
política da Meta") — bloqueia o botão de iniciar até marcado; a API grava o timestamp/IP na
própria chamada de `/start`, não confia em estado do client. Baixo custo, fecha a maior
lacuna de compliance do módulo.

---

## 4. Roadmap por fases (com critério de pronto)

| Fase | Itens | Definition of Done | Esforço |
|---|---|---|---|
| **0 — Trust & Safety** (fazer antes de qualquer push de marketing para o módulo) | §5.1 tier/quality rating + §5.4 opt-in | Campanha só inicia com consentimento confirmado; UI mostra tier/quality do número antes do disparo | 3–5 dias |
| **1 — Resiliência de envio** | §5.2 auto-pausa em throttling + §5.3 rate limit por número | Uma campanha de um cliente nunca falha em massa por throttling nem atrasa a de outro cliente | 3–5 dias |
| **2 — Qualidade de disparo** | Validação de variáveis do template vs. CSV no upload + painel admin de taxa de falha/opt-out por campanha | Upload rejeita CSV incompatível com o template antes do envio real; admin enxerga campanhas com taxa de falha/opt-out fora do normal | 3–4 dias |
| **3 — Alcance do produto** | Audiência reutilizável entre campanhas + header de mídia no template + preview/teste de envio | Cliente reenvia pra uma lista salva sem reexportar CSV; consegue ver como a mensagem chega antes do disparo em massa | 1–2 semanas |
| **4 — Integração de funil** | Atribuição campanha→resposta (origem no CRM) + avaliar criação de template in-app | Resposta a uma campanha aparece como lead no `crm` com a origem correta | 1–2 semanas |

Fases 0 e 1 são o que eu começaria a implementar já — são as que reduzem risco real (jurídico
e técnico) e são baratas relativo ao impacto. Fases 3–4 só valem o investimento se houver
sinal de demanda (clientes pedindo reenvio de lista, ou reclamando de erro de template).

---

## 5. Observabilidade — o que passar a medir

Nenhuma dessas métricas existe hoje; nascem naturalmente das mudanças acima e valem a pena
independente da ordem de implementação:

- **Por campanha:** taxa de entrega (`delivered`+`read` / `sent`), taxa de falha, taxa de
  opt-out gerado.
- **Por número (tenant):** `quality_rating` ao longo do tempo (detectar degradação antes que
  vire bloqueio), % do `messaging_limit_tier` consumido no dia.
- **Da plataforma como um todo (papel de Tech Provider Meta):** nº de campanhas
  pausadas/dia por throttling, nº de números com `quality_rating = RED`.

---

## 6. Decisões que precisam do dono do produto

1. **Custo Meta:** repassar por volume ou manter absorvido no bundle Profissional/Empresas
   (é o comportamento implícito hoje)? Só vira urgente se o volume por cliente crescer.
2. **Expectativa de tier baixo:** cliente com número novo (tier inicial baixo) vai esperar
   "disparo em massa" e esbarrar num teto pequeno — vale um aviso proativo na UI mesmo antes
   da Fase 0 técnica estar pronta (pura copy, custo zero).
3. **Template in-app (Fase 4):** só investir em UI de composição/submissão se houver evidência
   de que "ir até o Business Manager" está de fato barrando conversão — validar com clientes
   reais antes de construir.

---

## 7. Auditoria de segurança do código existente (revisão 3)

Revisão linha-a-linha do único ponto de confiança externo do módulo —
`apps/api/src/routes/whatsapp-webhook.ts`, de onde vêm status de entrega e opt-out — mais os
serviços de que Campanhas depende (`lib/moduleGate.ts`, `services/encryption.ts`, upload de
CSV). Três problemas foram **corrigidos nesta revisão**; um quarto precisa de verificação
manual do operador (não dá para checar a partir daqui — ver §7.4).

### 7.1 [CORRIGIDO] Verificação de assinatura podia lançar exceção com input malicioso

`crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))` exige que os dois
buffers tenham o **mesmo tamanho** — caso contrário lança `RangeError`. Como `signature` vem
direto do header `x-hub-signature-256` (controlado por quem faz a requisição), um POST com uma
assinatura de tamanho diferente do esperado (64 hex chars) derrubava a checagem com uma
exceção não tratada em vez de simplesmente responder 401 — o handler ainda retornava erro (o
runtime do Fastify converte exceção em 500), mas de forma menos previsível e sem o log de
"assinatura inválida". **Corrigido:** função `safeEqual()` confere o tamanho antes de comparar
e retorna `false` (→ 401) em vez de lançar.

### 7.2 [CORRIGIDO] Verificação do token do GET (setup do webhook) não era em tempo constante

A validação inicial do webhook (`GET /webhook?hub.verify_token=...`, chamada pela Meta uma vez
ao configurar) comparava o token com `===` simples — uma comparação de string comum vaza
timing (quanto mais prefixo bate, mais tempo leva). Exposição baixa na prática (só relevante
no momento de configuração, e normalmente atrás de HTTPS com jitter de rede maior que a
diferença de timing), mas é o mesmo padrão de vulnerabilidade que já se tinha o cuidado de
evitar na verificação do POST — inconsistente deixar uma peneira mais fraca no GET.
**Corrigido:** mesma função `safeEqual()` usada nos dois pontos.

### 7.3 [CORRIGIDO] Segredo ausente falhava em silêncio

Se `WHATSAPP_APP_SECRET` não estiver definido, o código **pulava toda a verificação de
assinatura sem nenhum aviso** — o webhook passava a aceitar qualquer POST bem-formado como se
fosse da Meta. Como é esse mesmo webhook que grava opt-out (`CampanhaOptOut`) e atualiza status
de entrega de `CampanhaContato` por `wamid`, um payload forjado poderia, por exemplo, marcar
contatos de terceiros como opt-out ou como falhos, sem nenhuma autenticação de origem.
**Corrigido:** agora loga um `error` alto e explícito no boot do módulo quando o segredo está
ausente — não mudei o comportamento para bloquear a requisição (fail-closed), porque isso
derrubaria a recepção de mensagens/áudio/status de **todos** os usuários da API oficial em
produção caso o segredo realmente não esteja configurado lá, e não há como confirmar isso a
partir deste sandbox (ver §7.4). Preferi tornar o problema **impossível de não notar nos logs**
a arriscar uma indisponibilidade em produção sem confirmação.

### 7.4 [AÇÃO MANUAL NECESSÁRIA] Confirmar `WHATSAPP_APP_SECRET` no servidor Vultr

Este sandbox não tem acesso SSH ao servidor de produção (porta 22 bloqueada pela política de
rede do ambiente — ver `CLAUDE.md`), então **não foi possível confirmar** se
`WHATSAPP_APP_SECRET` está de fato definido no `.env` do Vultr. É a variável mais crítica do
webhook e está documentada em `.env.example`, mas — ao contrário de `ENCRYPTION_KEY` (que
derruba o boot se ausente/mal formatada, em `services/encryption.ts`) — nada força sua
presença.

**Peço que confirme:** rode `grep WHATSAPP_APP_SECRET /root/.env` (ou equivalente) no servidor.
Se **não** estiver setado: (1) pegue o App Secret no painel da Meta for Developers do app usado
pela integração oficial, (2) adicione ao `.env` do Vultr, (3) reinicie o container da API. A
partir do próximo boot o log de erro de §7.3 some sozinho — sinal de que está resolvido. Se
**já** estiver setado, não é preciso fazer nada além de confirmar (o código já está correto).

### 7.5 [VERIFICADO — SEM PROBLEMA] Pontos que pareciam suspeitos e não são

- **Corpo bruto do webhook para o HMAC:** `apps/api/src/index.ts` registra um
  `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` global que captura
  `req.rawBody` antes do parse — a assinatura é calculada sobre os bytes originais, não sobre
  um `JSON.stringify` reconstruído (que poderia divergir do original e gerar falsos negativos).
  O fallback para `JSON.stringify(req.body)` no código existe só como defesa adicional; na
  prática nunca é exercido.
- **Criptografia dos tokens Meta** (`services/encryption.ts`): AES-256-GCM com IV aleatório de
  96 bits por chamada, `authTag` verificado na decriptação, chave validada no boot (64 hex
  chars / 32 bytes) — configuração correta, nada a mudar.
- **Gate de módulo** (`lib/moduleGate.ts`): nega acesso (`402`) por padrão em qualquer falha —
  tabela ausente, Redis fora do ar, erro de query — nunca abre acesso por engano
  (fail-closed correto para uma checagem de autorização).
- **IDOR nas rotas de Campanhas:** toda rota que opera sobre uma campanha específica passa por
  `ownedCampanha(userId, id)` (filtro por dono) antes de agir; `/optouts` e `/templates`
  também são escopados por `userId`. Não encontrei um caminho para um usuário ler/alterar
  campanha de outro.
- **Upload de CSV:** limite de 15MB global do `@fastify/multipart` (`index.ts`) mais um
  segundo limite de 5MB dentro da própria rota de upload (defesa em profundidade); o parser só
  acumula a parte `fieldname === 'file'`, então partes extras do multipart não consomem
  memória além do necessário.

### 7.6 Risco pré-existente, fora do escopo de Campanhas, mas que a afeta

`whatsapp-webhook.ts` resolve o dono da mensagem por
`prisma.whatsappNumber.findFirst({ where: { phoneNumber: cleanBusiness } })` — sem filtrar por
`provider: 'meta'` e sem que `phoneNumber` tenha uma constraint `@unique` no schema. Se dois
registros de `WhatsappNumber` (de usuários diferentes, ou um resíduo de teste) acabarem com o
mesmo valor de `phoneNumber`, o webhook atribuiria a mensagem/opt-out ao registro errado — não
é uma vulnerabilidade introduzida por Campanhas, mas o opt-out e o status de entrega de
campanha dependem diretamente desse `userId` estar certo. Vale um `@@unique([phoneNumber,
provider])` (ou globalmente, se o negócio garantir que nunca há dois clientes com o mesmo
número) numa migration futura — fora do escopo desta revisão por afetar todo o app, não só
Campanhas.
