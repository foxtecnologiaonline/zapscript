# API — IA: chatbot, base de conhecimento e curadoria (`/balcao/kb`, `/balcao/ai`)

Frente **ai** (TR 1.1.3.1.5.1.1 chatbot, 1.1.3.1.5.2.1 curadoria, indicador IQA 07). Decisão de arquitetura: **D9** em
`ARQUITETURA.md` (KB aprovada + busca full-text do Postgres em português + LLM com resposta ancorada; **sem vetores/embeddings**).
Código em `apps/api/src/balcao/ai`:

| Arquivo | Papel |
|---|---|
| `bot.ts` | motor do chatbot (`analyzeMessage` = decisão; `applyAnalysis` = efeitos), `resumeAfterIdentity`, varredura de inativas, `startAiEngine` |
| `detect.ts`, `pii.ts` | detecções determinísticas (humano, palavras, sentimento, saudação, resolução) e redação de PII com reidratação |
| `search.ts`, `kb.ts` | busca FTS; ciclo de vida/versões/importação/feedback/revisão periódica |
| `prompt.ts`, `llm.ts`, `llmcall.ts` | prompts e schema zod da saída; fronteira `LlmClient`; chamada com validação, 1 retry e contabilização de uso |
| `assist.ts` | sugestão de resposta e resumo para o atendente |
| `curation.ts` | mineração/agrupamento/propostas, sugestões, métricas de curadoria |
| `stats.ts`, `config.ts`, `routes.ts`, `index.ts` | `/ai/stats`; campos extras de `settings.ai`; HTTP; plugin + jobs |

Testes: `apps/api/src/balcao/ai/__tests__/{kb,bot,curation}.test.ts` (52 casos; LLM sempre falso, nenhuma rede; cada teste cria o próprio órgão).
Autenticação: `Authorization: Bearer <JWT do Balcão>`. Erros: `{ error: { code, message } }`. Tudo é filtrado por `orgId` do token
(artigo de outro órgão = 404 `kb.not_found`).

## Permissões usadas

`kb:read` (ATENDENTE, SUPERVISOR, FISCAL, ADMIN) · `kb:write` (ATENDENTE+) · `kb:approve` (SUPERVISOR, ADMIN) · `report:read` (SUPERVISOR, FISCAL, ADMIN) ·
`conversation:reply` / `conversation:read` (+ acesso à conversa: `canAccessConversation`).

## Base de conhecimento — `/balcao/kb`

### Ciclo de vida

```
DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED ──archive──▶ ARCHIVED ──restore──▶ DRAFT
  ▲                    │  └──reject──▶ REJECTED ──submit──▶ PENDING_REVIEW        (arquivar vale p/ qualquer status ≠ ARCHIVED)
  └── editar REJECTED ─┘
```

* **Só `APPROVED` entra na busca e alimenta o bot.** Importação e sugestões da curadoria nunca publicam.
* Transição inválida → 409 `kb.invalid_transition` (as transições são atômicas: `updateMany` com `status IN (...)`).
* **Versionamento** (`BvKbArticleVersion`, 1 linha por versão com `snapshot`): cada edição que muda título/pergunta/resposta/categoria/tags
  incrementa `version` e grava o snapshot; edições concorrentes → 409 `kb.conflict`. `revert` cria uma **nova** versão com o conteúdo antigo.
* Editar `APPROVED` sem `kb:approve` ⇒ volta a `PENDING_REVIEW` (sai do bot até nova aprovação); com `kb:approve` permanece `APPROVED`
  e `nextReviewAt` é renovado. Editar `REJECTED` ⇒ volta a `DRAFT`. `ARCHIVED` não edita (409 `kb.archived`).
* Auto-aprovação (autor = aprovador) é permitida, mas gera `warnings: ["SELF_APPROVAL…"]` e auditoria `kb.self_approval` quando há outro supervisor/admin ativo.
* `nextReviewAt` = aprovação + 180 dias (ou `reviewInDays`, 7–1095). Job `balcao.ai.kb_review` notifica (`BvNotification` tipo `KB_REVIEW_DUE`
  + socket `notification`) supervisores/admins de artigos vencidos, **1 aviso por artigo/usuário a cada 7 dias**.

### Endpoints

| Método e path | Perm. | Corpo / query | Resposta |
|---|---|---|---|
| `GET /kb/articles` | kb:read | query `status, category, tag, source, q, limit(≤200), cursor` | `{ items: Article[], nextCursor }` |
| `POST /kb/articles` | kb:write | `{ title(3–200), question(3–1000), answer(3–8000), category?, tags?(≤20), language? }` | 201 `Article` (DRAFT, versão 1) |
| `GET /kb/articles/:id` | kb:read | — | `Article` |
| `PUT /kb/articles/:id` | kb:write | campos acima, parciais | `Article` (regras de edição acima) |
| `POST /kb/articles/:id/submit` | kb:write | — | `Article` PENDING_REVIEW (de DRAFT/REJECTED) |
| `POST /kb/articles/:id/approve` | kb:approve | `{ reviewInDays? }` | `Article` APPROVED + `warnings[]` |
| `POST /kb/articles/:id/reject` | kb:approve | `{ reason(3–1000) }` | `Article` REJECTED |
| `POST /kb/articles/:id/reviewed` | kb:approve | `{ reviewInDays? }` | `Article` (renova `nextReviewAt`, sem nova versão) |
| `POST /kb/articles/:id/archive` | kb:write (aprovado ⇒ kb:approve) | — | `Article` ARCHIVED |
| `POST /kb/articles/:id/restore` | kb:write | — | `Article` DRAFT |
| `POST /kb/articles/:id/feedback` | kb:read | `{ helpful: boolean, conversationId? }` | `Article`; `helpful` incrementa `helpfulCount`; ambos vão para auditoria `kb.feedback.helpful/unhelpful` |
| `GET /kb/articles/:id/versions` | kb:read | — | `{ items: Version[] }` (mais nova primeiro) |
| `POST /kb/articles/:id/revert` | kb:write | `{ version }` | `Article` (nova versão com o conteúdo antigo) |
| `GET /kb/search` | kb:read | `q(1–500), limit(≤50)` | `{ items: [{ id, title, question, snippet, category, tags, rank, via }] }` (só APPROVED) |
| `POST /kb/import` | kb:write | `{ articles: [...] }` (≤500) **ou** `{ format:'csv', csv }` (cabeçalhos `titulo/title, pergunta/question, resposta/answer, categoria/category, tags`; delimitador `,` ou `;`) | 201/200 `{ created, skipped, errors:[{row,message}], articleIds }` — entram `PENDING_REVIEW`, `source=IMPORT`; pergunta já existente é ignorada |
| `GET /kb/metrics` | kb:read | — | `{ byStatus, total, reviewDue, topUsed, totalUses, totalHelpful, helpfulRate, feedback30d }` |

### Busca (`search.ts`)

Sempre `WHERE orgId = $1 AND status = 'APPROVED'`, coluna `search` (tsvector `portuguese`, gerada no banco).
`/kb/search`: (1) `websearch_to_tsquery('portuguese', q)` ordenado por `ts_rank_cd`, (2) se vazio, tsquery OR dos termos, (3) se vazio, fallback
acento-insensível por termos (`LIKE`, `via:'like'`). O **bot** usa OR primeiro (perguntas em linguagem natural) e completa com o fallback.
Empates: `helpfulCount`, `updatedAt`. tsquery inválida nunca derruba o atendimento (cai para o próximo método).

## Chatbot

### Quando age

Evento `message.inbound` com `status = 'BOT'` e `settings.ai.enabled`. Conversas `WAITING/ACTIVE/CLOSED` nunca são tocadas pelo bot
(em `ACTIVE` só a assistência ao atendente). Mensagens da mesma conversa são serializadas; eventos obsoletos (já existe mensagem mais nova) são ignorados.
Em `NODE_ENV=test` o motor só liga com `BV_AI_AUTOSTART=on` ou chamando `startAiEngine()`.

### Pipeline por mensagem do cidadão (`analyzeMessage`)

1. Depois de uma resposta do bot: "obrigado/resolveu" → **RESOLVE** (fecha); "não resolveu" → escala `NOT_RESOLVED` (feedback negativo implícito).
2. Pedido de humano (`HUMAN_REQUEST`), palavra de escalonamento do órgão (`KEYWORD`), sentimento negativo com pontuação ≥ 2 (`NEGATIVE_SENTIMENT`) → escala **sem chamar o LLM**.
3. `PROGRESSIVE` e `botTurns ≥ maxBotTurns` → `MAX_TURNS`.
4. Só saudação → `PROGRESSIVE`: envia `welcomeMessage` (ou "Como posso ajudar?" se já saudou), custo zero; `ASSISTED`: escala para triagem.
5. **Redação de PII** (`PiiRedactor`): CPF/CNPJ (com dígito verificador), e-mail, telefone, cartão, nº de processo CNJ → `[CPF_1]`, `[EMAIL_1]`, `[TELEFONE_1]`, `[CNPJ_1]`, `[CARTAO_1]`, `[PROCESSO_1]`. Mensagem e histórico (últimas 8) são redigidos **antes** de qualquer chamada ao LLM. A resposta e os parâmetros de ferramenta são **reidratados** localmente.
6. **Recuperação** top-K (`BV_AI_TOPK`, padrão 4) por FTS; se a mensagem tem < 4 palavras, junta a última pergunta do cidadão.
7. **LLM** (tier `fast`), saída JSON validada com zod; 1 retry (com o erro no prompt) se a chamada falhar ou o JSON for inválido; depois disso escala (`LLM_ERROR`/`LLM_INVALID`). Cota `AI_CALLS` em modo BLOCK esgotada → `QUOTA`.
8. Política por modo (abaixo). Ids de artigo não fornecidos ao LLM são descartados (anti-alucinação).

### Modos (`settings.ai.mode`)

| Modo | Comportamento |
|---|---|
| `ASSISTED` (padrão) | **Triagem**: o bot nunca escreve ao cidadão. Classifica `intent/category`, marca `botHandled`, guarda a resposta sugerida como evento `AI_SUGGESTION` (`kind:'TRIAGE'`, texto cifrado) e escala (`ASSISTED_TRIAGE`) para o atendente. |
| `PROGRESSIVE` | Responde sozinho **se** a resposta é ancorada (≥ 1 artigo usado, ferramenta, ou intenção de conversa social) **e** `confidence ≥ confidenceThreshold` **e** `needsHuman=false`. Senão escala avisando o cidadão (`handoffMessage`): `LLM_NEEDS_HUMAN`, `NO_ARTICLE`, `LOW_CONFIDENCE`, `TOOL_UNKNOWN`, `LLM_INVALID`… |

Motivos de escalonamento (`ESCALATED.data.reason`): `HUMAN_REQUEST, KEYWORD, NEGATIVE_SENTIMENT, NOT_RESOLVED, MAX_TURNS, LOW_CONFIDENCE, NO_ARTICLE, LLM_NEEDS_HUMAN, LLM_INVALID, LLM_ERROR, QUOTA, NON_TEXT, TOOL_ERROR, TOOL_UNKNOWN, ASSISTED_TRIAGE, BOT_STALLED`.

### Marcas na conversa e na mensagem

* Conversa: `botHandled=true`, `intent`, `category`, `automatable` (= usou artigo da KB ou ferramenta), `resolvedByBot` e `firstContactResolved` (ao fechar, pelo `closeConversation`).
* Mensagem do bot: `aiMeta = { kind, intent, confidence, kbArticleIds, model, tokens:{in,out}, mode, inReplyTo }`; `kind ∈ ANSWER | TOOL | WELCOME | FAREWELL | HANDOFF | AUTH_REQUIRED | IDENTITY_FOLLOWUP`.
* Eventos da conversa: `BOT_WELCOME, BOT_REPLY, BOT_TOOL (sem dados do retorno), BOT_AUTH_REQUIRED, BOT_IDENTITY_RESUMED, BOT_IDENTITY_INSUFFICIENT, BOT_IDLE_CLOSE, AI_SUGGESTION, ESCALATED`.
* Uso: cada chamada ao LLM soma 1 em `AI_CALLS`; tokens (reais do provedor; estimados `≈ chars/4` quando ausentes) em `AI_TOKENS`.

### Ferramentas (`core/tools.ts`) e identidade

A frente de integrações registra ferramentas (`registerBotTool`); o prompt lista nome, descrição, schema e `minIdentityLevel`. O bot **nunca** executa uma ferramenta se
`identitySatisfies(nível, minIdentityLevel)` falha — nível = o maior entre `conversation.metadata.identityLevel`, `metadata.govbr.level` e `contact.govbrLevel`:

* nível insuficiente → `AUTH_REQUIRED`: chama a ferramenta `identity.request_login` (se registrada) e envia o link; evento `BOT_AUTH_REQUIRED` guarda `{tool, need, have, inputEnc}` (entrada **cifrada**).
* ok → executa (timeout 20 s), responde com o retorno da ferramenta **sem devolvê-lo ao LLM** (dados do processo não vão a terceiros); falha/vazio → escala `TOOL_ERROR`.
* **`identity.verified`** (emitido pelo GOV.BR): se a conversa ainda está `BOT` e o modo é `PROGRESSIVE`, `resumeAfterIdentity`: com pedido pendente (último `BOT_AUTH_REQUIRED` sem `BOT_REPLY/BOT_TOOL/ESCALATED/BOT_IDENTITY_RESUMED` depois) e nível agora suficiente → **reexecuta a ferramenta com a entrada original**; nível ainda insuficiente → avisa o nível exigido (e a consulta continua pendente); sem pedido pendente → "Identidade confirmada, obrigado! Como posso ajudar?". Conversa fora de `BOT` ou modo `ASSISTED` → nada.

### Fechamento por resolução e varredura de inatividade

* "Obrigado/resolveu/ok…" curto e sem pergunta, logo após uma resposta do bot → envia despedida e `closeConversation(RESOLVED, resolvedByBot=true)` (que também pede CSAT); registra feedback "útil" implícito nos artigos da última resposta.
* Job `balcao.ai.idle_sweep` (a cada 60 s): (1) última mensagem é **resposta do bot** e o cidadão ficou `idleCloseMinutes` (padrão 15) sem voltar → fecha como `RESOLVED/resolvedByBot` (**o silêncio após resposta conta como resolvido** — premissa a validar com o fiscal); (2) última mensagem é do cidadão e o bot não respondeu em `BV_AI_STALL_MINUTES` (padrão 5) → escala `BOT_STALLED` (rede de segurança).

## Assistência ao atendente (nunca envia ao cidadão)

* `message.inbound` em conversa `ACTIVE` com atendente atribuído e `settings.ai.agentAssist ≠ false` → `suggestReply`: grava evento `AI_SUGGESTION` (`kind:'AGENT_ASSIST'`, texto cifrado) e emite no socket `/bv` o evento **`ai:suggestion`** para o usuário atribuído.
* Payload `ai:suggestion`: `{ suggestion, confidence, articles:[{id,title}], model, conversationId, messageId }`.

| Método e path | Perm. | Corpo | Resposta |
|---|---|---|---|
| `POST /ai/suggest` | conversation:reply (+ acesso à conversa) | `{ conversationId }` | `Suggestion` (não emite socket; 409 `ai.no_message`; 502 `ai.llm_*` se a IA falhar) |
| `POST /ai/summarize` | conversation:reply (+ acesso) | `{ conversationId }` | `{ summary, intent, pending[], keyFacts[], model }` (últimas 30 mensagens, PII redigida e reidratada) |
| `GET /ai/conversations/:id/suggestion` | conversation:read (+ acesso) | — | `{ suggestion: { kind, suggestion, intent, category, confidence, articleIds, at } \| null }` (triagem do bot ou assistência) |

## Curadoria

Job diário `balcao.ai.curation` (órgãos com IA habilitada) ou manual (`POST /kb/curation/run`). A curadoria **só sugere** — publicar exige o fluxo normal e `kb:approve`.

1. **Conversas sem cobertura** (janela `BV_AI_CURATION_DAYS`, padrão 30, ≤ 500): `botHandled ∧ ¬automatable ∧ ¬resolvedByBot ∧ intent≠saudacao`, ou atendimento 100% humano já encerrado.
2. **Agrupamento** da 1ª pergunta do cidadão (PII redigida; tokens normalizados, sem palavras de pedido): leitura gulosa, similaridade = `max(cosseno TF-IDF, Jaccard)` ≥ 0,35; clusters com ≥ `minCluster` (2) conversas.
3. **Tipo**: já existe sugestão aberta parecida (Jaccard ≥ 0,5) → só atualiza a evidência; foi aceita/descartada nos últimos 60 dias (≥ 0,6) → ignora; artigo APPROVED parecido (Jaccard ≥ 0,4) → `IMPROVE` (com `articleId`); há respostas de atendentes e não há artigo parecido → chama o **LLM forte** (`tier:'strong'`, label `bv.curation`) para propor `{title, question, answer, category, tags}` a partir **apenas** das respostas reais (→ `NEW_ARTICLE`, `proposedAnswer`, `evidence.proposal.requiresHumanReview=true`); sem respostas ou LLM indisponível → `GAP`.
4. **AMBIGUITY**: (a) mesma intenção com respostas de atendentes divergentes (≥ 3 conversas, similaridade média < 0,25); (b) artigos APPROVED concorrentes (Jaccard ≥ 0,6 em título+pergunta); (c) ≥ 3 escalonamentos `LOW_CONFIDENCE` na mesma intenção.
5. **Evidência** (`BvKbSuggestion.evidence`): `conversationIds, count, sampleMessages (≤5, PII redigida), key, hasAgentAnswers, proposal`. Nenhum texto bruto do cidadão é guardado na sugestão.

| Método e path | Perm. | Corpo / query | Resposta |
|---|---|---|---|
| `GET /kb/suggestions` | kb:read | `status(OPEN\|ACCEPTED\|DISMISSED, padrão OPEN), type, limit` | `{ items: Suggestion[] }` (com `evidenceCount`) |
| `POST /kb/suggestions/:id/accept` | kb:write | `{ title?, question?, answer?, category?, tags?, submitForReview? }` | `{ suggestion, articleId }` — cria artigo `DRAFT` (ou `PENDING_REVIEW`) `source=CURATORSHIP`; `AMBIGUITY` só é marcada como tratada; sem proposta exige `answer` (400 `kb.answer_required`); já tratada → 409 |
| `POST /kb/suggestions/:id/dismiss` | kb:write | `{ reason? }` | `Suggestion` |
| `POST /kb/curation/run` | kb:approve | `{ days?, minCluster?, propose? }` | `{ analyzed, clusters, created, updated, ambiguities, proposals, suggestionIds }` |
| `GET /kb/curation/stats` | kb:read | `days (padrão 30)` | ver abaixo |

`/kb/curation/stats`: `{ windowDays, botConversations, coverage, containment, suggestions:{open,accepted,dismissed}, topGaps:[{id,type,question,count}] (5), curationHoursEstimated, contractedHoursPerMonth:40, assumptions }`.
`coverage` = conversas do bot com `automatable` ÷ conversas com `botHandled`; `containment` = `resolvedByBot` ÷ `botHandled`.
`curationHoursEstimated` é **estimativa** `((aceitas+descartadas) × 12 min + artigos CURATORSHIP × 20 min) ÷ 60` (`BV_AI_CURATION_MIN_PER_SUGGESTION`, `BV_AI_CURATION_MIN_PER_ARTICLE`), não horas apontadas.

## Configuração, testes e estatísticas

| Método e path | Perm. | Corpo | Resposta |
|---|---|---|---|
| `GET /ai/config` | kb:read | — | `{ enabled, mode, confidenceThreshold, welcomeMessage, escalationKeywords, maxBotTurns, agentAssist, idleCloseMinutes, handoffMessage }` |
| `PUT /ai/config` | kb:approve | qualquer subconjunto (estrito): `enabled, mode(ASSISTED\|PROGRESSIVE), confidenceThreshold(0–1), welcomeMessage, escalationKeywords(≤50), maxBotTurns(1–30), agentAssist, idleCloseMinutes(1–1440), handoffMessage` | config nova; grava `updateOrgSettings`, auditoria `config.update` (antes/depois) e `recordConfigVersion('ai.config')` |
| `GET /ai/stats` | report:read | `days (padrão 30)` | ver IQA abaixo |
| `POST /ai/test` | kb:read | `{ message, mode?, identityLevel?, history? }` | **modo seco**: `{ dryRun:true, mode, action, reason, answer, confidence, intent, category, automatable, articles, usedArticleIds, tool, model, tokens, piiRedacted, retrieved }` — usa a KB real do órgão e **consome AI_CALLS/AI_TOKENS**, mas não cria conversa, não envia, não escala (auditoria `ai.test`). `answer` traz a sugestão no modo ASSISTED |

### `/ai/stats` e a definição do IQA

Janela: conversas com `startedAt` nos últimos `days` e `botHandled = true`.

* `conversations`: `botHandled`, `resolvedByBot`, `escalated` (eventos `ESCALATED` na janela); `escalationsByReason`.
* `containmentRate` = `resolvedByBot ÷ botHandled`.
* `accuracy`: `helpful`/`unhelpful` (auditoria de feedback, inclui o implícito), `rate = helpful ÷ (helpful+unhelpful)`, CSAT médio das resolvidas pelo bot.
* `usage`: `AI_CALLS` e `AI_TOKENS` da janela.
* **`iqa07`** (indicador 07 do TR — % de atendimentos via chatbot resolvidos no 1º contato e classificados como automatizáveis; metas 40% → 60% → 80%):
  * numerador = nº de conversas **`CLOSED`** com `botHandled ∧ resolvedByBot ∧ firstContactResolved ∧ automatable`;
  * `iqa07.value` = numerador ÷ nº de conversas `CLOSED` com `botHandled ∧ automatable` (fórmula desta frente: "dos automatizáveis, quantos o bot resolveu no 1º contato");
  * `iqa07.perBotAttendance` = numerador ÷ nº de conversas `CLOSED` com `botHandled` (leitura literal do edital: denominador = todos os atendimentos via bot).
  * `resolvedByBot` e `firstContactResolved` vêm de `closeConversation`: `firstContactResolved` = motivo `RESOLVED` ∧ sem outra conversa **fechada** do mesmo contato (e da mesma categoria, se houver) nos 7 dias anteriores ∧ `transferCount = 0`. `automatable` = o bot respondeu usando artigo da KB ou ferramenta.
  * **Atenção — duas fórmulas no sistema**: o painel do fiscal (`balcao/reports/metrics.ts`) calcula `iqaRate` = numerador ÷ atendimentos "via chatbot" (`botHandled OR resolvedByBot`), sem filtrar por `CLOSED`/`automatable` no denominador — equivalente a `perBotAttendance` (salvo conversas ainda abertas). **Para glosa/atesto vale o relatório da frente reports**; `iqa07.value` daqui é indicador operacional (parcial). A decisão de qual denominador o fiscal adota deve ser formalizada.

## Eventos

* Assina: `message.inbound` (BOT → chatbot; ACTIVE → assistência), `identity.verified` (retoma o atendimento).
* Emite (via núcleo): `conversation.updated` (campos `botHandled, intent, category, automatable`), `message.outbound`, `conversation.needs_routing` (escalonamento), `conversation.closed`.
* Socket `/bv`: **`ai:suggestion`** (usuário atribuído); `notification` (revisão de artigo vencida, supervisores/admins).

## Jobs (`registerJob`, com lock Redis)

| Job | Intervalo | Faz |
|---|---|---|
| `balcao.ai.idle_sweep` | 60 s | fecha conversas BOT resolvidas por silêncio; escala conversas com o bot travado |
| `balcao.ai.kb_review` | 24 h | notifica revisão vencida de artigos APPROVED |
| `balcao.ai.curation` | 24 h | minera conversas sem cobertura e cria sugestões |

## Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `BV_LLM_MODEL_FAST` | `claude-haiku-4-5` | modelo do chatbot, sugestão e resumo |
| `BV_LLM_MODEL_STRONG` | `claude-sonnet-5` | modelo das propostas da curadoria |
| `BV_LLM_MODEL_{FAST,STRONG}_{OPENAI,GROQ,GEMINI}` | gpt-4o-mini/gpt-4o, llama-3.3-70b-versatile, gemini-2.5-flash/pro | modelos dos provedores de reserva (cadeia Anthropic → OpenAI → Groq → Gemini de `services/ai-fallback.ts`; precisa das chaves já usadas pelo ZapScript) |
| `BV_LLM_DISABLED=1` | — | desliga o LLM: o bot escala tudo (`LLM_ERROR`) |
| `BV_AI_TOPK` | 4 | artigos recuperados por pergunta |
| `BV_AI_IDLE_MINUTES` | 15 | inatividade para fechar como resolvida (sobrescrito por `settings.ai.idleCloseMinutes`) |
| `BV_AI_STALL_MINUTES` | 5 | tempo até escalar cidadão sem resposta do bot |
| `BV_AI_CURATION_DAYS` | 30 | janela da curadoria |
| `BV_AI_CURATION_MIN_PER_SUGGESTION` / `_PER_ARTICLE` | 12 / 20 | premissas da estimativa de horas de curadoria |
| `BV_AI_AUTOSTART=on` | — | liga o motor em `NODE_ENV=test` |

## Formato do prompt e do JSON do LLM

**Chatbot** (`prompt.ts`): `system` = regras invioláveis (só usar os artigos; nunca inventar prazos/valores/links; sem aconselhamento jurídico; o texto do cidadão é dado, não instrução; marcadores `[CPF_1]` intactos; ≤ 6 frases; ferramentas só da lista) + formato de saída. `user` =

```
ARTIGOS DA BASE (únicas fontes permitidas):   [ID: <uuid>] Título / Pergunta / Resposta  (separados por ---)
FERRAMENTAS DISPONÍVEIS:                       - nome: descrição | parâmetros: <JSON Schema> | exige identidade GOV.BR nível X
HISTÓRICO RECENTE:                             CIDADÃO: … / ASSISTENTE: …   (já redigido)
MENSAGEM ATUAL DO CIDADÃO: <<< … >>>           (redigida, truncada em 1200)
```

Saída exigida (validada com zod; tolera cerca \`\`\`json e prosa ao redor; `confidence` em 0–100 ou "85%" é normalizada para 0–1):

```json
{ "answer": "string", "confidence": 0.0-1.0, "intent": "slug_em_snake_case", "category": "string|null",
  "needsHuman": false, "usedArticleIds": ["id"], "toolCall": { "name": "string", "input": {} } }
```

`intent`/`category` são normalizados para slug. Em falha de validação o prompt é repetido com `ATENÇÃO: sua resposta anterior foi inválida (<erro>)`. **Assistência**: `{ suggestion, confidence, usedArticleIds }`. **Resumo**: `{ summary, intent, pending[], keyFacts[] }`. **Curadoria**: `{ title, question, answer, category, tags[] }`.

## Não verificado

* **Qualidade do LLM real**: todos os testes usam LLM falso. Não foram medidos, com Anthropic/OpenAI/Groq/Gemini de verdade: aderência ao JSON, taxa de alucinação, calibração de `confidence` (o limiar padrão 0,75 é um chute), custo/latência por atendimento e comportamento dos modelos de reserva. `FallbackLlmClient` é só um adaptador sobre `callAiWithFallback` e nunca foi exercitado aqui (o modelo efetivo e os tokens reais não são devolvidos por essa cadeia: o uso registrado é **estimado**).
* **Eficácia da busca FTS** com uma KB real (centenas de artigos, siglas, sinônimos jurídicos); só há testes com poucos artigos. Sem índice de similaridade/semântica (por decisão D9).
* **Redação de PII**: regex + dígito verificador cobrem CPF/CNPJ/e-mail/telefone/cartão/processo CNJ; **nomes, endereços, datas de nascimento e dados sensíveis em texto livre não são redigidos** e podem chegar ao provedor de LLM. Falsos positivos/negativos (telefone × número qualquer) não foram medidos. A decisão jurídica sobre enviar texto (mesmo redigido) a provedores no exterior (LGPD, residência de dados) é do órgão.
* **Detecção de sentimento/humano/resolução** é léxica (pt-BR coloquial, sem gírias regionais, ironia ou erros de digitação extremos); calibração com conversas reais pendente. "Silêncio após resposta = resolvido" infla a contenção e o IQA se o cidadão apenas desistiu.
* **IQA**: duas fórmulas coexistem (ver acima); a oficial para glosa precisa ser confirmada com o fiscal. `automatable` é uma heurística (resposta ancorada), não uma classificação de negócio.
* **Curadoria**: limiares de similaridade (0,35/0,5/0,6/0,4/0,25) escolhidos nos testes sintéticos, sem ajuste em tráfego real; `curationHoursEstimated` é estimativa; carga com milhares de conversas (limites de 500/300/1000 por execução) não foi testada.
* **Retomada pós-identidade** (`identity.verified`): testada com ferramenta falsa; não foi integrada ponta a ponta com o fluxo GOV.BR real nem com a ferramenta `eproc.*` de produção. Só retoma o último pedido pendente, em `PROGRESSIVE`.
* **Canais**: o texto do bot é enviado pelos senders registrados (WhatsApp/webchat/e-mail); formatação e limites de tamanho por canal não foram validados. Voz não é atendida pelo bot.
* **Concorrência multi-instância**: a serialização por conversa é em memória (por processo); com várias réplicas da API duas respostas simultâneas à mesma conversa são evitadas só pela checagem "mensagem mais nova" — não há lock distribuído. Os jobs usam lock Redis.
* **Desempenho/carga** e **acessibilidade** das telas (frente web) não fazem parte desta entrega.
