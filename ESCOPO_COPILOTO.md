# ZapScript Copiloto — Escopo de Criação

> Agente pessoal do **dono do negócio** dentro do ZapScript: lê as conversas do
> WhatsApp já conectado, interpreta, resume **só para ele**, sugere **3 ações**
> com técnicas de persuasão e boas práticas de atendimento, entrega um **resumo
> diário dos grupos**, e **aprende continuamente** o jeito dele pensar e responder.

- **Data:** 2026-09-04
- **Branch:** `claude/whatsapp-zapscript-agent-0cc3id`
- **Status:** proposta de escopo (pré-implementação). Nada abaixo foi construído ainda.
- **Lentes aplicadas:** `/dev` (arquitetura e execução), `/adm` (custo, compliance, operação), `/mkt` (posicionamento, pricing, lançamento).
- **Leia antes:** `MODULOS_ARQUITETURA.md` (titularidade), `PLATAFORMA_BASE.md` (kernel + módulos), `CLAUDE.md` (infra real).

---

## 1. O que é (e o que explicitamente NÃO é)

| | Copiloto (novo) | Atende (já existe) |
|---|---|---|
| Fala com quem | **Só com o dono** | Com o cliente final |
| Envia sozinho | **Nunca** sem confirmação | Sim, acima do limiar de confiança |
| Objetivo | Decidir melhor e mais rápido | Não deixar cliente sem resposta |
| Falha típica | Sugestão ruim → dono ignora (custo baixo) | Resposta errada em nome do negócio (custo alto) |
| Onde vive | `apps/worker/src/copiloto.ts` + `/app/copiloto` | `apps/worker/src/atende.ts` + `/app/atende` |

Essa separação é a decisão de arquitetura mais importante do documento. O Copiloto
é **assistivo, não autônomo**: ele nunca escreve no chat do cliente por conta própria.
Isso derruba a superfície de risco (jurídico, reputacional, LGPD) em uma ordem de
grandeza e permite ser muito mais agressivo na qualidade das sugestões — porque
sempre há um humano no gatilho.

**Não é:** um segundo bot de atendimento; um disparador de mensagem em massa
(isso é `campanhas`); um CRM (isso é `crm`, mas o Copiloto alimenta ele).

**Chave do módulo:** `copiloto` — entra em `packages/modules/catalog.ts`, rota
`/app/copiloto`, gate `requireModule('copiloto')` como qualquer outro módulo.

---

## 2. Escopo funcional

### 2.1 Leitura e triagem (o filtro que segura o custo)

O Copiloto consome as mensagens que já chegam pelo webhook da Evolution
(`apps/api/src/routes/evolution-webhook.ts`, evento `messages.upsert`) — **sem
nova conexão, sem novo QR code, sem nova instância**. Reaproveita 100% da
conexão que o usuário já tem.

Nem toda mensagem merece um briefing. Sem filtro, um usuário com 40 conversas/dia
gera 40 chamadas caras de IA e 40 notificações — vira ruído e queima o produto na
primeira semana. Por isso, duas etapas:

1. **Debounce por conversa (3 min).** Mensagens em rajada viram *um* evento. O
   contador reinicia a cada mensagem nova do contato; briefing só quando o
   contato para de digitar.
2. **Triagem barata (Haiku 4.5).** Classifica em `ignorar` | `observar` |
   `briefing`, com um motivo. Sobe para briefing quando houver pelo menos um de:
   - contato novo (primeira conversa);
   - pergunta com intenção comercial (preço, prazo, "quanto custa", "fecha?");
   - sinal de risco (reclamação, tom negativo, ameaça de cancelamento);
   - pedido explícito de decisão ("me manda proposta", "pode segurar até sexta?");
   - conversa parada há mais de N horas com a bola do lado do dono;
   - valor em jogo (contato já tem negócio aberto no CRM).

Regra de ouro: **quando em dúvida, não notifica.** Falso negativo custa uma
oportunidade adiada; falso positivo custa a confiança no produto.

### 2.2 Briefing — o resumo, só para o dono

Para cada evento que passa na triagem, o Copiloto produz:

- **Quem é** — nome, telefone mascarado, estágio no CRM se existir, histórico ("3º contato, sumiu há 8 dias").
- **O que aconteceu** — 2 a 4 linhas, em português direto, sem enfeite.
- **O que o cliente quer de fato** — a intenção por trás do texto (o pedido literal raramente é o pedido real).
- **Temperatura** — quente / morno / frio, com a evidência que sustenta ("perguntou forma de pagamento" ≠ "disse que vai ver").
- **Onde trava** — a objeção real: preço, prazo, confiança, autoridade de decisão, ou falta de urgência.
- **Risco de perder** — baixo/médio/alto + o que dispara a perda.

O briefing **nunca** é enviado ao cliente. Vive em `CopilotoBriefing`, aparece no
canal escolhido (§4) e no painel `/app/copiloto`.

### 2.3 As 3 opções de ação

Sempre **exatamente três**, e sempre em **eixos diferentes** — três variações do
mesmo texto não são opções, são desperdício de leitura. Os eixos:

| Eixo | Quando lidera | O que faz | Base técnica |
|---|---|---|---|
| **A — Avançar** | Cliente já demonstrou intenção | Fecha, propõe o próximo passo concreto com data e valor | Linha Reta (fechamento assumido, loop de objeção) |
| **B — Qualificar** | Falta informação para decidir | Uma pergunta que abre orçamento, urgência ou autoridade | Linha Reta (qualificação: necessidade, dor, poder de decisão) |
| **C — Posicionar** | Cliente está pressionando ou fugindo | Reenquadra valor, ancora, dá saída digna sem rebaixar preço | Specter (enquadramento, alavancagem, não implorar) |

Cada opção entrega:

- **Título** (4 a 6 palavras: "Fechar com prazo de sexta").
- **Mensagem pronta para enviar** — no tom aprendido do dono (§5), pronta para copiar/enviar.
- **Por que essa** — uma linha de racional, honesta ("ele já perguntou preço duas vezes; qualificar de novo irrita").
- **Risco** — o que pode dar errado ("se ele não for o decisor, isso queima a bala").
- **Técnica aplicada** — etiqueta visível (`fechamento-assumido`, `ancoragem`, `loop-objecao`, `saida-digna`). Transparência aqui é o que transforma o produto em treinamento: em 30 dias o dono aprende a técnica, não só usa.

Além das 3, sempre existe a 4ª opção implícita: **não fazer nada agora** — e o
Copiloto deve recomendá-la explicitamente quando for a certa ("cliente disse que
volta segunda; cobrar hoje é ansiedade sua, não urgência dele").

### 2.4 Resumo diário dos grupos

Grupos que o dono **explicitamente cadastrar** (opt-in por grupo, nunca todos por
padrão) entram num resumo diário único, no horário que ele escolher:

```
Resumo dos grupos — 04/09, 08h00

*Fornecedores SP* (47 msgs)
• Decidido: entrega de quinta adiada para segunda.
• Pendente com você: Marcos pediu confirmação do pedido #3391 (ontem 16h). ❗
• Ruído: 31 msgs de bom dia/figurinha.

*Condomínio* (12 msgs)
• Nada exige você. Assembleia dia 12, 19h.

⏱️ 59 mensagens → 40 segundos de leitura.
```

Estrutura fixa por grupo: **Decidido** (o que mudou de estado) / **Pendente com
você** (ação sua, com quem pediu e quando) / **Datas e números** (o que não pode
se perder) / **Ruído** (contagem, não conteúdo). O que o dono precisa é saber se
pode ignorar o grupo hoje — a resposta "pode ignorar" é uma entrega de valor, não
uma falha.

**O Copiloto nunca escreve em grupo.** Só lê e resume. Isso é regra de produto e
de segurança, não configuração.

### 2.5 Aprendizado contínuo

Três camadas, do sinal mais forte ao mais fraco (detalhe técnico em §6):

1. **Escolha e edição** (sinal mais forte). Qual das 3 o dono escolheu, e o que
   ele mudou antes de enviar. O *diff* entre o rascunho e o texto realmente
   enviado é o dado mais valioso do sistema — é a correção explícita dele.
2. **Espelho de estilo**. O Copiloto lê as mensagens que o próprio dono já
   escreveu (`fromMe`) e extrai um perfil: comprimento médio, saudação e
   despedida típicas, uso de emoji, gírias e bordões, se ele manda um bloco ou
   várias mensagens curtas, se usa áudio, o quão direto é ao falar de preço.
3. **Resultado**. A conversa avançou depois da ação? O contato mudou de estágio
   no CRM? Fechou? Isso vira taxa de acerto por técnica e por tipo de situação —
   e as combinações vencedoras entram como exemplos no prompt.

O que o agente aprende é **estilo, prioridade e tática** — nunca fatos de negócio.
Preço, prazo e política continuam vindo só da base de conhecimento
(`AtendeKnowledgeBase`, reaproveitada). Um agente que "aprende" que o frete é
grátis porque o dono disse isso uma vez para um cliente é um passivo, não um
recurso.

---

## 3. Motor de persuasão — e os limites dele

### 3.1 O que entra de Harvey Specter (enquadramento e posição)

Aplicável, útil e defensável:

- **Enquadramento** — quem define os termos da conversa controla a negociação. Sugerir sempre o próximo passo concreto em vez de esperar o cliente propor.
- **Alavancagem honesta** — usar o que é verdade a seu favor (agenda cheia de verdade, lote real acabando, prazo real de produção). Nunca inventar escassez.
- **Não implorar** — desconto não é resposta para silêncio. A opção C existe para reancorar valor em vez de cortar preço por reflexo.
- **Saída digna** — dar ao cliente uma forma de dizer não sem constrangimento preserva a próxima venda.
- **Assimetria de informação a seu favor** — o Copiloto sabe o histórico inteiro; o cliente não lembra. Usar isso para personalizar ("da última vez você precisava para o fim do mês").

O que **não** entra: agressividade, blefe, intimidação, ultimato. Funciona em
série de TV; em WhatsApp de MEI brasileiro, queima cliente e vira print.

### 3.2 O que entra do Sistema de Linha Reta (Jordan Belfort)

Aplicável como **estrutura de conversa**, que é o que o método realmente é:

- **Os 3 dieses** — a venda só acontece quando o cliente confia no *produto*, em *você* e na *empresa*. O Copiloto diagnostica qual dos três está fraco e a opção sugerida ataca aquele especificamente.
- **Manter a linha reta** — toda mensagem sugerida empurra a conversa em direção ao fechamento ou à qualificação; nunca uma resposta que só "responde" e devolve a bola morta.
- **Qualificação** — descobrir necessidade real, dor, orçamento e quem decide antes de apresentar solução. É o coração da opção B.
- **Loop de objeção** — objeção não se rebate, se acolhe, se reenquadra e se volta para a linha. "Tá caro" vira uma pergunta sobre o que está sendo comparado.
- **Tonalidade** — o texto sugerido carrega a intenção (certeza, cuidado, escassez real). Em WhatsApp isso vira escolha de palavra, tamanho da frase e pontuação. Quando o dono usa áudio, o Copiloto sugere um roteiro falado curto.

O que **não** entra: pressão artificial, urgência falsa, "só hoje" mentiroso,
insistência após o não. Além de ilegal (§3.4), destrói a taxa de resposta futura
no WhatsApp — o canal pune quem faz isso com bloqueio.

### 3.3 Boas práticas de linguagem e atendimento (a camada que sustenta as outras)

Toda sugestão passa por um checklist antes de ser mostrada:

- Português correto, sem gerundismo ("vou estar verificando" → "vou verificar").
- Uma ideia por mensagem. Bloco de texto em WhatsApp não é lido.
- Sem jargão interno, sem sigla que o cliente não usa.
- Nomear a pessoa. Confirmar o que ela disse antes de responder (prova de escuta).
- Prazo sempre com data, nunca "em breve".
- Nunca prometer o que não está na base de conhecimento.
- Assumir o erro sem rodeio quando houver erro; desculpa curta, solução concreta.
- Emoji só onde o dono já usa (§5 — espelho de estilo decide, não o modelo).

### 3.4 Guardrails éticos e legais — inegociáveis

Persuasão vira infração quando cria falsa percepção. O CDC (Lei 8.078/90, arts.
37 e 39) proíbe publicidade enganosa e prática abusiva, e a LGPD limita o uso do
dado da conversa. Portanto, o gerador de sugestões é **proibido** de produzir:

- escassez ou urgência que o dono não confirmou como real;
- preço, desconto, prazo, garantia ou condição que não esteja na base de conhecimento;
- afirmação sobre concorrente;
- pressão sobre sinal de vulnerabilidade (idoso, endividado, urgência médica, luto) — nesses casos o Copiloto sugere **acolher e simplificar**, e sinaliza para o dono;
- insistência após recusa explícita ("não quero mais", "para de mandar") — a partir daí a única sugestão possível é encerrar com educação e parar.

Implementação: lista de proibições dentro do system prompt **mais** um validador
determinístico pós-geração (`copiloto-guardrails.ts`) que barra padrões de
scarcity/preço não ancorados na KB. Prompt sozinho não é controle — é pedido.

---

## 4. Como o resumo e as opções chegam ao dono

### 4.1 Canal principal — o próprio WhatsApp (self-chat)

O dono recebe no chat consigo mesmo, no número que já está conectado. A infra
existe: `isSelfChat` já é detectado no webhook e
`apps/api/src/services/atende-commands.ts` já processa comandos do dono por lá.

```
🎯 *Maria Souza* — orçamento de bolo (3º contato)

Perguntou preço pela 2ª vez e citou uma concorrente. Quer decidir hoje;
trava é confiança no prazo, não valor.
🌡️ Quente · ⚠️ Risco médio de perder para o concorrente

*1 · Fechar com data* ⟨fechamento-assumido⟩
"Maria, consigo garantir a entrega quinta 14h. Fecho pra você agora?"

*2 · Descobrir a real* ⟨qualificacao⟩
"Maria, a entrega é pra qual dia mesmo? Pergunto pra te dar o prazo certo."

*3 · Ancorar valor* ⟨ancoragem⟩
"Entendo a comparação. O meu inclui montagem no local e reposição
se algo chegar danificado — te mando foto de duas entregas dessa semana?"

Responda *1*, *2* ou *3* pra enviar · *1e* pra editar antes · *0* pra ignorar
```

**Interação:** `1` envia a opção 1 ao contato. `1e` devolve o texto para o dono
editar e ele responde com a versão final. `0` descarta (e isso também é sinal de
aprendizado). Envio **só** depois dessa confirmação explícita — nunca antes.

Por que este é o canal principal: o dono já está no WhatsApp o dia inteiro. Um
produto que exige abrir um painel para ser útil não é usado. E responder "1" é a
menor fricção possível entre "ver a sugestão" e "a ação acontecer".

### 4.2 Canal secundário — painel `/app/copiloto`

Inbox de cards com o briefing, as 3 opções, o histórico do contato e os botões
Enviar / Editar / Descartar. É onde o dono revisa em lote, ajusta configuração,
vê a taxa de acerto por técnica e gerencia grupos. Reaproveita o padrão visual de
`apps/web/src/app/app/atende/` (incluindo `SuggestionReview.tsx`, que já
implementa exatamente o fluxo sugerir → revisar → aceitar).

### 4.3 Canal do resumo de grupos

Uma mensagem por dia, no horário configurado (padrão 08h00, fuso do usuário),
pelo mesmo self-chat. Opcionalmente por e-mail (`lib/mailer.ts` já existe) para
quem prefere ler no computador.

### 4.4 Regras anti-ruído (o que decide se o produto sobrevive)

- **Teto diário** de briefings (padrão 8, configurável 3–20). Estourou, o excedente vira uma linha no resumo do fim do dia.
- **Horário de silêncio** (padrão 21h–07h e domingo). Nada é enviado; acumula.
- **Modo lote**: quem preferir recebe tudo em 2 blocos (meio-dia e fim do dia) em vez de tempo real.
- **Agrupamento**: 3 contatos pedindo a mesma coisa viram um card só.
- **Nunca repetir** briefing do mesmo contato sem fato novo.

---

## 5. Perfil de estilo — como ele aprende a escrever como o dono

`CopilotoStyleProfile`, versionado, recalculado periodicamente e injetado no
prompt. Campos:

| Dimensão | Exemplo aprendido |
|---|---|
| Comprimento | "média de 14 palavras; nunca passa de 3 linhas" |
| Abertura / fechamento | "abre com 'Oi, [nome]!'; fecha com 'qualquer coisa chama'" |
| Emoji | "usa 😊 e 👍, nunca ❤️; ~1 a cada 3 mensagens" |
| Formalidade | "você, nunca senhor; sem 'prezado'" |
| Fragmentação | "manda 2–3 mensagens curtas, não um bloco" |
| Dinheiro | "fala preço direto, sem rodeio, e já emenda a forma de pagamento" |
| Bordões | "'fechado?', 'te garanto', 'na real'" |
| Proibidos | "nunca usa 'estamos à disposição'" |
| Áudio | "manda áudio quando o assunto passa de 3 trocas" |

Fontes: mensagens `fromMe` do dono + as edições que ele faz nos rascunhos. O
perfil é **mostrado para ele** em `/app/copiloto/estilo`, editável à mão — ver o
que o sistema entendeu do seu jeito é metade da confiança no produto ("ele
percebeu que eu não uso 'prezado'" é o momento em que o usuário vira fã).

Implementação: perfil versionado + banco de exemplos few-shot (as 20 melhores
mensagens reais do dono, escolhidas por resultado). **Não** é fine-tuning — é
contexto, o que mantém tudo auditável, reversível e barato.

---

## 6. Arquitetura técnica (`/dev`)

### 6.1 Fluxo

```
Evolution (conexão atual)
   └─ messages.upsert → apps/api/src/routes/evolution-webhook.ts
        ├─ 1:1  → copilotoQueue.add('observe')      [novo, não bloqueia o fluxo atual]
        └─ grupo→ copilotoQueue.add('group-ingest') [só grupos cadastrados]

apps/worker/src/copiloto.ts
   ├─ observe      → debounce 3min → triagem (Haiku 4.5) → briefing? 
   ├─ brief        → CopilotoBriefing + 3 CopilotoSuggestion (Sonnet 5) → entrega
   ├─ act          → dono respondeu 1/2/3 → envia via Evolution → registra outcome
   ├─ group-digest → cron diário por usuário → resumo dos grupos
   └─ learn        → job noturno → recalcula CopilotoStyleProfile (Opus 5)
```

### 6.2 Onde tocar no código existente

| Arquivo | Mudança |
|---|---|
| `apps/api/src/routes/evolution-webhook.ts` | Enfileirar em `copilotoQueue` para 1:1; **abrir de forma controlada** o `if (remoteJid.includes('@g.us')) return;` da linha ~282 apenas para grupos cadastrados em `CopilotoGroup` (hoje todo grupo é descartado) |
| `packages/modules/catalog.ts` | Novo `ModuleSpec` `copiloto` |
| `apps/api/src/routes/billing.ts` | `copiloto` em `TIER_MODULE_BUNDLES` (ver §8) |
| `packages/database/prisma/schema.prisma` | 6 modelos novos (§6.3) + migration |
| `apps/api/src/routes/copiloto.ts` | **Novo** — config, grupos, inbox, ações, perfil de estilo |
| `apps/worker/src/copiloto.ts` | **Novo** — workers e crons |
| `apps/worker/src/services/copiloto-agent.ts` | **Novo** — triagem, briefing, sugestões |
| `apps/worker/src/services/copiloto-playbook.ts` | **Novo** — técnicas Specter/Belfort/boas práticas |
| `apps/worker/src/services/copiloto-guardrails.ts` | **Novo** — validador determinístico pós-geração |
| `apps/worker/src/services/copiloto-style.ts` | **Novo** — extração e versionamento do perfil |
| `apps/web/src/app/app/copiloto/*` | **Novo** — inbox, config, grupos, estilo |

Reaproveitamento direto, sem reconstruir nada: `sendMessageViaEvolution` e
`downloadAudioFromEvolution` (envio e mídia), `transcribeAudio` (áudio do
cliente vira texto do mesmo jeito que no Atende), `logAiUsage` (telemetria de
custo por tenant), `lib/queue.ts` (BullMQ/Redis), `lib/moduleGate.ts`
(entitlement), `AtendeKnowledgeBase` (fatos do negócio), `lib/encryption.ts`
(campos sensíveis).

### 6.3 Modelo de dados (Prisma)

```prisma
model CopilotoConfig {
  id              String   @id @default(cuid())
  numberId        String   @unique
  userId          String
  enabled         Boolean  @default(false)
  deliveryMode    String   @default("realtime")  // realtime | batch | painel
  maxBriefsPerDay Int      @default(8)
  quietStart      String   @default("21:00")
  quietEnd        String   @default("07:00")
  timezone        String   @default("America/Sao_Paulo")
  digestTime      String   @default("08:00")     // resumo dos grupos
  aggressiveness  String   @default("equilibrado") // consultivo | equilibrado | direto
  autoSend        Boolean  @default(false)       // v1: sempre false; reservado
  lastDigestAt    DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([userId])
}

model CopilotoGroup {
  id           String   @id @default(cuid())
  userId       String
  numberId     String
  groupJid     String
  name         String
  enabled      Boolean  @default(true)
  retentionDays Int     @default(7)   // mensagem crua some depois disso
  consentAt    DateTime                // quando o dono confirmou o opt-in (LGPD)
  createdAt    DateTime @default(now())
  @@unique([numberId, groupJid])
  @@index([userId, enabled])
}

model CopilotoBriefing {
  id            String   @id @default(cuid())
  userId        String
  numberId      String
  contactPhone  String
  contactName   String?
  summary       String
  intent        String
  temperature   String   // quente | morno | frio
  blocker       String?  // preco | prazo | confianca | autoridade | urgencia
  riskLevel     String   // baixo | medio | alto
  status        String   @default("pending") // pending | acted | dismissed | expired
  deliveredVia  String?  // whatsapp | painel | email
  createdAt     DateTime @default(now())
  suggestions   CopilotoSuggestion[]
  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, status])
}

model CopilotoSuggestion {
  id           String   @id @default(cuid())
  briefingId   String
  rank         Int      // 1 | 2 | 3
  axis         String   // avancar | qualificar | posicionar
  title        String
  draft        String
  rationale    String
  risk         String?
  technique    String   // fechamento-assumido | ancoragem | loop-objecao | ...
  confidence   Float
  status       String   @default("offered") // offered | sent | edited | discarded
  sentText     String?  // texto REAL enviado — o diff com draft é o sinal de aprendizado
  outcome      String?  // replied | no_reply | won | lost
  outcomeAt    DateTime?
  briefing     CopilotoBriefing @relation(fields: [briefingId], references: [id], onDelete: Cascade)
  @@index([briefingId])
  @@index([technique, outcome])
}

model CopilotoStyleProfile {
  id           String   @id @default(cuid())
  userId       String
  version      Int      @default(1)
  traits       Json     // dimensões da §5
  examples     Json     // few-shot: melhores mensagens reais do dono
  sampleCount  Int      @default(0)
  editedByUser Boolean  @default(false) // dono ajustou à mão → não sobrescrever cego
  createdAt    DateTime @default(now())
  @@unique([userId, version])
  @@index([userId])
}

model CopilotoGroupDigest {
  id         String   @id @default(cuid())
  userId     String
  groupId    String
  date       DateTime @db.Date
  decided    Json
  pending    Json
  dates      Json
  noiseCount Int      @default(0)
  createdAt  DateTime @default(now())
  @@unique([groupId, date])
  @@index([userId, date(sort: Desc)])
}
```

### 6.4 Escolha de modelos e custo unitário

Seguindo o padrão já usado em `atende-agent.ts` (array de modelos com fallback e
`logAiUsage`):

| Etapa | Modelo | Por quê |
|---|---|---|
| Triagem | `claude-haiku-4-5` | Alto volume, decisão binária. $1/$5 por MTok |
| Briefing + 3 opções | `claude-sonnet-5` | Julgamento com custo controlado. $2/$10 por MTok — **mais barato e mais novo** que o `claude-sonnet-4-6` usado hoje no Atende |
| Resumo de grupo | `claude-sonnet-5` | Volume alto de entrada, saída curta |
| Perfil de estilo (noturno) | `claude-opus-5` | Roda raro, exige julgamento fino. $5/$25 por MTok |

**Prompt caching** (`cache_control: {type:'ephemeral'}`) no prefixo estável —
playbook de persuasão + guardrails + perfil de estilo, ~2k tokens que repetem em
toda chamada. Leitura de cache custa ~10% do preço de entrada. O conteúdo volátil
(conversa, mensagem atual) vai **depois** do último breakpoint, senão o cache
nunca casa. Verificar `usage.cache_read_input_tokens > 0` em produção — se vier
zero sempre, tem invalidador silencioso (timestamp no prompt é o suspeito nº 1).

**Custo estimado por dono ativo/mês** (dólar a R$5,50 — reajustar):

| Item | Volume/mês | Custo |
|---|---|---|
| Triagem | 600 mensagens | ~US$ 0,30 |
| Briefings + 3 opções | 60 | ~US$ 0,62 |
| Resumo de grupos | 2 grupos × 30 dias | ~US$ 2,30 |
| Perfil de estilo | 4 (semanal) | ~US$ 0,60 |
| **Total** | | **~US$ 3,80 ≈ R$ 21/mês** |

Esse número é a informação mais importante do documento para a decisão de
negócio (§8): **o resumo de grupos é ~60% do custo** e escala linear com o número
de grupos. Sem teto, um usuário com 15 grupos custa mais do que paga.

### 6.5 Controles de custo (obrigatórios na v1)

- Teto de grupos por plano (3 no Profissional, 10 no Empresas), com upsell além disso.
- Teto de briefings/dia (§4.4) — que é anti-ruído *e* anti-custo ao mesmo tempo.
- Cap por tenant em `AiUsageLog`: passou de X no mês, degrada para modo lote e avisa o dono.
- Grupo sem mensagem no dia não gera chamada de IA (mesma economia que o digest do Atende já faz).
- Alerta operacional quando o custo de IA de um tenant passar de 25% da receita dele.

---

## 7. LGPD e compliance (`/adm`) — o ponto mais sensível

Ler conversa 1:1 é dado do cliente do nosso cliente. Ler **grupo** é dado de
terceiros que nunca ouviram falar do ZapScript. Isso muda a natureza do
tratamento e precisa ser tratado de frente:

1. **Papéis.** O dono é o **controlador**; o ZapScript é **operador** (LGPD art. 5º, VI e VII). Precisa estar no contrato (`contrato-prestacao.html`) e nos termos (`termos-de-servico.html`).
2. **Grupo é opt-in, um a um.** Sem "ligar para todos os grupos". Cada grupo pede confirmação explícita, com data registrada (`CopilotoGroup.consentAt`).
3. **Finalidade declarada e estreita** (art. 6º, I): resumir para o dono. Nunca treinar modelo global, nunca cruzar entre tenants, nunca vender agregado.
4. **Minimização** (art. 6º, III): mensagem crua de grupo com retenção curta (padrão 7 dias, configurável); o que persiste é o resumo, não o conteúdo. Briefings expiram em 90 dias.
5. **Sem dado sensível** (art. 11). Detector: mensagem com sinal de saúde, religião, política, orientação sexual, biometria ou dado de menor é **excluída do resumo** e não vira sugestão de venda.
6. **Direitos do titular** — `routes/privacy.ts` (export/delete) precisa cobrir as tabelas novas. Isso é item de checklist de merge, não de backlog.
7. **Transparência ao dono**: aviso no onboarding do módulo explicando que ele é o responsável pelo que lê, que participantes de grupo não consentiram com ele, e que o uso deve respeitar a finalidade original do grupo.
8. **Crianças e adolescentes** (art. 14): se a triagem detectar interlocutor menor, sem sugestão comercial.
9. **Retenção e trilha**: toda ação de envio disparada pelo Copiloto entra em `audit.ts` — quem, quando, qual sugestão, texto final.
10. **Política do WhatsApp**: o Copiloto não dispara mensagem não solicitada; toda mensagem é resposta a uma conversa iniciada pelo contato, dentro da janela. Isso mantém o produto do lado certo da linha que derrubou tantos bots em dez/2025.

**Recomendação forte:** a v1 sai com grupos **desligados por padrão** e com um
texto de consentimento revisado por advogado antes do GA. O resumo de grupo é o
recurso mais vendável e o mais arriscado — é exatamente por isso que ele não pode
ser o primeiro a subir sem revisão jurídica.

---

## 8. Encaixe comercial (`/adm` + `/mkt`)

### 8.1 Onde colocar no pricing

Tiers atuais (`billing.ts`): Profissional R$ 49/mês (Core + Atende), Empresas
R$ 99/mês (Core + Atende + CRM + Tarefas).

Custo variável de ~R$ 21/mês por usuário ativo **não cabe** no Profissional de
R$ 49 sem estrangular a margem. Três caminhos:

| Opção | Como | Margem | Risco |
|---|---|---|---|
| **A — Empresas** (recomendado) | `copiloto` entra no bundle do Empresas; vira o motivo de subir de R$49 → R$99 | Boa (R$ 99 − ~R$ 25 de custo total de IA) | Limita alcance |
| B — Add-on avulso | R$ 47/mês sobre qualquer tier | Ótima, mas exige nova SKU no checkout | Fricção de venda |
| C — Profissional | Incluir no R$ 49 | Ruim — margem some com 2+ grupos | Não recomendado |

**Recomendação: A, com teto de 3 grupos, e B como upgrade para quem quer mais
grupos.** O Copiloto é o argumento que faltava para o degrau Profissional →
Empresas: hoje esse degrau vende CRM e Tarefas (features), o Copiloto vende
*resultado* ("fecha mais e perde menos tempo").

### 8.2 Posicionamento e nome

- **Nome:** *ZapScript Copiloto*. "Copiloto" comunica exatamente a relação certa — quem pilota é o dono. Descarta "Agente IA" (genérico, saturado) e "Assistente" (passivo demais).
- **Promessa:** *"Ele lê tudo. Você só decide."*
- **ICP primário:** dono de negócio que vende por WhatsApp, com 20–80 conversas/dia, sem equipe comercial — exatamente quem já usa o Atende e ainda assim precisa entrar no chat.
- **Diferencial defensável:** o concorrente vende *bot que responde*. O Copiloto vende *julgamento*: nunca fala com o cliente, e por isso pode ser afiado sem risco. É a resposta direta ao medo nº 1 de quem não adota IA — "não quero um robô falando com meu cliente pelos meus clientes".
- **Gancho de conteúdo:** as etiquetas de técnica (`fechamento-assumido`, `ancoragem`) transformam o produto em micro-treinamento de vendas — e cada card vira post. Alinha com o silo de conteúdo já montado em `marketing/`.

### 8.3 Métricas que definem sucesso

| Métrica | Alvo v1 | Por quê |
|---|---|---|
| Taxa de adoção da sugestão (enviou 1/2/3) | > 35% | Abaixo disso, as opções não são boas |
| Taxa de edição antes de enviar | 30–50% | Zero = suspeito; > 70% = tom errado |
| Descarte de briefing | < 25% | Acima disso, a triagem está frouxa |
| Resposta do cliente após ação sugerida | > baseline do dono | É o valor real |
| Leitura do resumo de grupos | > 60% dos dias | Se não lê, não serve |
| Custo de IA / receita do tenant | < 25% | Margem |
| Desligamentos no 1º mês | < 10% | Ruído mata o produto |

---

## 9. Roadmap por fases (cada fase é entregável sozinha)

| Fase | Entrega | Critério de saída |
|---|---|---|
| **0 — Fundação** (1 sem) | Módulo no catálogo, schema + migration, gate, fila, config vazia em `/app/copiloto` | Módulo aparece, liga/desliga, nada quebra no Atende |
| **1 — Briefing** (1–2 sem) | Triagem + briefing + 3 opções, entrega por self-chat, resposta 1/2/3/0 | 10 usuários internos, adoção > 30% |
| **2 — Estilo** (1 sem) | `CopilotoStyleProfile`, espelho das mensagens do dono, tela editável | Taxa de edição cai entre semana 1 e 3 |
| **3 — Grupos** (1–2 sem) | Opt-in por grupo, ingestão, resumo diário, retenção | **Bloqueado por revisão jurídica** do consentimento |
| **4 — Resultado** (1 sem) | Outcome tracking, taxa por técnica, few-shot dos vencedores | Acerto por técnica visível no painel |
| **5 — Painel + GA** (1 sem) | Inbox web completo, métricas, pricing no checkout, landing | GA + campanha de upgrade |

Gate entre fases: só avança se a métrica da fase anterior bater. Um Copiloto que
notifica demais na fase 1 não melhora ao ganhar grupos na fase 3 — piora.

---

## 10. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| **Ruído** — notifica demais e o dono desliga | Alto (mata o produto) | Teto diário, silêncio, lote, triagem conservadora, "não fazer nada" como opção legítima |
| **Sugestão genérica** — "Olá, tudo bem?" | Alto | Eixos obrigatoriamente distintos; perfil de estilo; validador rejeita rascunho sem fato específico da conversa |
| **Alucinação de preço/prazo** | Alto (jurídico) | Fatos só da KB + validador determinístico + etiqueta de fonte |
| **Custo por usuário estoura** | Médio-alto | Tetos por plano, cache, Haiku na triagem, alerta a 25% da receita |
| **LGPD em grupos** | Alto | Opt-in por grupo, retenção curta, filtro de dado sensível, revisão jurídica antes do GA |
| **Loop de mensagens** | Médio | Nunca reagir a `fromMe` gerado pelo próprio Copiloto; `jobId` idempotente por `messageId` (padrão já usado no Atende) |
| **Confusão com o Atende** | Médio | Onboarding explícito: "o Atende fala com seu cliente; o Copiloto fala com você" |
| **Aprender o vício em vez do estilo** | Médio | Ponderar exemplos por resultado, não por frequência; perfil sempre visível e editável |
| **Grupo com 500 msgs/dia** | Médio | Amostragem + teto de tokens por grupo/dia |

---

## 11. Fora de escopo na v1 (explicitamente)

- Envio automático sem confirmação (`autoSend` fica no schema, desligado — só depois de 3 meses de dados de acerto).
- Ação no chat do grupo (ler e resumir apenas — provavelmente para sempre).
- Multicanal (Instagram, Telegram) — depende do módulo `multicanal`.
- Fine-tuning por tenant — o perfil versionado resolve o mesmo problema com custo e risco muito menores.
- Voz sintetizada do dono para responder áudio — alto risco de identidade, sem demanda validada.
- Copiloto para equipe (vários atendentes, roteamento) — depende de `teams`, fase posterior.

---

## 12. Decisões que precisam do dono do produto antes da Fase 1

1. **Pricing:** confirmar a opção A (bundle Empresas) da §8.1 — muda o checkout e a landing.
2. **Grupos na v1:** entram na Fase 3 com revisão jurídica, ou saem da v1 e viram v1.1?
3. **Canal padrão:** self-chat como principal (recomendado) ou painel-first?
4. **Agressividade padrão:** `equilibrado` como default (recomendado) ou `consultivo` para não assustar o ICP?

O resto do escopo pode ser executado sem bloqueio.

---

*Escopo produzido com as lentes `/dev` (arquitetura, dados, custo de execução),
`/adm` (LGPD, margem, operação) e `/mkt` (posicionamento, pricing, lançamento).*
