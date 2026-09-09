# ZapScript Campanhas — Arquitetura, Riscos e Roadmap

> **Achado prévio:** o módulo `campanhas` **já existe e está em produção** (`status: 'bundled'`
> no catálogo, incluso no Profissional/Empresas desde a migração `20260908_campanhas_bundled`).
> Isto não é um plano de feature nova — é um levantamento sênior do as-built, com
> especificação técnica concreta dos itens de maior risco, no formato de
> `MODULOS_ARQUITETURA.md`/`PLATAFORMA_BASE.md`.

Data: 2026-09-09 (revisão 7 — opt-in nos dois canais + tier/quality real, §9) · Branch:
`claude/laughing-ritchie-3n4vj1`

## TL;DR

- **O que é:** disparo em massa via WhatsApp — dois canais agora. `meta`: API Cloud oficial,
  template pré-aprovado, compliant (única via legal pós-fechamento de bots não autorizados,
  política Meta dez/2025). `evolution` (novo, §8, experimental): pelo número Evolution que o
  usuário já tem, mensagem livre, com guardrails (público restrito a quem já conversou, ritmo
  bem mais lento, consentimento de risco explícito) porque reabre o risco de banimento que o
  canal `meta` existe pra evitar — e nesse caso é o MESMO número que serve core/atende/copiloto.
  Fluxo completo (contatos → agendamento/disparo → status → opt-out) já funciona nos dois
  canais e é bem construído (idempotência, dedupe, isolamento por tenant).
- **Achado de produção (revisão 4):** consultei o banco real — `Campanha`, `CampanhaContato`,
  `CampanhaOptOut` e `WhatsappNumber(provider='meta')` estão todos com **0 registros**. O
  módulo está pronto e "bundled" no catálogo, mas nenhum cliente conectou um número Meta ainda.
  Isso não muda nenhuma recomendação abaixo — só o contexto: é a janela ideal para aplicar
  correções de schema sem custo de migração de dados.
- **Risco nº 1 (P0) — [PARCIALMENTE RESOLVIDO em §9]:** o `/:id/start` agora lê
  `messaging_limit_tier`/`quality_rating` de verdade na Graph API e trava (com opção de
  prosseguir mesmo assim) se a audiência excede o tier do número. O que falta do P0 original:
  auto-pausa automática se a Meta começar a rejeitar em massa **durante** o envio (§3.2) e
  rate limit por tenant/número em vez do teto global de 10 msg/s (§3.3) — nenhum dos dois foi
  feito ainda.
- **Risco nº 2 (P0) — [RESOLVIDO em §9]:** opt-in auditável agora existe nos dois canais —
  antes só existia (e só de forma implícita) no canal Evolution.
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

## 6. Decisões do dono do produto — [DECIDIDO] (revisão 5)

1. **Custo Meta → mantido absorvido no bundle Profissional/Empresas.** Sem mudança de billing
   agora; reavaliar quando o volume por cliente crescer o suficiente para pressionar a margem
   (nenhuma ação de código associada a esta decisão).
2. **Aviso de tier baixo → copy já em produção.** Adicionado em `nova/page.tsx` (revisão 5):
   aviso visível assim que o usuário conecta o número, explicando que números novos têm limite
   diário de envio que sobe com o histórico de boas entregas. Zero dependência da Fase 0
   técnica (não lê o tier real via Graph API — é só uma expectativa correta desde já).
3. **Template in-app → não construir agora.** Fica fora do roadmap até haver evidência de
   clientes reais travando em "ir até o Business Manager". Fase 4 permanece como estava.

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

### 7.6 [CORRIGIDO] Ambiguidade de dono no lookup do webhook — verificado e resolvido

**Verificação em produção (read-only, antes de decidir a solução):** consultei o banco real
(Supabase, projeto `ZapScript`) para saber se isso já era um problema real ou só teórico:

```sql
SELECT "phoneNumber", provider, count(*), array_agg(DISTINCT "userId")
FROM "WhatsappNumber" WHERE "phoneNumber" <> 'pending'
GROUP BY "phoneNumber", provider HAVING count(*) > 1;
```

Resultado: **1 duplicata**, `provider='evolution'`, e as 2 linhas são do **mesmo** `userId`
(não é colisão entre tenants). Mais revelador: `provider='meta'` tem **zero linhas no total**
hoje — ou seja, **nenhum cliente conectou um número Meta em produção ainda**, e por consequência
`Campanha`, `CampanhaContato` e `CampanhaOptOut` também estão todos com **0 registros**. O
módulo está com o código pronto e "bundled" no catálogo, mas **ainda não foi usado de verdade**
— o que muda a urgência (não havia dado real em risco), mas não a correção do problema (o bug
existiria assim que o primeiro cliente conectasse um número).

**Melhor solução escolhida (e por quê não foi a primeira ideia):** minha sugestão inicial —
`@@unique([phoneNumber, provider])` — foi descartada ao revisar com calma: `phoneNumber` tem
`@default("pending")`, ou seja, **toda** linha ainda não conectada compartilha esse valor
literal — uma constraint única "crua" quebraria qualquer usuário com mais de um número pendente
de conexão. A solução correta usa a chave que já existe e é naturalmente única — o
**`metaPhoneNumberId`**, o ID que a própria Meta atribui ao número (não uma string exibível
formatável de várias formas) — em vez de tentar forçar unicidade sobre `phoneNumber`.

**Aplicado nesta revisão:**
1. `schema.prisma`: `metaPhoneNumberId` agora é `@unique` (seguro com múltiplos `NULL` — Postgres
   não trata `NULL = NULL`, então as linhas `evolution`, sempre `NULL` nesse campo, não são
   afetadas).
2. Migration `20260909_whatsappnumber_meta_unique`: índice único parcial (`WHERE provider =
   'meta' AND "phoneNumber" <> 'pending'`) sobre `phoneNumber` — não representável no DSL do
   Prisma, por isso vive só na migration. Confirmado limpo contra os dados atuais (zero linhas
   `meta`), entra sem necessidade de cleanup.
3. `whatsapp-webhook.ts`: o lookup do dono da mensagem agora prioriza `metaPhoneNumberId` (do
   campo `value.metadata.phone_number_id` que a Meta já manda no payload e que o código
   simplesmente não usava) em vez de `phoneNumber`; fallback por `phoneNumber` só para linhas
   legadas sem o ID preenchido, agora filtrado por `provider: 'meta'` e desempatado por
   conexão mais recente. Como consequência, também corrige a mesma ambiguidade para
   transcrição de áudio e demais tipos de mensagem — não só para opt-out de campanha, já que
   é a mesma resolução de dono usada pelos três. De brinde, a consulta que antes rodava uma
   vez **por mensagem** do lote passou a rodar uma vez por webhook (lote geralmente tem 1
   mensagem, mas era uma query redundante em lotes maiores).

**Validado:** `tsc --noEmit` limpo, suíte `campanhas.test.ts` (34/34) passando após a mudança.

**Pendente de você:** a migration está no repo, mas só entra em produção no próximo deploy
manual da API (`ops.yml`, `action=deploy`, per `CLAUDE.md`) — `prisma migrate deploy` aplica
sozinho no boot. Não disparei o deploy; avise quando quiser que eu dispare.

---

## 8. Canal Evolution (experimental) — disparo pelo número atual do usuário

### 8.1 Por que isso existe

O canal `meta` cobre 0% dos usuários reais hoje — o comentário no próprio schema já dizia
isso (`WhatsappNumber.provider`: *"Usado apenas para o fluxo de App Review da Meta. Usuários
reais seguem no Evolution."*), confirmado na auditoria de produção (§7.6): zero números
`provider='meta'` conectados. Restringir Campanhas ao Meta deixava o módulo essencialmente
inacessível pra base real. O canal `evolution` usa o número Evolution que o usuário **já tem**
(o mesmo do `core`), sem exigir WABA oficial nem template aprovado.

### 8.2 O trade-off que isso reabre — e os guardrails

Enviar em massa por um cliente WhatsApp não-oficial é o padrão de uso que a política da Meta
de dez/2025 passou a coibir (é a própria razão de existir do canal `meta` — ver §1). A
diferença de blast radius importa: um número **Meta** banido custa a campanha; um número
**Evolution** banido custa `core`+`atende`+`copiloto` do cliente inteiro, porque é o mesmo
número. Por isso o canal só foi construído com estes guardrails, todos **server-side** (não
dependem de a UI se comportar):

1. **Público restrito a quem já conversou** — `POST /:id/contatos/from-conversas` é o único
   jeito de popular contatos de uma campanha `evolution` (`POST /:id/contatos`, o upload de
   CSV, responde 400 pra esse canal). A audiência vem da união de `Transcription`,
   `AtendeConversation` e `CopilotoConversation` daquele número (`warmContactsForNumber` em
   `routes/modules/campanhas.ts`) — nunca uma lista fria.
2. **Ritmo de envio lento e "humano"** — `evolutionSendDelayMs` (duplicada de propósito em
   `apps/api/.../campanhas.ts` e `apps/worker/campanhas-scheduler.ts`, api/worker não
   compartilham código neste monorepo) espaça os jobs por ~24h / `CAMPANHAS_EVOLUTION_DAILY_LIMIT`
   (default 40/dia) com jitter de ±30%, calculado no enqueue — sem contador vivo em Redis. Bem
   abaixo do teto de segurança global do Meta (10 msg/s) que continua valendo como cinto extra.
3. **Consentimento/risco explícito** — `Campanha.consentConfirmedAt`/`consentConfirmedIp`,
   exigido (`acknowledgeRisk: true` no body) na primeira chamada de `/schedule` ou `/start` pra
   uma campanha `evolution`; UI mostra o aviso de banimento antes de deixar marcar.
4. **Sem CSV, sem variáveis posicionais** — mensagem livre (`Campanha.messageBody`) com um único
   placeholder (`{{nome}}`, resolvido a partir do `CampanhaContato.name` já capturado nas
   conversas existentes) — não há colunas de CSV nesse canal pra ter variável numerada.

### 8.3 O que NÃO foi feito de propósito (v1)

- **Sem contador de limite diário vivo em Redis** — o espaçamento já calculado no enqueue
  mantém o ritmo dentro do limite; um contador vivo seria mais preciso mas também mais
  infraestrutura pra uma primeira versão deliberadamente conservadora.
- **Sem status de entrega/leitura** — o canal Evolution não tem o mesmo webhook de status da
  Meta; `CampanhaContato` só vai a `sent` (ou `failed`), nunca `delivered`/`read`, pra
  campanhas `evolution`. Documentado, não é bug.
- **Sem número mínimo de histórico pra elegibilidade** — `warmContactsForNumber` considera
  "já conversou" qualquer contato com pelo menos 1 mensagem registrada, mesmo antiga. Um corte
  por recência (ex.: só quem falou nos últimos N meses) é um ajuste futuro razoável, não feito
  agora por falta de sinal do que faz sentido pro produto.

### 8.4 Decisão que precisa do dono do produto

**`CAMPANHAS_EVOLUTION_DAILY_LIMIT=40`** é um chute conservador, não um número validado pela
Meta ou por dado de churn/banimento real (não existe fonte oficial pra isso em clientes
não-oficiais). Vale tratar como uma env var ajustável e observar na prática — se números começarem
a cair de `quality`/ser banidos com esse ritmo, baixar; se ninguém reclamar depois de uso real,
pode subir com cautela.

---

## 9. Execução do plano "1, 2, 3": teste real, opt-in nos dois canais, tier real

Sequência pedida depois da pergunta "o MVP está pronto?": (1) subir o que já estava pronto e
testar ponta a ponta, (2) opt-in auditável também no Meta, (3) tier/quality rating de verdade
(não só aviso de copy) antes de disparar. `2` e `3` foram implementados nesta revisão; `1` (o
teste ponta a ponta com número real) segue **pendente de você** — ver §9.4.

### 9.1 Deploy do que já existia

Merge (fast-forward) + `ops.yml action=deploy` do canal Evolution completo (revisão 6) e do
aviso de tier em copy — run [#68](https://github.com/foxtecnologiaonline/zapscript/actions/runs/34300425671),
`conclusion: success`. Essas duas entregas já estão em produção.

### 9.2 Opt-in generalizado (era só Evolution)

`requireRiskAcknowledgement` virou `requireConsentAcknowledgement`, aplicado nos **dois**
canais — antes só existia pro canal Evolution (risco de banimento); o canal Meta não tinha
nenhuma checagem de consentimento, só o opt-out reativo (§3.1). Campo do body unificado pra
`confirmConsent` (era `acknowledgeRisk`, exclusivo do Evolution) — texto do aviso muda por
canal (consentimento de marketing/LGPD no Meta; risco de banimento no Evolution), mas é o
mesmo campo `Campanha.consentConfirmedAt`/`consentConfirmedIp` para os dois. Gate roda no 1º
`/schedule` ou `/start` de cada campanha; não pede de novo depois de confirmado.

### 9.3 Tier/quality rating real (não só aviso estático)

Implementado exatamente como especificado em §5.1, com um ajuste: em vez de bloquear
incondicionalmente acima do tier, `/:id/start` **avisa com os números reais** e exige
confirmação explícita (`confirmExceedsTier: true`) pra prosseguir — abortar silenciosamente
uma campanha legítima de envio em lotes ao longo de vários dias seria pior que avisar.

- **Schema:** `WhatsappNumber.metaMessagingLimitTier` / `metaQualityRating` /
  `metaLimitsSyncedAt` (migration `20260909_whatsappnumber_meta_limits`).
- **Graph API:** `getPhoneNumberLimits()` em `services/whatsapp-campaigns.ts` —
  `GET /{phone-number-id}?fields=quality_rating,messaging_limit_tier`. `tierToNumericCap()`
  interpreta o tier por regex (`TIER_250` → 250, `TIER_10K` → 10.000,
  `TIER_UNLIMITED` → `Infinity`) em vez de um switch fixo — sobrevive a variações de nome que a
  Meta já fez antes, sem precisar de update de código.
- **Cache de 1h** (`ensureFreshMetaLimits`) — evita bater na Graph API a cada `/start`;
  **fail-open** se a Meta estiver indisponível (usa o último valor conhecido, ou nenhum, em vez
  de bloquear o disparo por instabilidade externa — mesma filosofia de `moduleGate.ts`).
  Refresh acontece em `/:id/start`; **não** em `/:id/schedule` nem no disparo automático do
  scheduler (`campanhas-scheduler.ts`) — uma campanha agendada para dali a dias pode disparar
  contra um tier desatualizado. Consciente, não corrigido agora (escopo do pedido era
  "antes de disparar", que é o `/start`; o scheduler fica como lacuna conhecida, próximo P1
  natural junto com §3.2/auto-pausa).
- **UI:** `GET /:id` agora devolve tier/quality do número (mostrado como info na tela da
  campanha); ao tentar iniciar acima do tier, a tela mostra os números reais e um botão
  "Prosseguir mesmo assim" que reenvia com `confirmExceedsTier: true`.
- **Testes novos:** busca+persiste+bloqueia, prossegue com confirmação, usa cache dentro de 1h
  sem nova chamada à Graph API, fail-open se a Graph API cair, e parsing de tier isolado — 10
  testes novos, 53/53 passando no arquivo.

### 9.4 O que ainda falta de você (não dá pra automatizar)

O teste ponta a ponta real (item 1 do plano) não pôde ser feito por mim: exige conectar um
número de verdade (Meta: WABA + template aprovado via Embedded Signup; Evolution: escanear QR
com um celular) e mandar uma mensagem real a um contato real — nenhuma das duas coisas é algo
que este sandbox consegue fazer. Verificado no banco antes desta revisão: **zero** números
Meta conectados em produção, então o canal Meta nunca rodou contra a Graph API de verdade —
inclusive o novo gate de tier/quality desta revisão só foi validado com mocks. Recomendo, antes
de anunciar o módulo pra qualquer cliente: conectar um número (Meta ou Evolution) e rodar uma
campanha pequena (poucos contatos) ponta a ponta, olhando o resultado real na tela da campanha.

---

## 10. Página nativa em /dashboard (exceção deliberada ao padrão /app/&lt;key&gt;)

**Problema encontrado:** o item "Campanhas" já existia no menu lateral do `/dashboard` (sessão
anterior), mas apontava pra `/app/campanhas` — árvore de rotas sem layout próprio
(`apps/web/src/app/app/layout.tsx` não existe). Resultado real: clicar em "Campanhas" tirava o
usuário do shell com sidebar e caía numa página solta, diferente de clicar em "Números" ou
"Plano". Isso afeta **todos** os módulos hoje (`moduleRoute()` manda todo módulo não-`core` pra
`/app/<key>`, nenhum tem sidebar) — `MODULOS_ARQUITETURA.md` já previa um shell com nav lateral
pra essa área, mas nunca foi construído.

**Decisão (pedida explicitamente):** em vez de construir o shell pra todo `/app/*` (conserto
sistêmico, discutido e não escolhido), Campanhas virou a **única exceção** — página nativa em
`/dashboard/campanhas`, com a sidebar do dashboard. Os demais módulos (atende, crm, tarefas,
copiloto, vendas, legenda, cobranca) continuam em `/app/<key>`, sem sidebar, por ora.

**O que foi feito:**
- `git mv` de `apps/web/src/app/app/campanhas` → `apps/web/src/app/dashboard/campanhas`
  (lista, `nova`, `[id]`, `optouts`, `_components/ConnectionCard`), preservando histórico.
- Todos os links/redirects internos trocados de `/app/campanhas/*` → `/dashboard/campanhas/*`.
- Wrapper de cada página trocado de `<main>` pra `<div>` — agora aninhadas dentro do `<main>`
  que `DashboardLayout` já renderiza; dois `<main>` por página seria HTML/a11y inválido.
- `dashboard/layout.tsx`: item do menu atualizado pra `/dashboard/campanhas`; o cálculo de
  "ativo" no nav passou de igualdade exata pra prefixo (`pathname.startsWith(href + '/')`) —
  Campanhas é a 1ª seção do dashboard com sub-rotas (`/nova`, `/[id]`, `/optouts`), sem isso o
  item apagava ao entrar numa campanha específica.
- `lib/modules.ts`: `moduleRoute('campanhas')` também aponta pra `/dashboard/campanhas` —
  mantém o card "Abrir" do launcher `/app` consistente com o menu do dashboard.
- `/app/campanhas` antigo foi **removido**, não redirecionado — seguro porque o módulo nunca
  teve uso real em produção (0 campanhas, confirmado em §1/§7.6 desta revisão).

**Não corrigido, sinalizado pra você decidir depois:** as 4 páginas mantêm o estilo escuro fixo
que já tinham (`bg-neutral-950` etc., Tailwind hardcoded) — igual a todo o resto do produto
(`/app/*`, páginas públicas), mas **diferente** do resto do `/dashboard`, que usa classes
semânticas (`dashboard-bg`, `brand-primary`...) e responde ao tema claro/escuro do usuário
(`.dark` via `prefers-color-scheme`, ver `ThemeProvider.tsx`). Um usuário em modo claro veria um
bloco escuro dentro do dashboard claro ao abrir Campanhas. Não ajustei porque é trabalho de
design à parte (reescrever classes nas 4 páginas) e não fazia parte do pedido — mas é uma
inconsistência visual real caso o modo claro seja usado na prática.

---

## 11. Dez melhorias de eficiência/eficácia (revisão única)

Pedido: gerar e executar 10 sugestões de melhoria pro que já estava construído (§1-10). As 10
foram implementadas juntas, numa migration única (§11.0) — ainda **zero campanhas em produção**
neste momento (reconfirmado antes desta revisão), então não há dado real a migrar/quebrar.

### 11.0 Schema (migration `20260909_campanhas_10_melhorias`)

Puramente aditivo:

| Campo | Modelo | Uso |
|---|---|---|
| `templateVarCount` | `Campanha` | nº de `{{n}}` do template selecionado — item 6 |
| `poolNumberIds` (`String[]`, default `[]`) | `Campanha` | números extras (mesmo canal) — item 2 |
| `consecutiveFailures` (default `0`) | `Campanha` | circuit breaker — item 1 |
| `pausedReason` | `Campanha` | motivo da pausa **automática** (null = foi o usuário) |
| `processedCount` (default `0`) | `Campanha` | sent+failed+optout — item 9 |
| `assignedNumberId` | `CampanhaContato` | qual número do pool enviou este contato — item 2 |

### 11.1 Item 1 — Circuit breaker (auto-pausa por falhas consecutivas)

Um número que começa a falhar sistematicamente (token revogado, número banido pelo WhatsApp,
Evolution caiu) antes não tinha proteção: a campanha continuava tentando enviar pro resto da
lista inteira, uma falha atrás da outra, sem que ninguém percebesse até checar manualmente.

`Campanha.consecutiveFailures` incrementa a cada falha (número desconectado, envio exaurido
pelo BullMQ) e **zera a cada sucesso** — só falhas *seguidas* importam. Ao bater
`CAMPANHAS_CIRCUIT_BREAKER_THRESHOLD` (env, default `5`), a campanha vira `paused` sozinha, com
`pausedReason` explicando o motivo (mostrado na tela — ver §11.10), e dispara e-mail (item 10).
Channel-agnostic de propósito: não tenta interpretar códigos de erro específicos da Meta (que
mudam) — falha é falha, nos dois canais.

Implementado em `bumpProcessedAndMaybeComplete()` (`apps/worker/src/modules/campanhas.ts`),
função central chamada após **todo** contato processado (sucesso ou falha definitiva) — ver
§11.9, é o mesmo ponto que cuida do item 9.

### 11.2 Item 2 — Pool de números (round-robin)

Uma campanha grande batendo só num número concentra todo o risco (tier, quality rating, e no
Evolution o próprio risco de ban) numa única linha. Agora dá pra somar números extras do
**mesmo canal** à campanha:

- `GET /:id/pool-candidates` lista números do usuário do mesmo canal, exceto o primário.
- `POST /:id/pool` valida (dono + mesmo `provider`) e salva `poolNumberIds` (máx. 10) —
  só permitido fora de uma campanha em execução.
- `POST /:id/start` (e o disparo automático agendado, `campanhas-scheduler.ts`) monta a
  "rotação de envio" = número primário + números do pool que estiverem `connected` **agora**
  (um número do pool que caiu simplesmente sai da rotação daquela vez, não trava a campanha) e
  distribui os contatos pendentes em round-robin puro por índice
  (`sendNumbers[i % sendNumbers.length]`), gravando `CampanhaContato.assignedNumberId` em lote
  (1 `updateMany` por número, não 1 por contato). Canal meta: o teto de tier/quality (§9.3)
  passa a somar o cap de **todos** os números da rotação, não só do primário.
- O worker (`processCampanhaJob`) resolve o número de envio por `assignedNumberId` quando
  setado e diferente do primário; no caso comum (sem pool) não faz query nem write extra.
- Canal Evolution com pool: o ritmo de envio (item 3) usa o número **mais novo** da rotação
  como referência — o mais conservador, não o mais permissivo.

### 11.3 Item 3 — Aquecimento progressivo (Evolution)

Um número Evolution recém-conectado disparando no limite diário cheio desde o dia 1 é
exatamente o padrão que mais aciona detecção de spam num número sem histórico de uso "normal"
ainda. `effectiveEvolutionDailyLimit(connectedAt)` faz uma rampa linear a partir de
`WhatsappNumber.connectedAt`: começa em 15% do limite configurado (`CAMPANHAS_EVOLUTION_*`) e
chega a 100% depois de `CAMPANHAS_EVOLUTION_WARMUP_DAYS` (default 10) dias conectado. Sem
`connectedAt` (não deveria acontecer com `status='connected'`, mas defensivo) usa o limite
cheio — fail-open. Entra em `evolutionSendDelayMs(index, dailyLimit)` no lugar do limite
constante, tanto em `/:id/start` quanto no scheduler.

### 11.4 Item 4 — Janela de envio (não manda de madrugada)

`applySendWindow(delayMs, now)` empurra o horário-alvo de cada mensagem pra dentro de
`CAMPANHAS_SEND_WINDOW_START_HOUR`–`END_HOUR` (default 8h–21h, horário de Brasília fixo UTC-3 —
não há mais horário de verão no Brasil desde 2019). Aplica-se **por contato**, não ao lote
inteiro — importante numa campanha Evolution de vários dias, onde índices diferentes caem em
madrugadas diferentes. Aplica-se aos **dois canais**: mesmo o Meta (template pré-aprovado,
"compliant") não deveria acordar o destinatário às 3h — é sobre a experiência de quem recebe,
não só sobre risco de banimento do canal Evolution.

### 11.5 Item 5 — Envio de teste

`POST /:id/test-send` manda a mensagem real (mesmo `sendTemplateMessage`/`sendText` que o
worker usa) pra um telefone informado no corpo, **sem** criar `CampanhaContato` nem tocar
`audienceCount`/`sentCount`/`processedCount` — é só uma prévia. Canal Evolution: texto prefixado
com `[TESTE]`, `{{nome}}` renderizado com o nome informado (ou "Teste"). Canal Meta: variáveis
de amostra (`Teste1`, `Teste2`...) se não informadas no corpo, no número certo de posições
(`templateVarCount`).

### 11.6 Item 6 — Validação de variáveis do template

Antes, um CSV com número errado de colunas de variável só falhava **na hora do envio real**
(rejeição da Meta por parâmetro faltando/sobrando), silenciosamente por contato. Agora
`Campanha.templateVarCount` (setado na criação, calculado no front a partir do template
escolhido) é conferido linha a linha no upload de CSV — mismatch vira `skippedVarMismatch` no
retorno, contato nem é criado. Campanhas antigas sem `templateVarCount` (null) mantêm o
comportamento anterior — sem essa checagem.

### 11.7 Item 7 — Performance por template

`GET /performance` agrega, entre todas as campanhas Meta do usuário, contagens por
`templateName` (campanhas, audiência, sent/delivered/read/failed/optout — mesma fonte de
`CampanhaContato.status` que `GET /:id` já usa) e calcula `successRate`/`failureRate`/
`optoutRate` sobre a audiência total. Ajuda a responder "qual template eu devia parar de usar"
sem abrir campanha por campanha. Página nova `/dashboard/campanhas/performance`, linkada da
lista.

### 11.8 Item 8 — Corte de recência na audiência "quente" (Evolution)

O guardrail do canal Evolution (§8) já exigia "conversou alguma vez" — mas um contato que falou
uma vez há 2 anos não é mais "quente" de verdade; mandar campanha pra ele carrega o mesmo risco
de "mensagem não solicitada" que mandar pra um desconhecido. `warmContactsForNumber()` agora só
considera transcrição/Atende/Copiloto dentro de `CAMPANHAS_WARM_AUDIENCE_DAYS` (default 180
dias) — generoso de propósito, corta só o extremo.

### 11.9 Item 9 — `processedCount` no lugar de `COUNT(*)` a cada envio

Antes, cada job processado disparava um `COUNT(*)` em `CampanhaContato` só pra saber se a
campanha tinha terminado — desperdício crescente conforme a lista cresce (uma campanha de 50k
contatos faz 50k `COUNT(*)` num período curto). Agora `Campanha.processedCount` é incrementado
uma vez por contato processado (sucesso ou falha) e comparado com `audienceCount`, já em mãos —
zero query extra. Centralizado em `bumpProcessedAndMaybeComplete()` (worker), que também cuida
do circuit breaker (item 1) e da notificação de conclusão (item 10).

**Bug real encontrado e corrigido nesta revisão:** opt-out via webhook (`registerCampanhaOptOut`,
usado pelos dois webhooks de entrada) nunca passava pelo worker — um contato que sai por opt-out
nunca teria sua "vez" de incrementar `processedCount`. Resultado: uma campanha com opt-outs
suficientes pra esgotar os pendentes **nunca bateria `audienceCount`** e ficaria `running` pra
sempre, mesmo sem nenhum contato pendente de verdade. Corrigido: `registerCampanhaOptOut` agora
busca os `CampanhaContato` pendentes afetados, agrupa por campanha, incrementa `processedCount`
por campanha (não mexe em `consecutiveFailures` — opt-out é ação do destinatário, não falha de
envio) e completa a campanha se `status='running'` e `processedCount >= audienceCount` — mesmo
guard atômico (`updateMany` filtrado por status) que o worker usa.

### 11.10 Item 10 — Notificação por e-mail (conclusão / auto-pausa)

`notifyCampanhaCompleted()` e `notifyCampanhaAutoPaused()` (worker, via `sendEmail` do Resend,
mesmo estilo dark-card já usado em outros e-mails do produto) disparam fire-and-forget (nunca
bloqueiam nem derrubam o processamento do job) quando a campanha completa ou é auto-pausada pelo
circuit breaker. `registerCampanhaOptOut` (API) tem sua própria cópia compacta do e-mail de
conclusão pro caminho raro de completar via opt-out em massa (ver §11.9) — duplicada de
propósito, api e worker não compartilham código neste monorepo. `pausedReason` também aparece
direto na tela da campanha (`/dashboard/campanhas/[id]`), não só no e-mail.

### 11.11 Duplicação entre api/worker (mantida deliberadamente)

`evolutionSendDelayMs`, `effectiveEvolutionDailyLimit` e `applySendWindow` existem **duas
vezes** — em `apps/api/src/routes/modules/campanhas.ts` (usado por `/:id/start`) e em
`apps/worker/src/campanhas-scheduler.ts` (usado pelo disparo automático agendado). Mesma
filosofia já estabelecida no resto do módulo (§8): api e worker não compartilham código neste
monorepo, e a alternativa (extrair um pacote compartilhado só pra ~40 linhas de função pura)
seria mais infraestrutura do que o problema justifica.

### 11.12 Testes e cobertura

79 testes em `apps/api/src/__tests__/campanhas.test.ts` (era 53) e 16 em
`apps/worker/src/__tests__/campanhas.test.ts` (era 14), todos passando, mais typecheck limpo
nos três apps (`api`/`worker`/`web`). Cobertura nova inclui: circuit breaker (falha acumula e
dispara pausa+e-mail), pool round-robin (distribui certo, ignora número caído sem travar),
`applySendWindow`/`effectiveEvolutionDailyLimit` isolados e determinísticos (datas fixas, sem
depender do horário real de execução do teste), `registerCampanhaOptOut` isolado (incrementa
por campanha, não mexe em `consecutiveFailures`, só completa campanha `running`), validação de
variáveis do CSV, `/performance`, `/test-send` e o corte de recência de `/from-conversas`.

**Achado durante a implementação, não um defeito do produto:** um teste de integração inicial
comparava o delay de dois jobs consecutivos (`jobs[1].delay > jobs[0].delay`) — quebrou de forma
intermitente perto da virada de hora, porque `applySendWindow` arredonda pro início da janela
(8h) e um job com delay bruto maior pode, depois desse arredondamento, cair numa hora-alvo
*menor* que o anterior (ex.: job 0 alvo 00:59 → empurra 8h; job 1 alvo 01:02, já na hora
seguinte → empurra só 7h). O total pode inverter a ordem sem que nada esteja errado — é a janela
funcionando. Teste corrigido para verificar corretude via `applySendWindow` isolado com horários
fixos, e a asserção de integração passou a checar só forma (`jobId` certo, delay não-negativo),
não ordem relativa.

### 11.13 O que ficou de fora desta revisão (conhecido, não escolhido)

- ~~**UI do pool**: só o essencial (checklist + salvar) — sem indicar, por número, quantos
  contatos já foram atribuídos a ele numa campanha em andamento.~~ Fechado — ver §14.1.

Os outros dois itens desta lista (tier no agendamento, e o tema claro/escuro de todo o módulo)
foram fechados na revisão seguinte — ver §12.

---

## 14. Itens da lista "o que falta" (WhatsApp) executados nesta revisão

### 14.1 UI do pool — quebra de envio por número

`GET /:id` agora devolve `statsByNumber` (contagem por status, agrupada por
`CampanhaContato.assignedNumberId`) e `poolNumbers` (nome/telefone dos números do pool) quando
a campanha tem `poolNumberIds` — só paga a query extra nesse caso, não no caminho comum sem
pool. Contato com `assignedNumberId` nulo (criado antes do pool existir) cai no número
primário; a soma por status usa acumulador (`+= count`), não atribuição direta, porque o mesmo
número primário pode aparecer em duas linhas do `groupBy` (uma com `assignedNumberId` explícito,
outra nula) — bug real pego pelo teste antes de chegar em produção. Tela: novo card "Envio por
número (pool)" na página da campanha, mostrando total processado + falhas por número.

### 14.2 Os demais itens da lista não foram executados — decisão pendente do usuário

Segmentação de audiência, sequência/drip, A/B test de template e limite de uso por plano têm
decisão de produto real embutida (quais filtros importam, se a sequência espera resposta ou é
por tempo fixo, o que define "vencedor" do A/B, e — no caso do limite — números de verdade de
plano/preço). Perguntado ao usuário antes de construir, pra não arriscar retrabalho grande
numa direção errada.

---

## 12. Fechamento dos gaps conhecidos (§11.13) + tema claro/escuro

### 12.1 Tema claro/escuro nas páginas de Campanhas

As 6 páginas (`page.tsx`, `nova/`, `[id]/`, `optouts/`, `performance/`, `_components/ConnectionCard.tsx`)
foram convertidas do dark-mode fixo (`bg-neutral-950`, `text-neutral-100` etc., Tailwind hardcoded)
pro sistema de tokens semânticos que o resto do `/dashboard` já usa (`globals.css` +
`tailwind.config.js`: `brand-{bg,surface,elevated,primary,text,muted,border}`, classes
`.card`/`.btn-primary`/`.btn-ghost`/`.input`/`.inner-block`), seguindo exatamente o padrão já
em produção em `/dashboard/numeros`. Cores de status (falhou/opt-out/entregue/etc.) mantidas com
a paleta nomeada do Tailwind (não os tokens de marca) mas em tons -500/-600 com fundo/borda em
baixa opacidade (`bg-amber-400/10 border-amber-400/20 text-amber-600`), o mesmo truque que
`numeros/page.tsx` já usa pra funcionar em ambos os temas sem precisar de `dark:` variant.

Verificado visualmente (não dá pra logar como usuário real no sandbox — API de produção,
sem credencial de teste): harness estático isolado com o `globals.css`/`tailwind.config.js`
reais, screenshot em claro e escuro dos padrões usados (cards, badges de status, botões,
banners, tabela) — contraste e legibilidade OK nos dois temas. Typecheck limpo.

**Achado de quebra ao converter**: `nova/page.tsx` calculava `varCount` (nº de `{{n}}` do
template) mas nunca mandava `templateVarCount` no `POST /` de criação — ou seja, a validação de
variáveis do CSV (item 6, §11.6) nunca teria disparado de verdade pra nenhuma campanha criada
pela tela, só nos testes (que setam o campo manualmente no mock). Corrigido junto.

### 12.2 Tier/quality no momento de agendar (fecha a lacuna do §9.3/§11.13)

Extraídos `resolveSendNumbers()` e `checkCombinedTierCap()` (antes só inline em `/:id/start`) e
reaplicados em `/:id/schedule`: agendar uma campanha que já excede o teto de tier combinado
(primário + pool prontos) agora avisa com os números reais e exige `confirmExceedsTier: true`
pra prosseguir — mesma UX de `/:id/start`, só que na hora de agendar em vez de só na hora de
iniciar. Front (`[id]/page.tsx`) reaproveita o mesmo estado `tierExceeded` pros erros de
`/schedule` também.

**O disparo automático em si (`campanhas-scheduler.ts`, quando `scheduledAt` chega) continua
fail-open** — não bloqueia, porque não há usuário interativo às 3h da manhã pra confirmar
`confirmExceedsTier`. O que mudou: agora ele *checa* o tier em cache (sem bater na Graph API de
novo — só lê `WhatsappNumber.metaMessagingLimitTier`, já sincronizado por qualquer chamada
anterior a `/schedule`/`/start`) e, se a audiência pendente excede o teto conhecido, dispara
mesmo assim mas manda um e-mail avisando (`notifyCampanhaExceedsTierAtFire`, mesmo estilo dos
e-mails do item 10). Isso cobre o caso real que motivava o gap: o tier pode ter mudado (ou a
campanha pode ter crescido) entre o agendamento e o disparo de fato, dias depois.

### 12.3 Recência via `Transcription.createdAt` (item 8) — não era gap de verdade

Reavaliado: para `Transcription` com `source='whatsapp'`, o registro é criado pelo pipeline
essencialmente em tempo real na chegada do áudio — `createdAt` **é** a data da última
interação, não um proxy aproximado. A ressalva no §11.13 era excesso de cautela, não um defeito
real; nenhuma mudança de código foi necessária aqui.

### 12.4 Testes

81 testes em `apps/api/src/__tests__/campanhas.test.ts` (era 79) — cobrindo o novo gate de
`/:id/schedule` (bloqueia acima do tier, prossegue com `confirmExceedsTier`) — e 16 no worker
(inalterado; `campanhas-scheduler.ts` continua sem suite própria, uma lacuna pré-existente à
parte — o módulo tem efeito colateral de topo de arquivo (`setInterval` na importação) que
dificulta testá-lo sem um refactor maior, fora do escopo deste fechamento). Typecheck limpo nos
três apps.

---

## 13. Arquitetura multicanal (planejamento — nada implementado ainda)

Pedido: planejar Campanhas multicanal — WhatsApp, E-mail, SMS, Bluetooth, WiFi, Telegram,
Instagram, Facebook. Esta seção é só arquitetura/plano; nenhum código foi escrito ainda.

### 13.0 Achado que muda o escopo: Bluetooth e WiFi não são canais de mensageria

Os outros 6 (WhatsApp, E-mail, SMS, Telegram, Instagram, Facebook) são **canais remotos** — um
servidor manda uma mensagem através de uma API pra um destinatário identificado por telefone/
e-mail/@handle, esteja ele onde estiver. Bluetooth e WiFi são **rádio de curto alcance**: não
existe "mandar uma mensagem Bluetooth" de um servidor na nuvem (Vultr) pra um contato — o rádio
só alcança quem está fisicamente perto (metros) de um *hardware* de rádio. Pra "campanha
Bluetooth/WiFi" funcionar de verdade, precisaria de:

- **Hardware físico no local do cliente** (beacon BLE, ou o próprio roteador WiFi como portal
  cativo) — o ZapScript no máximo configuraria remotamente o que esse hardware transmite; nunca
  seria o remetente direto.
- **Um público completamente diferente**: não é "meus N contatos com opt-in", é "qualquer
  pessoa anônima que passar perto com Bluetooth/WiFi ligado" — não existe `CampanhaContato`,
  não existe opt-in prévio (o "opt-in" é literalmente a pessoa escanear o beacon ou conectar na
  rede). Nenhuma peça da arquitetura de Campanhas (fila, circuit breaker, pool de números,
  processedCount, opt-out) se aplica.
- **Um produto diferente**: isso é *marketing de proximidade* (comum em varejo físico, eventos,
  restaurantes) — categoria de produto própria, não uma opção a mais no seletor de canal de uma
  campanha que já existe.

**Recomendação**: não incluir Bluetooth/WiFi neste plano. Se o objetivo é atingir cliente que
está fisicamente na loja, o caminho natural já existe no produto — WhatsApp (via QR code na
mesa/vitrine) ou e-mail continuam sendo o canal de fato, só a *captura* do contato é que
aconteceria fisicamente. Se a intenção é mesmo *proximidade de verdade* (beacon/portal WiFi),
isso merece uma conversa própria — qual problema de negócio resolve, e só depois arquitetura.
Sigo com os 6 canais restantes abaixo; me avise se eu entendi errado a intenção de
Bluetooth/WiFi.

### 13.1 O problema com o desenho atual (2 canais → se manter, quebra em 6)

Hoje `Campanha.channel` é `'meta' | 'evolution'`, e as rotas/worker resolvem a diferença com
`if (channel === 'evolution') {...} else {...}` espalhado (ver `numberReadyToSend`,
`processCampanhaJob`, etc.). Funciona com 2 ramos; com 6 vira um emaranhado de ifs e cada canal
novo arrisca quebrar os outros (como quase aconteceu no §7 desta sessão, quando `undefined`
era tratado como Evolution em vez de Meta). **Antes de somar canais, o núcleo precisa parar de
ser "if/else por canal" e virar um registro de adaptadores.**

### 13.2 Abstração central: `ChannelAdapter`

```ts
interface ChannelAdapter {
  channel: string; // 'whatsapp_meta' | 'whatsapp_evolution' | 'email' | 'sms' | 'telegram' | 'instagram' | 'facebook'
  isReady(account: ChannelAccount): boolean;
  dailyLimit(account: ChannelAccount): number;          // pra evolutionSendDelayMs generalizado
  warmupDays(account: ChannelAccount): number;            // pra effectiveEvolutionDailyLimit generalizado
  render(content: MessageContent, contato: CampanhaContato): RenderedMessage;
  send(account: ChannelAccount, to: string, msg: RenderedMessage): Promise<{ externalId: string }>;
}
```

`processCampanhaJob` (worker) deixa de ter um branch por canal e passa a fazer só
`const adapter = CHANNEL_ADAPTERS[campanha.channel]; await adapter.send(...)`. Circuit breaker
(item 1), `processedCount` (item 9), pool/round-robin (item 2), janela de envio (item 4) e
e-mail de conclusão/pausa (item 10) — tudo isso já foi construído §11 pra ser **agnóstico de
canal** (nenhum deles olha pra `channel` além do se-é-evolution pontual que também migra pro
adapter). Isso é o maior ativo pra essa expansão: a "máquina" de disparo não precisa ser
reescrita, só parametrizada por adapter.

`WhatsappNumber` continua exatamente como está (usado por core/Atende/Copiloto/CRM além de
Campanhas — migrar isso teria um raio de impacto enorme e desproporcional). Os canais novos
ganham uma tabela própria:

```prisma
model ChannelAccount {
  id             String    @id @default(cuid())
  userId         String
  channel        String    // 'email' | 'sms' | 'telegram' | 'instagram' | 'facebook'
  status         String    @default("disconnected")
  displayName    String?
  credentialsEnc String?   // AES-256-GCM — token/API key, formato depende do canal
  externalId     String?   // bot id, Page id, IG business account id...
  connectedAt    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  campanhas      Campanha[]
  @@index([userId, channel])
}
```

`Campanha` ganha `channelAccountId String?` ao lado do `whatsappNumberId` já existente —
exatamente um dos dois é preenchido, dependendo se `channel` é WhatsApp ou um dos novos
(checado na aplicação, não no schema — Postgres não tem "XOR de FK" nativo sem trigger, e não
vale a complexidade aqui).

### 13.3 Conteúdo: não force um "template" universal

`templateName`/`templateComponents` são conceito específico do Meta WhatsApp (template
pré-aprovado). `messageBody` (texto livre + `{{nome}}`, já construído pro Evolution) serve bem
como conteúdo geral pra E-mail/SMS/Telegram/Instagram/Facebook. E-mail precisa só de mais um
campo, `emailSubject`. Nenhum outro canal precisa de aprovação prévia de conteúdo como o Meta
WhatsApp exige — então o modelo de dados já cobre os 5 canais novos sem mudança estrutural,
só content por canal na hora de renderizar (HTML pro e-mail, texto puro truncado pro SMS,
Markdown pro Telegram).

### 13.4 Guardrails por canal — a parte que decide se o produto é seguro

| Canal | Autenticação | Quem pode receber (audiência) | Risco se ignorado | Ritmo/aquecimento |
|---|---|---|---|---|
| **WhatsApp Meta** | OAuth Embedded Signup (já existe) | Opt-in explícito, qualquer contato (template aprovado) | Ban do WABA, quality rating cai | Tier da Meta (já existe, §9.3) |
| **WhatsApp Evolution** | QR code (já existe) | Só quem já conversou (já existe) | Ban do número pessoal | `evolutionSendDelayMs` + warmup (já existe) |
| **E-mail** | Domínio verificado (Resend) — recomendo subdomínio próprio do ZapScript + `Reply-To` do usuário, não domínio por cliente (mais rápido, sem esperar verificação DNS de cada usuário) | Opt-in explícito, CSV livre OK | Domínio marcado como spam (Gmail/Outlook passam a rejeitar TODOS os e-mails do domínio, não só os da campanha) | Mesmo princípio do warmup do Evolution, mas por *domínio de envio*, não por número — reaproveita `effectiveEvolutionDailyLimit` generalizado |
| **SMS** | Credenciais de gateway (Twilio já tem conta configurada no projeto pra WhatsApp — dá pra reaproveitar se o número Twilio tiver SMS habilitado no Brasil; verificar antes de assumir) | Opt-in explícito — mais fiscalizado que e-mail (Anatel/LGPD); recomendo começar só com audiência quente, como o Evolution | Bloqueio da operadora, multa Anatel, reclamação vira custo real (cada SMS já é custo real, diferente de WhatsApp/e-mail) | Ritmo mais conservador ainda; **custo por mensagem exige mecanismo de saldo/cobrança — decisão de produto, não só técnica** |
| **Telegram** | Token de bot (usuário cria no @BotFather — não automatizável via API, passo manual do usuário) | Só quem já mandou `/start` pro bot — Telegram *impede* mensagem fria estruturalmente | Bot bloqueado por usuários (não é catastrófico como ban de WhatsApp) | Frouxo — Telegram permite ritmo bem mais alto que WhatsApp |
| **Instagram Direct** | Extensão do OAuth Meta já existente (mesmo Business Manager) — precisa de permissão nova (`instagram_manage_messages`) sujeita a **App Review da Meta (pode levar semanas)** | **Só dentro de 24h da última mensagem do contato** — fora disso a API rejeita, não é só política, é limite técnico | Restrição/bloqueio da conta comercial | N/A — é sempre reativo, não "campanha" no sentido de disparo em massa frio |
| **Facebook Messenger** | Idem Instagram (`pages_messaging`) | Idem Instagram — janela de 24h | Idem Instagram | N/A |

**Consequência prática pro produto**: Instagram e Facebook não conseguem fazer "campanha fria"
no sentido que WhatsApp Meta faz — só dá pra reengajar quem mandou mensagem nas últimas 24h.
Vale nomear essas duas como "Reengajamento" na UI, não "Campanha", pra não criar expectativa
que a API não entrega (evita o cliente descobrir isso só quando o envio falhar em massa).

### 13.5 O que já existe e encurta o caminho

- **E-mail**: `sendEmail()` (Resend) já está em produção (api e worker) — só falta domínio
  dedicado + link de descadastro (reaproveita `CampanhaOptOut`, o campo `phone` já é uma string
  genérica, serve pra guardar e-mail sem mudar schema) + webhook de bounce/complaint do Resend.
- **SMS**: `apps/worker/src/services/twilio.ts` já existe — hoje só baixa áudio e manda
  WhatsApp via Twilio, mas a MESMA conta Twilio provavelmente já tem (ou pode habilitar) SMS —
  verificar antes de contratar outro gateway (Zenvia, TotalVoice) só por achar que precisa de
  um novo.
- **Instagram/Facebook**: usam a mesma família de Graph API e o mesmo Business Manager que o
  WhatsApp Meta já usa (`meta-embedded.ts`) — não é uma integração do zero, é extensão de
  permissões sobre a MESMA conexão que o usuário já fez. O gargalo é o App Review da Meta
  (tempo de calendário, não de código).
- **Telegram**: bot API é grátis, sem review — o mais rápido de construir tecnicamente; a única
  fricção é o usuário final ter que criar o bot manualmente no @BotFather.
- **Pacing/circuit breaker/pool/janela de envio/e-mail de conclusão** (§11): já desenhados pra
  não saber qual canal é — só precisam de `dailyLimit`/`warmupDays` vindo do adapter em vez de
  constantes fixas do Evolution.

### 13.6 Ordem de rollout recomendada (e por quê)

1. **Refactor pro `ChannelAdapter`** primeiro, sem adicionar canal nenhum ainda — reduz o risco
   de cada fase seguinte (é o mesmo tipo de "pagar a dívida antes de crescer" que já apliquei
   dentro do próprio `/:id/start` no §12.2, só que em escala maior).
2. **E-mail** — maior alavancagem: infra já existe (Resend), menor risco regulatório que SMS,
   sem dependência de aprovação externa (App Review). Primeiro canal novo de verdade.
3. **Telegram** — tecnicamente o mais simples e mais rápido dos que faltam, zero aprovação
   externa; bom pra validar o `ChannelAdapter` com um 2º canal novo antes do mais complexo.
4. **SMS** — depende de decisão de negócio (cobrança por mensagem) antes de codar; tecnicamente
   pronto assim que essa decisão existir.
5. **Instagram + Facebook juntos** — mesma integração (Graph API/Business Manager), mas
   **disparar o App Review da Meta o quanto antes** (item 6.7 abaixo) porque o prazo dele é
   quem manda o cronograma real dessa fase, não a implementação.

### 13.7 Decisões que só você pode tomar antes de eu executar

- **Bluetooth/WiFi**: confirma que fica de fora deste plano (proximidade é outro produto), ou
  era outra coisa que eu não entendi?
- **SMS**: reaproveitar a conta Twilio existente (se tiver SMS habilitado pro Brasil) ou avaliar
  Zenvia/TotalVoice? E qual o modelo de cobrança (incluso no plano com limite, ou saldo avulso)?
- **Ordem**: concorda com E-mail → Telegram → SMS → Instagram/Facebook, ou prioriza diferente
  (ex: Instagram/Facebook primeiro, aceitando esperar o App Review em paralelo)?
- Quer que eu já dispare o cadastro do App Review da Meta pras permissões de Instagram/Facebook
  agora (não trava nada, só começa a contar o prazo), mesmo antes de codar essas fases?

## 15. Segmentação, sequência/drip e A/B test (fecha o §14.2)

Os 3 itens que o §14.2 tinha deixado pendentes por decisão de produto. Perguntado ao usuário com
uma opção "(Recomendado)" pré-selecionada pra cada um; todas as 4 foram aceitas como estão:
**segmentação por tag do CRM**, **sequência com passos fixos (sem checar resposta)**, **A/B só
reportando por variante (sem promover vencedor automático)**, e **limite de uso por plano
adiado** (sem mudança — ver §15.6). WhatsApp apenas (Meta + Evolution); nenhum dos 3 tem relação
com o desenho multicanal do §13.

### 15.0 Schema (migration `20260909_campanhas_sequencia_abtest`)

Em `Campanha`: `sequenceParentId`/`sequenceIndex`/`sequenceDelayDays` (auto-relação
`CampanhaSequence`, `onDelete: Cascade`) + `abTestEnabled` e os 5 campos `variantB*` (espelham
`templateName`/`templateLanguage`/`templateComponents`/`templateVarCount`/`messageBody` pra
variante B). Em `CampanhaContato`: `variant` (`'A' | 'B' | null`). Índice em
`sequenceParentId`. Nenhum campo novo em `CampanhaOptOut` — reaproveitado como está.

### 15.1 Segmentação por tag do CRM

`GET /crm-tags` (dedup + sort das tags de `CrmContact` do usuário) e
`POST /:id/contatos/from-crm` (`{ tag }`). Reaproveita `CrmContact.tags` — nenhum campo novo.
Duas guardrails que fazem essa importação nunca furar regra que já existia:

- **Evolution**: contatos da tag são intersectados com `warmContactsForNumber()` — a tag pode
  *reduzir* a audiência, nunca driblar a exigência de "só quem já conversou" (§8).
- **Meta**: bloqueado quando `campanha.templateVarCount` é truthy — o CRM não tem de onde tirar
  `{{1}}`, `{{2}}`... posicionais; isso continua sendo papel exclusivo do CSV (§11/item 6).

### 15.2 Sequência/drip — passos fixos

Decisão de desenho: cada passo é uma **`Campanha` inteira**, ligada à mãe por
`sequenceParentId`/`sequenceIndex`/`sequenceDelayDays`, em vez de uma estrutura aninhada dentro
de uma campanha só. `POST /:id/sequence` (`{ steps: [{ delayDays, templateName|messageBody,
... }] }`, 1 a 5 passos) cria essas campanhas-filhas em `draft` e copia a audiência atual da mãe
(contatos não opt-out) pra cada uma.

Isso é deliberadamente **zero lógica nova de disparo**: circuit breaker, pool, janela de envio,
tier check, notificação de conclusão — tudo do worker/scheduler já existente passa a valer pra
cada passo sem tocar em uma linha dessa infraestrutura. O único código novo é o agendamento em
cascata: `POST /:id/start` (API) e `fireCampanha()` (`campanhas-scheduler.ts`, pro caso agendado)
agora, ao iniciar a mãe, buscam os passos-filhos em `draft` e os agendam
(`scheduledAt = startedAt da mãe + sequenceDelayDays de cada um`), copiando
`consentConfirmedAt`/`consentConfirmedIp` da mãe — o usuário já deu consentimento pra essa mesma
audiência ao iniciar o primeiro passo, não precisa reconfirmar por passo. `POST /:id/cancel`
cascateia do mesmo jeito: cancelar a mãe cancela os passos que ainda não terminaram.

Trade-off aceito: os passos herdam a audiência da mãe **no momento da criação da sequência**, não
dinamicamente — se você importar mais contatos na mãe depois de criar a sequência, os passos não
recebem esses novos contatos automaticamente. E os passos não suportam A/B (§15.3) — o
`contatosBase` copiado pra cada filho não carrega `variant`. Nenhum dos dois era parte da decisão
que o usuário confirmou ("passos fixos, sem checar resposta"); ficam registrados aqui como
limitação conhecida, não como bug.

### 15.3 A/B test — 2 variantes, sem vencedor automático

Conteúdo da variante B mora direto em `Campanha` (`variantBTemplateName` etc. ou
`variantBMessageBody`, conforme o canal — mesmo par de campos que a campanha já usa pra variante
A). `CampanhaContato.variant` marca cada contato como `'A'` ou `'B'` no momento da criação —
alternância determinística pela **posição entre os aceitos** (`toCreate.length % 2`), não pelo
índice bruto do loop de import, nos 3 caminhos de importação (`from-conversas`, `from-crm`, CSV):
isso garante split exato 50/50 mesmo com opt-out/duplicado/inválido intercalado nas linhas
originais.

No worker, `processCampanhaJob` resolve `isVariantB = campanha.abTestEnabled && contato.variant
=== 'B'` e usa os campos `variantB*` em vez dos normais só nesse caso — mesmo path de envio,
sem branch novo de fila/circuit-breaker/pool. `GET /:id` devolve `statsByVariant` (`{ A: {...},
B: {...} }`, agrupado por `variant`+`status`) só quando `abTestEnabled`, pra não pagar o
`groupBy` extra em campanhas comuns. Sem lógica de "vencedor" — por decisão explícita do usuário,
é só leitura comparativa; promover automaticamente fica de fora até (se) for pedido.

### 15.4 Web UI

- **`nova/page.tsx`**: checkbox "Testar 2 versões (A/B)" nos dois formulários (Meta e Evolution),
  revelando o seletor de template (Meta) ou textarea (Evolution) da variante B. Corrigido de
  passagem um gap real encontrado ao mexer no formulário: o payload de criação calculava
  `varCount` localmente mas nunca mandava `templateVarCount` pra API — a validação de variáveis
  do item 6 (§11.6) não disparava de verdade pra campanhas criadas pela tela, só nos testes
  (que setam o campo direto no mock). Corrigido junto.
- **`[id]/page.tsx`**: card "Segmentar por tag do CRM" (só aparece se o usuário tem alguma tag
  cadastrada) com select + botão, resultado da importação com a mesma contagem que o back-end
  devolve (`imported`/`skippedOptOut`/`skippedDuplicate`/`skippedCold`/`elegiveis`). Card
  "Sequência/drip" com 3 estados mutuamente exclusivos: link pra mãe (quando a campanha é um
  passo), lista dos passos com status/data (quando a campanha é mãe com sequência já criada), ou
  formulário "Criar sequência" (até 5 passos, campo de dias + template/mensagem por passo — só
  aparece em rascunho com audiência e sem sequência ainda). Card "Teste A/B — por variante"
  (comparação lado a lado, só quando `abTestEnabled`).

### 15.5 Testes

98 testes em `apps/api/src/__tests__/campanhas.test.ts` (+15 nesta revisão: 5 de segmentação, 6
de sequência — incluindo o cálculo exato de `scheduledAt` por passo — e 4 de A/B) e 19 em
`apps/worker/src/__tests__/campanhas.test.ts` (+3, cobrindo variante B/A/controle nos dois
canais). `npx tsc --noEmit` limpo em `apps/api`, `apps/worker` e `apps/web`.

### 15.6 Limite de uso por plano — continua adiado

Único dos 4 itens do §14.2 sem mudança de status: o usuário escolheu adiar (não construir limite
nenhum por enquanto). Nada foi implementado aqui de propósito — não é gap esquecido, é decisão
tomada.
