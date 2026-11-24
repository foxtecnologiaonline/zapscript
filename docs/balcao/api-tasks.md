# API — Tarefas internas e service desk (`/balcao/tasks`)

Frente **tasks** (TR 1.1.3.1.10.1–.3 — PoC eliminatória — e TR 8.2.8). Código em `apps/api/src/balcao/tasks`
(`model.ts` regras/SLA/acesso/pausa · `service.ts` negócio · `content.ts` cifra em repouso · `routes.ts` HTTP · `sweep.ts` job ·
`indicators.ts` ISA/IOSA/IR · `notifications.ts`). Testes: `apps/api/src/balcao/tasks/__tests__/tasks.test.ts` (31 casos).
Autenticação: `Authorization: Bearer <JWT do Balcão>` (ou token `bvt_…` com escopos). Erros: `{ error: { code, message } }`.

## Modelo

`kind`: `INTERNAL` (sem vínculo a atendimento) · `DEMAND` · `SERVICE_REQUEST` (solicitação à contratada, TR 8.2.8).
`origin`: `CHATBOT | AGENT | BACKOFFICE | SYSTEM`. `status`: `OPEN | IN_PROGRESS | WAITING | DONE | CANCELLED`.
`priority`: `LOW | NORMAL | HIGH | URGENT`. Código `TAR-000123` (`nextTaskCode`, por órgão).

### Máquina de estados

| De | Para |
|---|---|
| OPEN | IN_PROGRESS, WAITING, CANCELLED |
| IN_PROGRESS | WAITING, DONE, CANCELLED |
| WAITING | IN_PROGRESS, DONE, CANCELLED |
| DONE / CANCELLED | OPEN (**reabrir exige `task:manage`**) |

Transição inválida → 409 `task.invalid_transition`. Concorrência: guarda otimista (409 `task.conflict`).
Iniciar uma tarefa sem responsável como atendente a atribui a ele. `respondedAt` = 1ª mudança de status (≠ OPEN/CANCELLED)
ou 1ª resposta visível (comentário não interno) de outra pessoa que o solicitante.

### Quem vê / edita

| Perfil | Vê | Edita |
|---|---|---|
| ADMIN/SUPERVISOR (`task:manage`) | todas do órgão | todas (reabre, muda nível de suporte/`externalRef`) |
| ATENDENTE | as suas, as que criou, as do seu setor e a "caixa geral" (sem responsável e sem setor) | as suas, criadas por ele e do seu setor; pode **assumir** (`/claim`) as sem responsável |
| FISCAL (e token de API sem `task:manage`) | só `SERVICE_REQUEST` + as que criou | só cria `SERVICE_REQUEST`; edita/cancela as próprias; comenta (sempre visível ao solicitante); avalia; não atribui; não vê comentários internos |

Tarefa que o ator não pode ver responde **404**. Isolamento por `orgId` em toda query.

## Conteúdo cifrado em repouso

Texto livre de tarefas é gravado com `encryptField` (AES-256-GCM, chave versionada de `core/crypto`) e lido com `decryptField`; **todo**
acesso passa pelos helpers de `tasks/content.ts` (`sealText/openText/openTask/openComment/openHistory`), nunca cru:

| Coluna | Cifrada? |
|---|---|
| `BvTask.description` | sim |
| `BvTaskComment.body` (comentários, resolução, comentário de avaliação) | sim |
| `BvTaskHistory.fromValue/toValue` dos campos `description` e `resolution` (texto livre) | sim |
| `BvTask.title`, `code`, `tags`, demais campos e histórico de `status/priority/assigneeId/…` | **não** (busca por título/código e auditoria) |

* A API devolve **texto claro** (a cifra é transparente): `description` em listagem/quadro/detalhe, `comments[].body`, `history[].fromValue/toValue`.
* Valores antigos **sem** o prefixo `bv1.` continuam legíveis. `encryptExistingTaskText({ orgId?, batchSize?, maxRows? })` (exportada por `tasks/index.ts`)
  cifra os legados em lotes — idempotente, retomável, otimista — e roda no job `balcao.tasks.encrypt_existing` (a cada 6 h e na subida; sem custo quando
  nada resta). A rotação de chaves (`security/keys.ts`) também cobre estas colunas.
* **Quem lê `BvTask`/`BvTaskComment` direto do Prisma deve passar por `openTask/openComment`** (exportados em `tasks/index.ts`). Hoje `integrations/jira.ts`
  (`createIssueForTask`) lê `task.description` cru: sem a troca por `openText(task.description)` o Jira recebe o texto cifrado.
* Exportação integral, exportação do titular, anonimização/exclusão do titular e retenção tratam estas colunas (ver `api-security.md`).

## Endpoints

| Método e rota | Permissão | Descrição |
|---|---|---|
| `POST /` | task:write | cria. `{kind, title, description?, priority, sectorId?, assigneeId?, dueAt?, tags?, conversationId?, contactId?, notifyOnClose?, notifyChannel? (EMAIL\|WHATSAPP), supportLevel? (L1..L4), origin? (AGENT\|BACKOFFICE)}` |
| `POST /from-conversation` | task:write | `{conversationId, title?, kind? (DEMAND\|SERVICE_REQUEST), priority, …}`: pré-preenche contato, assunto e protocolo; `notifyOnClose` padrão `true`; registra evento `TASK_CREATED` na conversa |
| `GET /` | task:read | lista. Filtros: `status` (CSV), `priority`, `kind`, `origin`, `sectorId`, `assigneeId`, `conversationId`, `contactId`, `tag`, `q` (código/título), `overdue=1`, `mine=1`, `createdByMe=1`, `unassigned=1`, `inbox=1` (caixa do meu setor); `limit` (≤200), `cursor` → `{items, nextCursor}` |
| `GET /board` | task:read | kanban: `{columns:[{status,count,items}], total}`; mesmos filtros; `perColumn` (padrão 20) |
| `GET /:id` | task:read | completo: responsável/setor/criador, conversa (protocolo), contato (nome, se `contact:read`), comentários, histórico, `sla`, `slaPaused`, `slaPausedAt`, `rating`, `permissions` |
| `PATCH /:id` | task:write | `title, description, priority, dueAt, tags, notifyOnClose, notifyChannel`; (manage) `supportLevel, externalRef`. Recalcula SLA |
| `POST /:id/status` | task:write | `{status, resolution?}`; `resolution` vira comentário visível e vai no aviso ao cidadão |
| `POST /:id/assign` | task:write | `{assigneeId?, sectorId?}`: usuário **ou** setor. Só `sectorId` ⇒ responsável é limpo (caixa do setor); só `assigneeId` ⇒ setor mantido; `null` desatribui |
| `POST /:id/claim` | task:write | assume tarefa sem responsável |
| `GET/POST /:id/comments` | task:read / write | `{body, internal?=true, mentions?[userId]}`; `@email` no texto também menciona |
| `POST /:id/rating` | task:write | `{score 0–10, comment?}` — só `SERVICE_REQUEST` `DONE`; Fiscal ou manager. Grava em `BvTaskHistory` (`field='rating'`, vale a última) |
| `POST /:id/resend-close-notice` | task:write | reenvia o aviso de encerramento (idempotente) |
| `GET /notifications` | task:read | `?unread=1&limit&cursor` → `{items, nextCursor, unread}` |
| `GET /notifications/unread-count` | task:read | `{unread}` |
| `POST /notifications/:id/read`, `POST /notifications/read-all` | task:read | marca como lida |
| `GET /service-desk/indicators?from&to&format=json\|csv` | report:read (CSV: report:export) | ISA1–ISA4, IOSA, IR + glosa indicativa |
| `GET /service-desk/requests?from&to&format=json\|csv` | report:read (CSV: report:export) | lista das solicitações do período com prazo/atraso/nota |

Padrão de `from/to`: 1º dia do mês (UTC) até agora. Datas em ISO-8601 com offset.

## Notificação de encerramento ao cidadão (`notifyContact`)

Ao ir para DONE/CANCELLED com `notifyOnClose`: texto com protocolo, código, situação e `resolution`.
Rotas por `notifyChannel`: **null** → conversa vinculada (janela válida) → e-mail do contato; **EMAIL** → e-mail → conversa;
**WHATSAPP** → conversa WhatsApp (a vinculada ou a mais recente do contato) com janela de `settings.whatsapp.windowHours`.
Janela: WhatsApp 24 h desde a última mensagem do cidadão; WebChat 30 min; E-mail sempre; Voz nunca.
Sucesso → `closeNoticeSentAt` + histórico `closeNotice=SENT:<rota>`. Falha → `closeNoticeSentAt` nulo, histórico
`closeNotice=FAILED:<motivos>` e `BvNotification` `task.close_notice_failed` ao responsável (ou criador/supervisores).
Nunca derruba o encerramento. Idempotente; reabrir limpa `closeNoticeSentAt`.

## SLA (TR 8.2.8)

`SERVICE_REQUEST` (nível por `supportLevel`; se ausente, derivado da prioridade: URGENT→L1, HIGH→L2, NORMAL→L3, LOW→L4),
prazo de **resolução** em tempo útil (`addBusinessSeconds`, horário e feriados do órgão):
ISA1 L1 = 1 h (meta 100%) · ISA2 L2 = 2 h (95%) · ISA3 L3 = 1 dia útil (80%) · ISA4 L4 = 2 dias úteis (60%).
Dia útil = maior soma das janelas do `businessHours` (8 h se vazio). `dueAt` padrão = prazo ANS.
Resposta (`slaResponseDueAt`, DEMAND e SR): URGENT 15 min · HIGH 1 h · NORMAL 4 h · LOW 8 h úteis (limitado ao prazo de resolução).
DEMAND: resolução = `dueAt`. INTERNAL: só `dueAt`, sem SLA de resposta. Sobrescrevível em `BvOrg.settings.tasks`:
`ans.<L>.{seconds|days,business,target}`, `responseSec.<PRIORIDADE>`, `glosaBands[{upToPoints,percent}]`, `ratingPassScore`.

### Pausa do SLA em "Aguardando" (`WAITING`)

* **Entrar** em `WAITING`: grava `metadata.slaPause = { since: <ISO> }` (Json já existente em `BvTask.metadata`) e a linha de histórico `sla.pause`.
* **Sair** (para `IN_PROGRESS`, `DONE` ou `CANCELLED`): calcula o tempo **útil** pausado (`businessSecondsBetween`: janelas de `businessHours` do órgão, sem
  feriados de `BvHoliday`; se a regra ANS do nível tiver `business:false`, tempo corrido) e **empurra** `slaResolutionDueAt` por esse tempo
  (`addBusinessSeconds` a partir do prazo atual). `dueAt` acompanha quando era igual ao prazo de resolução (SERVICE_REQUEST, ou DEMAND com `dueAt`).
  `slaResponseDueAt` só é empurrado se a tarefa **ainda não foi respondida** (entrar em `WAITING` já marca `respondedAt`, então na prática a resposta não "volta a
  ser no prazo" por causa da pausa). Remove `slaPause`, soma em `metadata.slaPausedSec` e grava o histórico `sla.resume` (`toValue: "+14400s"`).
* `PATCH` que recalcula o SLA (prioridade/nível/`dueAt`) devolve o tempo útil já pausado (`slaPausedSec`) ao prazo recalculado.
* O **sweep ignora** tarefas em `WAITING` (nenhum aviso de vencimento nem `sla.breach` enquanto pausada); o filtro `overdue=1` também as exclui.
* **GET** (`/`, `/board`, `/:id` e respostas de escrita): `slaPaused: boolean`, `slaPausedAt: ISO|null` e, em `sla`, `paused`/`pausedAt`; com a tarefa pausada
  `sla.overdue`, `sla.responseBreached`, `sla.resolutionBreached` e `sla.remainingSec` são calculados com o relógio **congelado** no instante da pausa.
* `changeStatus(orgId, actor, id, to, { resolution?, now? })` aceita `now` (relógio injetável, usado nos testes).

## Indicadores

Universo: `SERVICE_REQUEST` **criadas no período**, não canceladas, concluídas ou com prazo já vencido.
- **ISA1–4**: % `DONE` com `completedAt ≤ slaResolutionDueAt` por nível vs. meta.
- **IOSA**: Σ tempo além do prazo ÷ Σ prazo previsto (em %, limite 5%).
- **IR**: média das notas 0–10 × 10 (meta 90%); `extra` traz cobertura (avaliadas/concluídas) e % com nota ≥ `ratingPassScore` (7).
- **Glosa indicativa**: pontos percentuais abaixo da meta → faixa (0→0%, ≤5→1%, ≤10→2%, ≤20→5%, >20→10%), somada. **Faixas inventadas** — não contratuais.
CSV com `\r\n`, aspas escapadas e prefixo `'` contra injeção de fórmula.

## Job

`balcao.tasks.sweep` (`registerJob`, 60 s, lock Redis). Para tarefas `OPEN`/`IN_PROGRESS` (as `WAITING` têm o SLA pausado e são ignoradas): aviso de vencimento (24 h e 1 h antes de `dueAt`) ao
responsável (assignee → usuários do setor → supervisores); vencida (responsável + supervisores); **violação de SLA** de resposta e de
resolução → `emitBvEvent('sla.breach', {orgId, taskId, kind: 'task.response'|'task.resolution'})`, notificação a responsável e supervisores e socket
`sla:breach`. Dedupe por marcadores em `BvTaskHistory` (`sys.due24h`, `sys.due1h`, `sys.overdue` ocultos; `sla.breach` visível) — uma vez por tarefa/tipo.
Exportado: `runTasksSweep(now)`.
`balcao.tasks.encrypt_existing` (6 h, na subida): `encryptExistingTaskText()` — cifra texto legado (ver "Conteúdo cifrado em repouso").

## Eventos e integração com outras frentes

- Emite `task.created` e `task.closed` (`{orgId, taskId}`) — integrations pode assinar (Jira); `externalRef` é editável por manager e por código.
- Exporta de `balcao/tasks`: `createTaskFromBot(orgId,{conversationId,title,description,category?,priority?})` (origin CHATBOT, idempotente por título aberto na conversa; categoria que casa com o nome de um setor roteia para ele; URGENT vira HIGH), `createTask`, `createTaskFromConversation`, `changeStatus`, `assignTask`, `notifyContact`, `notifyUsers`, `runTasksSweep`, `setTaskMailer` (e-mail injetável; padrão `lib/mailer.sendEmail`).
- Ferramenta do bot **`tasks.create_demand`** (`registerBotTool`, registrada ao carregar o plugin): `{title, description, category?, priority?}` → `{ok, data:{code, taskId, duplicate}, message}`.
- Socket `/bv`: `notification {id,type,title,body,data,createdAt}` na sala do usuário; `sla:breach` para supervisores.
- Tipos de notificação: `task.assigned`, `task.sector_inbox`, `task.new_demand`, `task.mention`, `task.comment`, `task.closed`, `task.due_soon`, `task.overdue`, `task.sla_breach`, `task.close_notice_failed`.
- Auditoria: `task.create|update|status|assign|rating|indicators.read|requests.export`.

## Variáveis de ambiente

Nenhuma nova. O e-mail usa `RESEND_API_KEY` ou `SMTP_*` do `lib/mailer`. `BV_JOBS=off` desliga o job.

## Não verificado

- Envio real de e-mail (Resend/SMTP) e de WhatsApp/WebChat: testes usam mailer injetado e remetente de canal simulado.
- Janela de 30 min do WebChat e demais janelas são suposições de produto; WhatsApp fora da janela (template/nova conversa) **não** é feito — vira falha + notificação.
- Interpretação do edital a confirmar com o órgão: prazos L1/L2 em tempo útil (e não corrido); fórmulas de IOSA e IR; faixas e % de glosa; universo dos indicadores.
- Pausa do SLA: testada com horário comercial (seg–sex 08–18, fuso do Tocantins) e feriado; **mudanças de status feitas fora do serviço** (ex.: sincronização de status do Jira em `integrations/jira.ts`, que faz `prisma.bvTask.update`) **não pausam/retomam** o SLA. Não há cálculo retroativo ao alterar feriados/horário do órgão; pausas encerradas antes desta versão não foram descontadas.
- Pausa e horário por fila (`BvQueue.businessHours`) não se aplicam a tarefas (só o horário do órgão).
- Job em produção com Redis/réplicas múltiplas e volume (varredura pagina por 500; `addBusinessSeconds` varre minuto a minuto, custo por criação).
- Cifra em repouso: **títulos** (e `tags`, `externalRef`) continuam em claro por causa da busca — títulos gerados pelo bot ou digitados podem conter dado pessoal. Histórico de outros campos (status, prioridade…) segue em claro. Texto cifrado não é pesquisável (a busca `q` só olha código e título). O desempenho da migração em volume real (milhões de linhas) e a rotação com chave aposentada em produção não foram medidos. Integrações que leem a tabela direto (Jira) precisam usar `openTask` (ver acima).
- `BvSector.email` (caixa do setor) não é usado para e-mail; só notificações internas.
- Testes isolam a frente (plugin próprio): o plugin raiz `buildBalcaoTestApp` falha hoje no jest por `jose` (ESM) vindo de `integrations/common.ts` — fora desta frente.
- Sem front-end (kanban/UI) e sem testes de carga.
