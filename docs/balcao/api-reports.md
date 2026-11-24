# Balcão Virtual — API de relatórios, painel do Fiscal e exportação para BI

Frente **reports** (`apps/api/src/balcao/reports`). Todas as rotas ficam sob `/balcao` (ex.: `GET /balcao/reports/overview`).
Autenticação: JWT do Balcão **ou** token de API `bvt_…` (ver "Token de API"). Todas as consultas filtram por `orgId` do chamador.

## 1. Convenções

- **Período**: `from`/`to`. `YYYY-MM-DD` = dia no **fuso do órgão** (`settings.timezone`, padrão `America/Araguaina`); `to` em data simples é **inclusivo** (vira o início do dia seguinte, exclusivo). `YYYY-MM-DDTHH:mm` sem fuso = hora local do órgão; ISO com `Z`/offset = absoluto. Padrão: últimos 30 dias até agora. Máximo 800 dias.
- **Coorte**: todas as métricas de conversa consideram as conversas **iniciadas** (`startedAt`) no período. Atendente = `assignedUserId` atual da conversa.
- **Filtros** (lista separada por vírgula): `channel` (WHATSAPP,WEBCHAT,EMAIL,VOICE), `queueId`, `agentId`, `category`. Valores fora da lista → 400.
- **`?format=csv`**: UTF-8 **com BOM**, separador `;`, fim de linha CRLF, cabeçalhos em português, decimais com vírgula, texto iniciado por `= + - @ TAB CR` recebe prefixo `'` (anti CSV-injection). Valor `null` = célula vazia.
- Erros: `{ "error": { "code", "message", "details?" } }`.

## 2. Fórmulas (definição exata)

Segundos arredondados a 1 casa; percentuais a 2 casas. Percentis = interpolação linear (`percentile_cont`).

| Métrica | Definição |
|---|---|
| `total` | conversas iniciadas no período |
| `closed` / `open` | `status = CLOSED` / demais |
| **TME** (`tme*`) | `firstResponseAt − startedAt` (1ª resposta **humana**), só conversas com `firstResponseAt ≥ startedAt`; Avg, P50, P90, Max, Count |
| Espera em fila (`queueWait*`) | `assignedAt − queuedAt` (ambos preenchidos, ≥ 0) |
| **TMA** (`tma*`) | `closedAt − assignedAt`, conversas `CLOSED` com atribuição |
| **TMR** (`tmr*`) | `closedAt − startedAt`, todas as `CLOSED` (inclui bot e abandono) |
| `abandoned` / `abandonRate` | `closeReason = ABANDONED` ÷ encerradas exceto `SPAM` |
| `botInvolved` | `botHandled OR resolvedByBot` ("via chatbot") |
| `botContainmentRate` | `resolvedByBot` ÷ `botInvolved` |
| **FCR** `fcrRate` | `firstContactResolved = true` ÷ encerradas com `closeReason = RESOLVED` |
| **SLA** | Base 1ª resposta: `slaFirstResponseDueAt` definido e (respondida **ou** prazo já vencido); cumprida se `firstResponseAt ≤ prazo`. Base resolução: idem com `slaResolutionDueAt`/`closedAt`. `slaBase` = conversas em qualquer base; `slaViolations` = base ∧ (1ª resp. fora do prazo ∨ resolução fora do prazo ∨ `slaBreached`); `slaRate = 100 − violações ÷ base`; `slaFirstResponseRate`, `slaResolutionRate` separados |
| **NPS** | respostas = `csatScore` 0–10; promotores 9–10, neutros 7–8, detratores 0–6; `nps = (%prom − %detr)` (−100…100); `csatAvg` = média das notas; `distribution` 0–10 |
| **IQA** `iqaRate` — **fórmula única** (`computeIqa` em `metrics.ts`) | TR 18.1, indicador 07: "percentual de atendimentos via chatbot resolvidos no primeiro contato e classificados como automatizáveis". **Numerador** = atendimentos via chatbot (`botHandled ∨ resolvedByBot`) com `resolvedByBot ∧ firstContactResolved ∧ automatable` (`iqaCount`). **Denominador** conforme `settings.iqa.denominator`: **`ALL_BOT`** (padrão) = todos os atendimentos via chatbot do período (`botInvolved`, abertos inclusive); **`AUTOMATABLE`** = só os via chatbot classificados como automatizáveis (`iqaAutomatableBase`). Valor em % (0–100, 2 casas); denominador 0 → `null`. `aggregate('iqaRate')`, `/reports/iqa`, `/reports/overview`, o relatório mensal **e `GET /ai/stats`** (frente `ai`) usam exatamente essa função — não há outra fórmula no sistema. `resolvedOfAutomatable` = numerador ÷ `automatable` continua exposto só como informação |
| IQA por mês de contrato | mês 1 começa em `settings.contract.startDate` (JSON bruto do órgão; padrão = data local da 1ª conversa), meses de calendário a partir dessa data. Metas por mês de contrato em `settings.iqa.goals = [{fromMonth, goalPct}…]` (padrão `[{1,40},{4,60},{7,80}]` = meses 1–3 → 40%, 4–6 → 60%, ≥ 7 → 80%; precisa conter `fromMonth: 1`) |
| Glosa IQA | só em mês **encerrado**. Se `valor ≥ meta` → 0%. Senão pela distância (p.p.) abaixo da meta: ≤ 10 → 10%; ≤ 20 → 15%; > 20 → 20% (padrão). Faixas em `settings.iqa.glosa = [{maxGapPp, glosaPct}…]` (`maxGapPp: null` = demais; ordenadas por `maxGapPp`); `settings.contract.iqaGlosaBands` (legado) vale se `iqa.glosa` não existir. **Interpretação nossa — confirmar com o contrato.** |
| Produtividade (`/agents`) | métricas por atendente + `simultaneousPeak/Avg` (varredura +1/−1 sobre `[assignedAt, closedAt\|agora]`; média ponderada pelo tempo com ≥ 1 conversa) + `busySeconds` (tempo com ≥ 1 conversa; **aproximação** do tempo online, pois não há histórico de presença) + presença atual |
| Voz (`/voice`) | chamadas, recebidas/realizadas, atendidas (`answeredAt`), `abandonRate` = `ABANDONED` ÷ recebidas, minutos falados (`Σ durationSec/60` das atendidas), duração Avg/P50/P90, espera até atender (`answeredAt − startedAt`), gravações e bytes, **pico simultâneo** |

## 3. Endpoints de relatório (`report:read`)

| Método e rota | Descrição |
|---|---|
| `GET /reports/definitions` | catálogo: métricas, dimensões, filtros, presets, limites |
| `GET /reports/overview` | KPIs gerais + volume por canal e por hora do dia. `compare=true` traz `previous` e `comparison` (delta e %) |
| `GET /reports/timeseries?granularity=hour\|day\|week\|month&metrics=a,b` | série (só intervalos com dados; datas no fuso do órgão) |
| `GET /reports/agents` · `/queues` · `/channels` | por atendente / fila / canal |
| `GET /reports/nps` | resumo, distribuição 0–10, por fila/atendente/canal e série |
| `GET /reports/sla` | resumo, por fila, por dia e lista de violações (até 100) |
| `GET /reports/iqa[?startDate=YYYY-MM-DD][&format=csv]` | IQA por mês de contrato com meta e glosa. Resposta: `{ indicator, definition, denominator: 'ALL_BOT'\|'AUTOMATABLE', goals: [{fromMonth, months, goalPct}], glosaBands: [{maxGapPp, glosaPct}], contract: {startDate, source}, months: [{contractMonth, from, to, botInvolved, resolvedByBot, firstContactResolved, automatable, numerator, denominator, denominatorKind, value, goal, reachedGoal, gapPp, glosaPct, resolvedOfAutomatable}] }` (`value`/`goal` em %; `denominator` = base **efetiva** do cálculo) |
| `GET /reports/iqa/config` | `{ denominator, goals: [{fromMonth, goalPct}], glosa: [{maxGapPp, glosaPct}] }` efetivos (padrão aplicado) |
| `PUT /reports/iqa/config` (**`org:manage`**, ADMIN) | corpo estrito, todos opcionais: `{ denominator?: 'ALL_BOT'\|'AUTOMATABLE', goals?: [{fromMonth ≥ 1, goalPct 0–100}] \| null, glosa?: [{maxGapPp \| null, glosaPct 0–100}] \| null }`; `goals` exige `fromMonth: 1`; `glosa` exige exatamente uma faixa final com `maxGapPp: null`; `null` volta ao padrão. Responde com a config efetiva; auditoria `config.update` (`iqa.config`) + `recordConfigVersion('iqa.config')`. 400 `report.invalid_iqa_config` / `validation.failed` |
| `GET /reports/filters[?includeInactive=true]` | opções dos selects de filtro do Painel do Fiscal (que não tem `conversation:read` para listar filas/atendentes): `{ queues: [{id, name, active}], agents: [{id, name, active}] }` — filas **ativas** e usuários `ATENDENTE`/`SUPERVISOR` **ativos** do órgão, ordenados por nome, **sem e-mail**; `includeInactive=true` inclui os inativos (filtrar por atendente que saiu). Perm. `report:read` (SUPERVISOR, FISCAL, ADMIN; ATENDENTE → 403). Os `id` valem em `queueId`/`agentId` dos demais relatórios |
| `GET /reports/voice` | totais, por dia, por atendente, pico simultâneo |
| `GET /reports/realtime[?atRiskSec=120]` | instantâneo: `waiting`, `inService`, `withBot`, `longestWaitSec`, `slaAtRisk` (1ª resposta vence em ≤ `atRiskSec`), `slaBreachedOpen`, `activeCalls`, agentes (online/ocupado/ausente + carga) e por fila |
| `POST /reports/custom[?format=csv]` | relatório personalizado (abaixo) |

**Socket (opcional)**: com `BV_REPORTS_REALTIME_MS ≥ 1000` o job `balcao.reports.realtime` emite `report:realtime` (mesmo payload de `/reports/realtime`) na sala de supervisores `bv:sup:<orgId>` do namespace `/bv`, apenas para órgãos com supervisor conectado.

### Relatório personalizável

`POST /reports/custom`
```json
{ "metrics": ["total","tmeAvg","nps"], "groupBy": ["channel","day"],
  "filters": { "channel": ["WHATSAPP"], "queueId": ["…"], "agentId": [], "category": [], "closeReason": [], "status": [] },
  "period": { "preset": "LAST_30_DAYS" },            // ou { "from": "2026-11-01", "to": "2026-11-30" }
  "orderBy": { "key": "total", "dir": "desc" }, "limit": 1000 }
```
Presets: `TODAY, YESTERDAY, LAST_7_DAYS, LAST_30_DAYS, MONTH_TO_DATE, PREVIOUS_WEEK, PREVIOUS_MONTH`. Dimensões: `channel, queue, agent, category, closeReason, status, datetime, day, week, month, hourOfDay, weekday` (até 2). Métricas: ver `/reports/definitions` (até 20). O schema é **estrito**: qualquer métrica/dimensão/filtro/campo fora da allowlist → 400. Nunca há SQL livre; as expressões vivem em `reports/metrics.ts`.

### Salvos e agendamento (`BvReportSchedule`, `reportType = CUSTOM`)

- `GET /reports/saved` (report:read) · `POST /reports/saved` · `PUT /reports/saved/:id` · `DELETE /reports/saved/:id` · `POST /reports/saved/:id/run[?send=true]` (report:export).
- Corpo: `{ name, description?, definition, schedule?: { frequency: DAILY|WEEKLY|MONTHLY, format: CSV|JSON, recipients: [e-mail ≤ 20], hour (0–23, padrão 6), weekday (0–6, padrão 1), dayOfMonth (1–28), active } }`. A definição fica em `params.definition`; se houver agendamento e a definição não trouxer `period`, usa `YESTERDAY` / `PREVIOUS_WEEK` / `PREVIOUS_MONTH` conforme a frequência. `PUT … { schedule: null }` remove o agendamento.
- **Job `balcao.reports.schedule`** (a cada 60 s, lock Redis): pega agendamentos vencidos (`nextRunAt ≤ agora`), **reivindica** a ocorrência com `UPDATE … WHERE nextRunAt = <valor lido>` (só uma instância vence) e usa a chave `<scheduleId>:<nextRunAt>` — um `BvExportJob` (type REPORT, `params.runKey`) por ocorrência, nunca duas. O arquivo (CSV/JSON) é gravado em `core/storage` (`<orgId>/exports/...`), com `sha256`, tamanho e expiração de 180 dias. O e-mail leva **link autenticado** (`/balcao/reports/exports/:id/download`) e uma prévia de 15 linhas (sem anexo: `sendEmail` não suporta). Falha no e-mail não refaz o arquivo (registrada em `params.mail`/`error`).
- `GET /reports/exports` lista arquivos gerados; `GET /reports/exports/:id/download[?format=csv]` baixa (header `x-content-sha256`, auditado).

### Relatório mensal da contratada (TR 8.2.9)

`POST /reports/monthly {"month":"2026-11"}` (report:export) gera e grava **dois** `BvExportJob`: JSON (documento) e CSV (`Seção;Item;Valor;Unidade`), responde `201` com o documento, `jobId`, `csvJobId`, sha256. Conteúdo: licenças em uso (atendentes/supervisores = usuários distintos com sessão, login ou atendimento no mês), mensageria por item (7, 8, 9, e-mail, webchat, IA), armazenamento (máx. do mês), voz (minutos, chamadas, pico de canais), atendimentos por canal, indicadores (NPS, TME, TMA, TMR, FCR, SLA, contenção, **IQA com meta e glosa** do mês de contrato), service desk (`BvTask` criadas por `kind`/`status`, concluídas no mês) e horas de `settings.contract.hours` (ex.: `{"curadoria":12,"integracao":8,"treinamento":4}`). Repetir gera novos arquivos.

## 4. Exportação para BI (token de API `report:read`)

`GET /reports/export/{conversations|messages-meta|calls|tasks|nps}?from&to&cursor&limit(≤5000, padrão 1000)&format=ndjson|json|csv`

- Paginação **keyset** por (data, id); o cursor vem no header `x-next-cursor` (e `x-has-more`) e, em `format=json`, no corpo `{ dataset, count, nextCursor, data[] }`. Cursor vazio = fim. Cursor inválido → 400.
- **Sem conteúdo de mensagem e sem PII**: apenas ids/códigos, datas ISO (UTC) e métricas (`tmeSec`, `tmaSec`…). Não saem nome, e-mail, telefone/número de chamada, assunto, comentário de NPS, `channelRef`, título/descrição de tarefa.
- CSV de exportação: BOM, `;`, cabeçalho = nome estável do campo, **ponto** decimal e booleanos `true`/`false` (máquina; os CSV "humanos" usam vírgula e `sim`/`não`). Cada leitura é auditada (`report.export`).
- Token: criado por quem administra (tabela `BvApiToken`, só o hash é guardado) com `scopes: ["report:read"]`. Um token com só esse escopo **lê** `/reports/*` (GET e `POST /reports/custom`), mas recebe 403 em `/fiscal/*`, `POST /reports/saved|monthly` e cotas (escopos `fiscal:read`, `report:export`, `quota:manage` são separados).

### Power BI
1. *Obter dados → Web* (modo avançado), URL `https://api.zapscript.me/balcao/reports/export/conversations?from=2026-01-01&to=2026-12-31&format=json&limit=5000`, cabeçalho `Authorization: Bearer bvt_…`.
2. Para paginar use `List.Generate` encadeando `nextCursor` do JSON (`&cursor=<nextCursor>`) até vir `null`. Expanda `data`. Para atualização agendada no serviço, use "credenciais anônimas" + cabeçalho no M (ou um gateway) e janelas `from/to` curtas.
3. `format=csv` também funciona (*Texto/CSV*, UTF-8, delimitador `;`).

### Metabase
Sem driver nativo: use um script/ETL (ou o conector HTTP/“Workflows” da sua versão) que leia o NDJSON paginado e grave em um banco que o Metabase consulte; ou o endpoint `GET /reports/timeseries`/`/overview` via CSV para cargas pequenas. Alternativa direta: apontar o Metabase a uma **réplica somente leitura** do Postgres usando as mesmas tabelas `Bv*` (decisão de infraestrutura, fora desta frente).

## 5. Painel do Fiscal (`fiscal:read`)

- `GET /fiscal/consumption?period=DAY|MONTH&from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]` — por item, com `quantity` (soma; **máximo** nos gauges `STORAGE_BYTES` e `VOICE_PEAK_CHANNELS`), `unitPrice`, `estimatedCost` e `series` (por dia ou por mês); `licenses` por mês; `totals.estimatedCost`. Dias de uso são **UTC** (como `BvUsageDaily`).
- `GET /fiscal/dashboard` — mês corrente: hoje, acumulado, **projeção ao fim do mês**, custo estimado/projetado, cotas com `pct` e `willExceed`, alertas recentes. Projeção: contadores → regressão linear (mínimos quadrados) sobre o **acumulado** diário (x = dia do mês) avaliada no último dia, nunca abaixo do consumido (1 ponto → proporcional); gauges → regressão sobre o valor diário (carry-forward dos dias sem leitura).
- Itens: `WA_SERVICE` = item 7, `WA_UTILITY` = 8, `WA_MARKETING` = 9, `STORAGE_BYTES` = 10, `VOICE_MINUTES`/`VOICE_PEAK_CHANNELS` = 11, `EMAIL_IN/OUT`, `WEBCHAT_MSG`, `AI_CALLS`, `AI_TOKENS`.
- **Valores unitários estimados** (R$) — padrões do TR: item 7 = 0,11/conversa; item 8 = 0,11; item 9 = 0,46; item 10 = 493/TB·mês (TB = 10¹² bytes, sobre o máximo do mês); item 11 = 365/canal·mês (sobre o pico de canais do mês). Sobrescreva em `org.settings.billing.unitPrices`, ex.: `{ "WA_UTILITY": 0.2, "STORAGE_TB_MONTH": 500, "VOICE_CHANNEL_MONTH": 400, "LICENSE_ATENDENTE": 80, "EMAIL_OUT": 0.001 }` (chave = nome do item; licenças opcionais). São **estimativas**, não fatura.
- **Cotas** (`quota:manage` para escrever): `GET /fiscal/quotas` (com status atual via `core/usage.checkQuota`), `POST /fiscal/quotas {item, period: DAY|MONTH, limit, action: ALERT|BLOCK, alertAtPct}` (upsert por item+período; 201 criar / 200 atualizar), `PUT /fiscal/quotas/:id`, `DELETE /fiscal/quotas/:id`. Cada mudança é auditada (`quota.create|update|delete`) e versionada (`recordConfigVersion`, entidade `quota`). `BLOCK` só tem efeito para quem chama `assertQuota` (core).
- **Job `balcao.fiscal.alerts`** (60 s): ao cruzar `alertAtPct` e 100% cria `BvNotification` (`type = QUOTA_ALERT`) para cada usuário FISCAL/ADMIN ativo, com `data.dedupKey = quota:<id>:<período>:<ALERT|LIMIT>` — **uma vez por cota/período/limiar** (dia `YYYY-MM-DD` ou mês `YYYY-MM`), e emite o evento de socket `notification` ao usuário. Execuções no mesmo processo são serializadas (testado com 3 chamadas concorrentes); entre instâncias vale o lock Redis do job.
- **Job `balcao.fiscal.storage`** (6 h, ao subir): soma o tamanho dos arquivos sob `<BV_STORAGE_DIR>/<orgId>/` (sem seguir symlinks; limite de `BV_STORAGE_SCAN_MAX` entradas e 120 s — se estourar, **não** grava o gauge) e grava `setUsageGauge(STORAGE_BYTES)`. Se não existir a pasta `recordings` no disco (backend S3), soma `BvCall.recordingSizeBytes`.

## 6. Permissões, auditoria e variáveis

Relatórios: `report:read` (leitura) / `report:export` (salvar, agendar, mensal). Fiscal: `fiscal:read` / `quota:manage`.
Auditoria: `report.export`, `report.download`, `report.monthly`, `report.saved.*`, `quota.*`.

| Variável | Uso | Padrão |
|---|---|---|
| `BV_REPORTS_REALTIME_MS` | liga a emissão periódica `report:realtime` | desligado |
| `BV_STORAGE_SCAN_MAX` | máx. de entradas varridas por órgão no job de armazenamento | 500000 |
| `BV_PUBLIC_API_URL` | base do link de download nos e-mails | `https://api.zapscript.me` |
| `BV_REPORT_ALLOWED_DOMAINS` | lista (vírgula) de domínios permitidos como destinatários | sem restrição |
| `RESEND_API_KEY` / `SMTP_*` | envio real (`lib/mailer.ts`) | — |
| `BV_JOBS=off` | desliga todos os jobs (já desligados em `NODE_ENV=test`) | — |

Settings do órgão lidos (JSON bruto, fora do tipo `BvOrgSettings`): `contract.startDate`, `contract.hours`, `iqa.{denominator,goals,glosa}`, `contract.iqaGlosaBands` (legado), `billing.unitPrices`, `timezone`.

## 7. Desempenho

Todas as consultas usam os índices `(orgId, startedAt)` etc. e uma única passada agregada (`FILTER` + `percentile_cont`). Medido no teste: `GET /reports/overview?compare=true` com 20 mil conversas em um órgão → ~150 ms.

Testes: `npx jest --runInBand src/balcao/reports` — 35 casos (funções puras, IQA com fórmula única nas duas bases, filtros do painel, métricas com valores conhecidos, allowlist do relatório personalizado, token de API/BI, painel do fiscal, agendamento idempotente concorrente, relatório mensal, isolamento entre órgãos e volume).

## 8. Não verificado

- Leitura do Power BI/Metabase **reais** (roteiros acima não foram executados contra as ferramentas).
- Envio de e-mail real (Resend/SMTP): testes usam mailer injetado (`setReportMailer`); o e-mail leva link, não anexo.
- Faixas de glosa do IQA (10/15/20%): o edital informa os percentuais mas a regra de enquadramento adotada (distância à meta) é **suposição**. A base do denominador do IQA (`ALL_BOT` × `AUTOMATABLE`) é configurável porque a leitura do edital precisa ser **confirmada com o fiscal** (o padrão é a literal: todos os atendimentos via chatbot, inclusive os ainda abertos); ele depende de a frente `ai` marcar `botHandled`/`resolvedByBot`/`firstContactResolved`/`automatable` — conversas só-bot sem essas marcas não entram, e `automatable` é heurística (resposta ancorada), não classificação de negócio. Testado com dados semeados nas duas bases; não validado com tráfego real. `settings.iqa` só é editável pelo `PUT /reports/iqa/config` (a tela de configuração do órgão da frente `iam` não o conhece).
- "Tempo online" por presença: não existe histórico de presença; usa-se tempo em atendimento. Atribuição por atendente usa `assignedUserId` atual (transferências não repartem o tempo).
- Preços unitários e a definição de TB (10¹²) vêm do TR/estimativa; consumo usa dias UTC de `BvUsageDaily`, não o fuso do órgão.
- Cotas `BLOCK`: a aplicação do bloqueio depende de cada canal chamar `assertQuota` (core); esta frente só administra e alerta.
- Alertas de cota são periódicos (60 s), não instantâneos no `recordUsage`; a deduplicação é leitura + criação (sem índice único, pois não se altera o schema) — sem o lock do job, duas **instâncias** simultâneas poderiam duplicar um alerta.
- Agendamento: a ocorrência é reivindicada antes de gerar o arquivo; se o processo morrer entre a reivindicação e a geração, aquela ocorrência não é refeita (a próxima segue normalmente; use `POST /reports/saved/:id/run`).
- Tarefas exportadas para BI incluem `tags` (texto livre do órgão): revise se podem conter dado pessoal.
- Emissão `report:realtime` por socket e jobs agendados com Redis/réplicas múltiplas: testados só unitariamente (sem Socket.IO/Redis em execução multi-instância).
- Medição de armazenamento em volume real (milhões de arquivos) e em backend S3.
