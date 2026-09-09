# ZapScript Campanhas — Arquitetura, Estado Atual e Roadmap

> **Achado importante antes de qualquer coisa:** o módulo `campanhas` **já existe e está em
> produção** — não é um feature novo a construir do zero. Está com `status: 'bundled'`
> no catálogo (`packages/modules/catalog.ts`), incluso no Profissional e no Empresas desde a
> migração `20260908_campanhas_bundled`. Este documento faz o levantamento sênior do que já
> está implementado, aponta lacunas de produção/escala/compliance e propõe um roadmap
> priorizado — no mesmo espírito de `MODULOS_ARQUITETURA.md` / `PLATAFORMA_BASE.md`.

Data: 2026-09-09 · Branch: `claude/laughing-ritchie-3n4vj1`

---

## 1. O que é

Disparo em massa de mensagens de template via **WhatsApp Cloud API oficial (Meta)** —
diferente do `core`/`atende`, que rodam sobre Evolution API (WhatsApp não-oficial). Existe
porque, com o fechamento de bots não autorizados pela política Meta (dez/2025), o único
caminho legal para "disparar mensagem sem o cliente ter escrito primeiro" é a API oficial +
template pré-aprovado.

**JTBD:** *"Perdi meu bot não autorizado e preciso de alternativa legal agora."*

---

## 2. Arquitetura atual (as-built)

```
┌─ apps/web (/app/campanhas) ────────────────────────────────────────────────┐
│  lista → nova (CSV) → detalhe (stats) → optouts                            │
└───────────────┬──────────────────────────────────────────────────────────-┘
                 │ REST (Fastify)
┌────────────────▼───────────────────────────────────────────────────────────┐
│ apps/api/src/routes/modules/campanhas.ts   (auth + requireModule('campanhas'))│
│  GET /            lista campanhas + stats agregados                         │
│  GET /templates    templates APPROVED do WABA do usuário (Graph API)        │
│  GET /optouts       lista opt-out do usuário                                │
│  POST /             cria rascunho (nome, número Meta, template)             │
│  POST /:id/contatos upload CSV → parse → dedupe (optout/existing/mesmo arq.)│
│  POST /:id/schedule | /unschedule                                           │
│  POST /:id/start | /pause | /cancel                                         │
└───────┬──────────────────────────────────────────┬─────────────────────────┘
        │ campanhasQueue.addBulk (jobId determinístico campanhaId:contatoId)  │
┌───────▼─────────────────┐                ┌────────▼─────────────────────────┐
│ apps/worker              │                │ apps/worker/campanhas-scheduler │
│ Worker('campanhas')      │                │ tick 60s: scheduled→running      │
│ concurrency=CAMPANHAS_   │                │ (updateMany atômico, sem duplicar│
│  CONCURRENCY             │                │  entre réplicas)                 │
│ limiter: 10 msg/s GLOBAL │                └───────────────────────────────────┘
│  (safety ceiling p/      │
│  Graph API)              │
└───────┬──────────────────┘
        │ sendTemplateMessage() — services/whatsapp-campaigns.ts
        ▼
   Graph API (Meta Cloud API, token/credenciais por WhatsappNumber do cliente)
        │
        ▼ (webhook assíncrono de status)
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/api/src/routes/whatsapp-webhook.ts                                    │
│  • status sent/delivered/read/failed → CampanhaContato.wamid (índice hot)  │
│  • opt-out por palavra-chave (PARAR/SAIR/STOP/CANCELAR/UNSUBSCRIBE)        │
│    → CampanhaOptOut.upsert + marca pending→optout (jobs em voo já cobertos)│
└───────────────────────────────────────────────────────────────────────────┘
```

### Modelo de dados (`packages/database/prisma/schema.prisma`)

- **`Campanha`** — dono (`userId`), número Meta, template + idioma + componentes estáticos,
  `status` (`draft|scheduled|running|paused|completed|canceled|failed`), contadores
  (`audienceCount`, `sentCount`).
- **`CampanhaContato`** — um registro por destinatário, `status`
  (`pending|sent|delivered|read|failed|optout`), `wamid` (correlação com webhook), variáveis
  posicionais do template.
- **`CampanhaOptOut`** — opt-out por usuário+telefone (não é global — cada Business tem a
  própria lista, correto do ponto de vista LGPD/Meta).

### Pontos fortes (o que já está bem resolvido — não reinventar)

1. **Idempotência de ponta a ponta**: `jobId` determinístico (`campanhaId:contatoId`) evita
   duplicar envio ao reenfileirar; `updateMany` filtrado por status evita corrida entre
   scheduler/worker/webhook (padrão consistente em todo o módulo).
2. **Pausa/cancelamento sem "matar" jobs em voo**: o worker reconfere status ao vivo antes de
   enviar — mais simples e mais seguro do que tentar remover jobs do BullMQ.
3. **Opt-out reativo funcional**: palavra-chave → grava, atualiza pendentes, confirma pro
   usuário final. Cobre tanto fila futura quanto em voo.
4. **CSV parser sem dependência externa**, com dedupe em 3 camadas (opt-out, já existente na
   campanha, duplicado no próprio arquivo) — evita reenviar e evita violar opt-out.
5. **Credencial por tenant** (`WhatsappNumber.metaAccessTokenEnc`), nunca token global — zero
   risco de um cliente disparar pelo WABA de outro.
6. **Rate limit de segurança** (10 msg/s) já existe no `Worker('campanhas')` — não é um
   "buraco" de dia zero, é uma lacuna de *maturidade* (ver §3.2).

---

## 3. Lacunas e riscos (visão sênior de produção/escala/compliance)

### 3.1 Compliance / Trust & Safety — **maior risco do módulo**

- **Opt-out é só reativo.** Não existe checagem de **opt-in** antes do envio: o usuário sobe
  um CSV e a UI não pede confirmação de que tem consentimento daqueles contatos (o produto já
  trata LGPD como tema de primeira classe — `checkboxes-lgpd-tos.html`,
  `politica-privacidade.html` — mas isso não chegou ao fluxo de Campanhas).
  → **Ação:** checkbox obrigatório no upload/`/start` ("confirmo que tenho consentimento
  destes contatos para campanhas de marketing"), registrado com timestamp (auditoria).
- **Nenhuma visibilidade de abuso na plataforma.** Cada cliente usa o próprio WABA (bom -
  isola o risco de banimento por conta), mas o ZapScript é a **Tech/Solution Provider** perante
  a Meta: uma onda de reclamações/banimentos de clientes pode acionar revisão do app
  parceiro. Hoje não há nenhum painel admin nem alerta para taxa de falha/opt-out anormal por
  campanha.
  → **Ação (P1):** métricas agregadas (taxa de falha, taxa de opt-out) por campanha com
  alerta simples (Slack/e-mail) acima de um limiar.

### 3.2 Meta Cloud API — limites de mensageria e quality rating não são observados

Hoje o único controle é um teto fixo de **10 msg/s por todo o worker** (todos os tenants
somados). Isso ignora dois mecanismos reais da Cloud API:

- **`messaging_limit_tier`** por número (250 / 1.000 / 10.000 / 100.000 contatos únicos por
  janela móvel de 24h — os valores exatos variam e a Meta revisa a política com frequência;
  **confirmar o tier atual na Graph API antes de implementar**, não hardcode). Passar do teto
  não é "mais lento" — a Meta passa a **rejeitar** envios (o cliente vê uma onda de `failed`
  sem entender por quê).
- **`quality_rating`** (verde/amarelo/vermelho) — cai com opt-out/report em excesso e pode
  **reduzir automaticamente o tier**, criando um efeito cascata silencioso.

→ **Ação (P0, antes de qualquer campanha grande):**
1. Buscar `messaging_limit_tier` + `quality_rating` do `phone-number-id` via Graph API
   (endpoint `GET /{phone-number-id}?fields=...`) e persistir em `WhatsappNumber` (novos
   campos `metaMessagingLimitTier`, `metaQualityRating`, com refresh periódico).
2. Bloquear/avisar em `/start` se `audienceCount` > limite do tier corrente (hoje o único
   guard é "tem pelo menos 1 contato pendente").
3. Reconhecer os **códigos de erro de rate-limit da Graph API** (ex.: `error.code` de
   throttling) na resposta de `sendTemplateMessage` e, ao detectar, **pausar a campanha
   automaticamente** (`status: 'paused'`, motivo registrado) em vez de deixar o BullMQ
   simplesmente esgotar tentativas e marcar cada contato como `failed` — hoje isso queima
   contatos que teriam sucesso passada a janela de 24h.
4. Repensar o limiter de 10 msg/s como **por tenant/por número**, não só global — hoje uma
   campanha grande de um cliente pode saturar a fila e atrasar a de outro (ruído entre
   inquilinos). BullMQ suporta rate limit por grupo (`group.id`); vale avaliar
   `Queue.add({ ..., opts: { group: { id: whatsappNumberId } } })` num upgrade de versão, ou
   um limiter simples em memória por `whatsappNumberId` no processor.

### 3.3 Templates — gestão fica 100% fora do produto

- Só existe **listagem** de templates já aprovados (`GET /templates`); criar/editar/submeter
  template para aprovação da Meta exige o cliente ir até o Business Manager. Fricção alta
  para o público-alvo (MEI, pouca familiaridade com o ecossistema Meta).
- **Templates com header de mídia (imagem/vídeo) não são suportados** — a própria UI avisa
  isso (`nova/page.tsx`). Só body com variáveis posicionais simples.
- **Sem preview nem envio de teste** antes do disparo em massa — erro de variável só aparece
  depois que já foi pro cliente final.
- **Sem validação prévia de contagem de variáveis** do template contra as colunas do CSV — o
  primeiro sinal de "coluna faltando" é uma onda de `failed` durante o envio real.

→ **Ação (P1):** validar contagem de `{{n}}` do template selecionado contra as colunas do CSV
no momento do upload (a API já busca o template via Graph — só falta comparar). **Ação (P2):**
suporte a header de imagem (um campo de URL de mídia na criação, reaproveitando o
`templateComponents` que já existe no schema). **Ação (P2/P3):** criação/submissão de
template dentro do ZapScript (`POST /{waba-id}/message_templates`) — reduz fricção mas exige
UI de composição + regras de categoria (`MARKETING`/`UTILITY`) da Meta.

### 3.4 Audiência — sem reuso, sem segmentação

- Cada campanha exige **novo upload de CSV**; não há lista/contato reutilizável entre
  campanhas, nem integração com o módulo `crm` (que já tem `CrmContact` no mesmo banco) ou com
  os contatos que já conversaram no `atende`. Reenviar pra "quem comprou no mês passado" hoje
  significa reexportar CSV manualmente toda vez.
- Nenhuma segmentação/tag (ex.: "clientes SP", "inadimplentes").

→ **Ação (P2, valor alto):** entidade `CampanhaAudiencia`/lista de contatos persistente
(fora de uma campanha específica), com import CSV único e reuso em N campanhas; depois, um
segundo passo é permitir montar audiência a partir de `CrmContact` (cross-sell natural com o
módulo `crm`, e alinhado à visão de "kernel + módulos" de `PLATAFORMA_BASE.md`).

### 3.5 Analytics / relatório

- `GET /:id` retorna só contagem por status — não tem série temporal (envios por hora),
  comparação entre campanhas, nem custo. A Meta cobra por conversa/mensagem de marketing
  fora da janela de 24h (modelo de cobrança já mudou mais de uma vez nos últimos anos —
  **validar o modelo vigente com a Meta antes de prometer qualquer coisa ao usuário**); hoje
  o ZapScript não mostra nenhuma estimativa de custo Meta antes de apertar "iniciar".

→ **Ação (P2):** tela de resultados com funil (enviado→entregue→lido→respondido) e, se fizer
sentido de negócio, estimativa de custo Meta antes do disparo (decisão de produto: repassar
custo Meta ao cliente ou absorver no preço do módulo — hoje `campanhas` é bundled, sem cobrança
por volume, então isso é puramente informativo por ora).

### 3.6 Continuidade da conversa pós-campanha

O webhook geral (`whatsapp-webhook.ts`) já processa qualquer mensagem recebida no número,
então uma resposta de cliente a uma campanha **não se perde** — mas hoje não fica marcada
como "originada de campanha X". Não há atribuição campanha→lead/conversa.

→ **Ação (P3):** ao registrar a resposta, checar se o `from` está em `CampanhaContato` da
campanha mais recente daquele número e anexar essa origem (útil para o módulo `crm` e para
métricas de conversão da própria campanha).

### 3.7 Testes

`apps/api/src/__tests__/campanhas.test.ts` (635 linhas) e
`apps/worker/src/__tests__/campanhas.test.ts` (185 linhas) já cobrem bastante do caminho
feliz e idempotência. Vale conferir explicitamente (não assumido neste levantamento, requer
rodar a suíte) se cobrem: erro de rate-limit da Graph API, corrida
scheduler-tick × `/start` manual simultâneos, e o novo comportamento de tier/quality-rating
proposto em §3.2 — que ainda não existe, então não pode estar testado.

---

## 4. Roadmap priorizado

| Prioridade | Item | Por quê agora | Esforço (senso) |
|---|---|---|---|
| **P0** | Ler e persistir `messaging_limit_tier` + `quality_rating`; bloquear/avisar `/start` acima do tier; auto-pausar campanha em erro de rate-limit da Graph API | Sem isso, campanha grande = onda de `failed` silenciosa e risco de degradar o WABA do cliente | Pequeno–médio (1 migration + 1 endpoint Graph + lógica em `/start` e no processor) |
| **P0** | Checkbox de consentimento no upload/`/start`, com timestamp de auditoria | Risco jurídico/reputacional (LGPD + política Meta) do maior módulo de "mensagem não solicitada" da suíte | Pequeno (schema + UI) |
| **P1** | Validar nº de variáveis do template vs. colunas do CSV no upload | Evita queimar tentativas/():contatos por erro evitável e detectável antes do envio | Pequeno |
| **P1** | Painel/alerta agregado de taxa de falha e opt-out por campanha (mesmo que só admin, por ora) | Visibilidade de trust & safety como Tech Provider da Meta | Pequeno–médio |
| **P2** | Rate limit por tenant/número (não só global) | Evita uma campanha grande atrasar a de outro cliente — fica mais relevante à medida que a base cresce | Médio |
| **P2** | Lista de audiência reutilizável (fora de uma campanha específica) | Elimina reexportar CSV toda campanha; prepara terreno para segmentação/CRM | Médio |
| **P2** | Suporte a header de mídia no template + preview/teste de envio | Cobre categoria comum de template de marketing; reduz erro de 1º disparo | Médio |
| **P3** | Atribuição campanha→resposta (origem no CRM) | Fecha o ciclo "disparo → conversa → venda", sinergia com `crm` | Médio |
| **P3** | Criação/submissão de template dentro do ZapScript | Reduz fricção de onboarding, mas exige UI própria de composição e regras de categoria Meta | Grande |

**Não recomendo** reescrever o módulo para seguir o contrato `ZapModule`/kernel descrito em
`PLATAFORMA_BASE.md` agora — aquele barramento ainda não existe de fato (nenhum módulo o usa
hoje, nem `atende`); migrar `campanhas` sozinho pra um padrão que mais ninguém segue criaria
inconsistência sem ganho imediato. Revisitar isso quando (e se) o dispatcher de entrada for
construído de verdade.

---

## 5. Decisões que precisam do dono do produto

1. **Modelo de custo Meta:** repassar ao cliente por volume ou manter 100% absorvido no preço
   do bundle (Profissional/Empresas)? Hoje é a segunda opção, implicitamente — vale confirmar
   que é intencional à medida que o volume crescer.
2. **Tier mínimo aceitável para vender "disparo em massa":** clientes com número novo/tier 1
   (baixo limite) terão expectativa de "disparo em massa" frustrada — vale um aviso proativo
   na UI (`nova/page.tsx`) mesmo antes do item P0 técnico estar pronto.
3. **Criação de template in-app (P3):** investimento grande de UI só se o atrito de "ir até o
   Business Manager" estiver de fato barrando conversão — validar com clientes antes de
   construir.
