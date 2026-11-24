# Balcão Virtual — frente routing (ACD, inbox, filas, supervisão, contatos)

Código: `apps/api/src/balcao/routing`. Todas as rotas ficam sob `/balcao` (plugin com prefixo `/`), exigem
`Authorization: Bearer <JWT do Balcão>` (token de API `bvt_…` é recusado: 403) e respondem erros como
`{ "error": { "code", "message", "details?" } }`. Toda query filtra por `orgId`; recurso de outro órgão responde 404.

## 1. Motor de roteamento (ACD)

Assina, via `onBvEvent`, `conversation.needs_routing` e `agent.available` (`handlers.ts`, registrado ao carregar o plugin).

1. **Fila** (`prepareConversation`): regras `BvRoutingRule` ativas por `position` (primeira que casa **e** cuja fila está ativa);
   sem regra → fila por categoria da conversa/canal → slug `geral` → 1ª fila ativa. Reasons `TRANSFER`/`OVERFLOW` mantêm a fila já gravada.
2. **Prioridade** = `queue.priority` + `priorityBoost` da regra + peso da categoria do contato + aumentos de overflow.
   Pesos padrão: MP 3, DEFENSORIA 3, ADVOGADO 2, SERVIDOR 1, CIDADAO/OUTRO 0.
3. **SLA**: `slaFirstResponseDueAt` (a partir de `queuedAt`; não calculado se já houve 1ª resposta humana) e `slaResolutionDueAt`
   (a partir de `startedAt`; `queuedAt` em reabertura), em horário útil (`queue.businessHours` ou do órgão + feriados).
4. **Fora do horário**: envia **uma vez por "geração"** (`queuedAt`) `settings.outsideHoursMessage` via `sendMessage(SYSTEM)` (não em VOICE) e
   mantém WAITING até abrir (o sweep drena).
5. **Atendente**: presença `ONLINE`, ativo, membro da fila (sem fila: só perfil ATENDENTE), skills ⊇ `requiredSkills`, carga `< maxConcurrent`.
   Estratégia da fila: `LEAST_BUSY` (menor carga, desempate por ociosidade), `ROUND_ROBIN` (atribuição mais antiga), `LONGEST_IDLE`
   (maior tempo sem atividade: atribuição/encerramento/presença). Atribui com `assignConversation(via: 'AUTO')`.
6. **`agent.available`** (fim de atendimento, presença ONLINE, novo membro de fila): `drainForAgent` puxa as WAITING das filas do atendente por
   prioridade desc, espera desc, até esgotar a capacidade.

**Atomicidade/idempotência**: lock Redis (+ trava em processo) por conversa e por atendente (`lock.ts`; ordem conversa → atendente);
a capacidade é relida do banco sob o lock do atendente antes de cada `assignConversation`; reexecutar não duplica atribuição,
aviso de fora do horário nem eventos (estado em `metadata.routing`, mesclado por `jsonb ||` sem sobrescrever as demais chaves de `metadata`).
Sem Redis, cai para trava só em processo (instância única).

`metadata.routing`: `routedAt, generation, ruleId, queueEnteredAt, overflowDueAt, overflowChain, extraPriority, outsideHoursNoticeFor, breached[]`.

### Job `balcao.routing.sweep` (`BV_ROUTING_SWEEP_MS`, padrão 15 s; lock Redis do scheduler)
1. roteia WAITING sem `routedAt` há > 20 s (evento perdido) · reavalia órgãos com regras `minWaitSec`;
2. **overflow**: `overflowDueAt` (calculado em horário útil = `maxWaitSec`) vencido → move para `overflowQueueId` (sem ciclos: cadeia
   visitada em `overflowChain`) e reroteia; sem overflow (ou ciclo) → prioridade `+overflowPriorityBoost` e novo prazo; evento `OVERFLOW`;
3. drena as WAITING roteadas (prioridade desc, espera desc);
4. **SLA**: `FIRST_RESPONSE` e `RESOLUTION`, uma vez cada → `slaBreached=true`, evento de conversa `SLA_BREACH`, `emitBvEvent('sla.breach')`,
   `BvNotification` (tipo `SLA_BREACH`) para supervisores/admins e para o atendente, sockets `notification` e `sla:breach`;
5. **timeout** (no máx. 1×/min): BOT/WAITING sem atividade há > `timeoutHours` (24) → `closeConversation(TIMEOUT)` + evento `TIMEOUT`.
   BOT conta relógio corrido; WAITING conta só horário útil (fim de semana fechado não encerra).

`runRoutingSweep({ orgId?, now?, forceTimeouts? })` é exportado (testes).

## 2. Endpoints

Perm = permissão do núcleo. "Acesso" = `canAccessConversation` (atendente: atribuídas a ele + WAITING das filas de que é membro/sem fila;
supervisor/admin: todas). Listas: `{ items, nextCursor }` (cursor opaco).

### Conversas
| Método e path | Perm | Corpo / query | Resposta |
|---|---|---|---|
| GET `/conversations` | conversation:read | `mine, unassigned, status (CSV), queueId, channel, protocol (contém), contact (id), category, assignedUserId, slaBreached, sort=recent\|priority, limit≤100, cursor`. Atendente só vê as suas e as WAITING das suas filas | `{items:[{…conversa, waitSec, contact{id,name,category}, queue, assignee}], nextCursor}` (nunca `metadata`/`body`) |
| GET `/conversations/:id` | conversation:read + acesso | `?before=<data ISO \| id de mensagem>&limit=` (limit 1–200, padrão **100**). Audita `conversation.read` | `{conversation, contact (documento mascarado), messages (decifradas, inclui notas, ordem cronológica), hasMore, nextBefore, events, canReply}`. Sem `before`: as últimas `limit`. `hasMore=true` → há mais antigas; `nextBefore` = id da mensagem mais antiga da página (passe em `before` para a página anterior; `null` se `hasMore=false`). Desempate por id (sem pular/repetir). `before` inválido ou de outra conversa → 400 `messages.invalid_cursor` |
| POST `/conversations/:id/messages` | conversation:reply + acesso; só atribuído ou supervisão | `{text?, attachments?:[descritor]}` (um dos dois) | 201 `{message, delivery:{status,error}}`; 403 `conversation.not_assigned`; 409 conversa encerrada |
| POST `/conversations/:id/messages/:messageId/resend` | conversation:reply; atribuído ou supervisão; só o autor da mensagem ou supervisão | — | 200 `{message, delivery:{status,error}}` — **mesma mensagem** (mesmo `id`, sem nova bolha): reenvia pelo remetente do canal (`getChannelSender`), grava `status` (`SENT`/`QUEUED`/`FAILED`) e `errorCode`. Falhou de novo → 200 com `delivery.status:"FAILED"` e `error`. Erros: 404 (mensagem não é desta conversa), 409 `message.not_resendable` (só `direction=OUT` e `status=FAILED`; também se já está sendo reenviada), 403 `message.not_owner`, 409 `conversation.closed`. Reivindica `FAILED→QUEUED` de forma atômica (reenvios simultâneos: só um chega ao canal). Audita `conversation.message.resend` |
| POST `/conversations/:id/notes` | conversation:reply + acesso | `{text}` | 201 `{message}` |
| POST `/conversations/:id/pickup` | conversation:reply + acesso | — (WAITING sem dono; respeita `maxConcurrent`, supervisor isento) | `{conversation}`; 409 `conversation.already_assigned` / `agent.at_capacity` |
| POST `/conversations/:id/assign` | conversation:monitor | `{userId}` (audita) | `{conversation}` |
| POST `/conversations/:id/transfer` | conversation:transfer; atribuído ou supervisão | `{toUserId \| toQueueId, note?}` | `{conversation}` |
| POST `/conversations/:id/close` | conversation:close; atribuído ou supervisão | `{reason: RESOLVED\|ABANDONED\|TRANSFERRED_OUT\|SPAM\|TIMEOUT}` (padrão RESOLVED; dispara NPS) | `{conversation}` |
| POST `/conversations/:id/read` | conversation:read + acesso | — | `{ok:true}` (zera `unreadForAgent`) |
| POST `/conversations/:id/attachments` | conversation:reply; atribuído ou supervisão | multipart, campo `file`, ≤ 15 MB | 201 `{attachment:{key,name,mime,size,sha256}}`; 415 tipo/assinatura inválidos; 413 > 15 MB; **422 `attachment.rejected`** com `details:{reason:"infected"\|"scan_unavailable"}` (antivírus ClamAV, ver `BV_CLAMAV_*` em `ENV.md`; arquivo recusado é removido do disco e auditado em `conversation.attachment.rejected`) |
| GET `/conversations/:id/attachments/<key>` | conversation:read + acesso | `?inline=1` (só imagens/PDF) | stream com `Range`, `Content-Disposition: attachment`, `nosniff`; 404 se a chave não pertence à conversa (audita) |

Tipos de anexo permitidos: JPEG/PNG/GIF/WebP (assinatura conferida), PDF (idem), TXT/CSV, áudio (ogg, mp3, m4a, aac, amr, wav, weba), vídeo (mp4, webm, 3gp),
Office/ODF. Nunca HTML/SVG/executáveis. Só descritores de anexos enviados nesta conversa (evento `ATTACHMENT_UPLOADED`) ou presentes em suas mensagens são aceitos em `messages`.

### Filas e regras
| Método e path | Perm | Corpo | Notas |
|---|---|---|---|
| GET `/queues`, GET `/queues/:id` | conversation:read | — | membros detalhados só com queue:manage |
| POST `/queues` | queue:manage | `{name, slug?, categories, channels, requiredSkills, priority, strategy, slaFirstResponseSec, slaResolutionSec, maxWaitSec, overflowQueueId, businessHours, sectorId, active, memberIds?}` | valida overflow (existe, ≠ si, sem ciclo) |
| PATCH `/queues/:id` | queue:manage | parcial dos mesmos campos | 409 slug repetido |
| DELETE `/queues/:id` | queue:manage | — | 409 `queue.in_use` (conversas abertas, overflow ou regra apontando); prefira `active:false` |
| GET/PUT `/queues/:id/members`, POST `/queues/:id/members`, DELETE `/queues/:id/members/:userId` | queue:manage | `{userIds}` / `{userId}` | novo membro dispara `agent.available` |
| GET `/routing-rules`, GET `/routing-rules/:id` | routing:manage | — | ordenadas por `position` |
| POST `/routing-rules` | routing:manage | `{name, active?, conditions, action:{queueId, priorityBoost?, setCategory?}, position?}` | `conditions`: `channels, contactCategories, categories, intents, outsideHours, weekdays (0–6 ou sun…sat), minWaitSec`; chaves desconhecidas → 400 |
| PATCH / DELETE `/routing-rules/:id` | routing:manage | parcial (inclui `position`) | posições sempre compactadas 0..n-1 |
| POST `/routing-rules/reorder` | routing:manage | `{ids:[todas as regras]}` | 400 se faltar/repetir |
| POST `/routing-rules/test` | routing:manage | `{channel, contactCategory?, category?, intent?, waitSec?, at?}` | simulação sem gravar: `{ruleId, queueId, priority, outsideHours}` |

Toda mudança de fila/regra/membros grava auditoria (`queue.*`, `routing-rule.*`) e `recordConfigVersion` (`queue`, `routing-rule`).

**Histórico de versões** (`routes/versions.ts`, sobre `BvConfigVersion`):
| Método e path | Perm | Corpo / query | Resposta |
|---|---|---|---|
| GET `/queues/:id/versions` | queue:manage | `?limit=` (≤200, padrão 50) | `{items:[{version, snapshot, createdAt, deleted, changedBy:{id,name}\|null}]}` (mais nova primeiro; fila excluída continua legível; outro órgão/inexistente → 404) |
| GET `/routing-rules/:id/versions` | routing:manage | idem | idem |
| POST `/queues/:id/versions/:version/restore` | queue:manage | — | 200 `{queue, version (nova), restoredFrom}`. Restaura só os campos de configuração (`name, slug, categories, channels, requiredSkills, priority, strategy, sla*, maxWaitSec, overflowQueueId, businessHours, sectorId, active`), revalidados com o schema do PATCH + overflow (existe, sem ciclo) + setor. **Membros não são restaurados** (snapshots de PATCH não os trazem). Erros: 404 `version.not_found`, 409 `version.not_restorable` (versão de exclusão), 422 `version.invalid_snapshot` (`details:[{path,message}]`), 409 `queue.slug_taken`. Audita `queue.restore` (before/after + `restoredFromVersion`, `newVersion`) e grava nova versão |

### Agentes e supervisão
| Método e path | Perm | Notas |
|---|---|---|
| GET `/agents` | conversation:monitor | `?presence, queueId, available=true` → `{items:[{id,name,role,presence,presenceAt,skills,maxConcurrent,load,queueIds}]}` |
| GET `/agents/me`, PUT `/agents/me/presence` `{presence: OFFLINE\|ONLINE\|AWAY\|BUSY}` | conversation:read | usa `setAgentPresence` (ONLINE dispara `agent.available`) |
| GET `/supervisor/overview` | conversation:monitor | `?slaRiskMin=` (1–1440; padrão `BV_ROUTING_SLA_RISK_MIN` ou **10**) → `{generatedAt, slaRiskMin, totals:{waiting,active,bot,agentsOnline,slaBreached,slaAtRisk}, queues:[{queueId,name,waiting,longestWaitSec,active,agentsOnline,agentsBusy,agentsAvailable,maxWaitSec,slaAtRisk}], agents:[{userId,presence,load,maxConcurrent,conversations[≤20]}], slaBreaches[≤100]}` (fila "Sem fila" só se houver conversas). **`slaAtRisk`** = conversas WAITING/ACTIVE com prazo de 1ª resposta (ainda sem resposta humana) ou de resolução vencendo em ≤ N min e ainda não violado daquele tipo (uma conversa conta 1×; calculado em SQL no servidor; `totals.slaAtRisk` inclui conversas de filas inativas/excluídas) |
| GET `/supervisor/conversations` | conversation:monitor | mesmos filtros de `/conversations`, sem restrição de fila; padrão `status=BOT,WAITING,ACTIVE`, `sort=priority` |
| POST `/supervisor/conversations/:id/takeover` | conversation:monitor | assume a conversa (evento `TAKEOVER`, audita); avisa o atendente anterior |

### Contatos e respostas prontas
| Método e path | Perm | Notas |
|---|---|---|
| GET `/contacts?q=&category=` | contact:read | busca por nome, e-mail, telefone, protocolo, CPF/CNPJ (índice cego); exclui mesclados/anonimizados; audita `contact.search` (sem gravar o termo) |
| GET `/contacts/categories` | contact:read | `settings.contactCategories` |
| GET `/contacts/:id` | contact:read | histórico de conversas entre canais (só metadados), identidades; documento **mascarado**; `?reveal=1` só com contact:lgpd (audita `contact.document.reveal`); audita `contact.read`; mesclado → 404 `contact.merged` + `details.mergedIntoId` |
| PATCH `/contacts/:id` | contact:write | `{name,email,phone,category,tags}`; categoria validada contra `settings.contactCategories` |
| POST `/contacts/:id/document` | contact:write | `{document}` CPF/CNPJ com dígitos verificadores; 409 se já existe em outro contato |
| POST `/contacts/merge` | contact:lgpd | `{intoId, fromId}`; irreversível; une tags/campos vazios/documento |
| GET `/canned-responses?q=&includeShadowed=` | conversation:read | Lista as **do órgão** (`ownerId:null`, `scope:"ORG"`) + as **pessoais do usuário** (`scope:"PERSONAL"`, `ownerId` = ele). Ordem: pessoais primeiro, depois as do órgão, cada grupo por atalho. A pessoal **sobrescreve** a do órgão de mesmo atalho (a do órgão some; `shadowsOrg:true` na pessoal; com `includeShadowed=true` a do órgão volta com `shadowed:true`). Pessoal de A nunca aparece para B (nem para a gestão) |
| POST `/canned-responses` | conversation:read + (reply p/ pessoal, queue:manage p/ órgão) | `{shortcut (sem "/"), title, body, scope?:"PERSONAL"\|"ORG"}`. Sem `scope`: quem tem queue:manage cria do **órgão** (comportamento antigo), atendente cria **pessoal**. `scope:"ORG"` sem queue:manage → 403 | 201 `{item}`; 409 `canned.shortcut_taken` (atalho único por dono; e único por órgão entre as do órgão) |
| PATCH/DELETE `/canned-responses/:id` | a própria pessoal (conversation:reply) ou do órgão (queue:manage) | PATCH `{shortcut?,title?,body?}` (não muda o escopo) | `{item}` / 204. Pessoal alheia → 404; do órgão sem queue:manage → 403. Audita `canned-response.*` com `meta.scope` |

## 3. Eventos de socket (namespace `/bv`)
Do núcleo (já existentes): `conversation:new|assigned|closed`, `message:new`, `presence:changed`. Emitidos/ampliados por esta frente:
- `conversation:updated` → supervisão: `{id,status,queueId,priority,assignedUserId,slaFirstResponseDueAt?,slaResolutionDueAt?}` (roteamento, overflow, leitura) e ao atribuído (`unreadForAgent`).
- `conversation:queued` → cada membro da fila: `{id,protocol,channel,queueId,priority}`.
- `conversation:taken_over` → atendente anterior: `{id, byUserId}`.
- `sla:breach` → supervisão + atribuído: `{conversationId,protocol,queueId,assignedUserId,kind}`.
- `message:status` → sala da conversa: `{conversationId,messageId,status,errorCode}` após `resend` (não reenvia `message:new`: a bolha já existe; o front atualiza o status dela).
- `notification` → usuário: `{id,type:'SLA_BREACH',title,body,data,createdAt}`.

Eventos do barramento emitidos: `sla.breach`; `message.outbound` também no reenvio bem-sucedido (o webchat empurra por socket a partir dele). Eventos de conversa gravados: `QUEUED, OVERFLOW, SLA_BREACH, TIMEOUT, TAKEOVER, ATTACHMENT_UPLOADED`.

## 4. Variáveis de ambiente e configuração
| Nome | Padrão | Uso |
|---|---|---|
| `BV_ROUTING_SWEEP_MS` | 15000 | intervalo do job `balcao.routing.sweep` (mín. 1000) |
| `BV_ROUTING_SWEEP_BATCH` | 500 | máx. de conversas por passo do sweep |
| `BV_ROUTING_TIMEOUT_HOURS` | 24 | inatividade para TIMEOUT (0 desliga) |
| `BV_ROUTING_OVERFLOW_BOOST` | 5 | aumento de prioridade no overflow sem fila de destino |
| `BV_ROUTING_SLA_RISK_MIN` | 10 | janela padrão (min) do `slaAtRisk` em `/supervisor/overview` (sobreposta por `?slaRiskMin=`) |

Opcional por órgão em `BvOrg.settings.routing`: `{ categoryWeights: {ADVOGADO:2,…}, timeoutHours, overflowPriorityBoost }` (sobrepõe o ambiente).
Também usa `BV_STORAGE_DIR` (anexos) e `REDIS_URL` (locks). (Pendente copiar esta tabela para `docs/balcao/ENV.md`, que está fora do escopo desta frente.)

## 5. Testes
`cd apps/api && source <scratchpad>/bv-env.sh && npx jest --runInBand src/balcao/routing` — 42 testes (regras, horário, skills, capacidade,
estratégias, drenagem, overflow, ciclo, SLA, timeout, concorrência, fluxo REST completo, anexos, permissões, isolamento entre órgãos) e, em
`__tests__/gaps.test.ts`: respostas prontas pessoais, reenvio (inclui concorrência), paginação do histórico (130 mensagens, empates de `createdAt`),
versões/restauração de fila, `slaAtRisk` e anexos com clamd falso. Na 1ª execução (compilação a frio) use `--testTimeout=60000`: o `beforeAll` que monta o app pode passar de 5 s.

## 6. Não verificado
- Entrega real em Socket.IO: os testes não sobem servidor de socket (`getIo()` nulo); os emits foram revistos só por leitura.
- Carga: ~250 atendentes/40 supervisores/milhares de conversas não foram testados; consultas usam índices existentes, mas `GET /supervisor/overview`
  e o sweep não foram medidos sob volume (overview lê até 3000 conversas ativas e 1000 agentes).
- Multi-réplica: locks Redis testados só com uma instância; sem Redis cai para trava em processo.
- Anexos: armazenamento em disco local; antivírus só com ClamAV configurado (`BV_CLAMAV_*`) e testado contra um **clamd falso** (protocolo INSTREAM), nunca contra o ClamAV real (assinaturas, desempenho, arquivos grandes); sem clamd configurado nada é varrido; anexos recebidos de cidadãos pelos canais não passam por esta rota. Assinatura conferida só para JPEG/PNG/GIF/WebP/PDF. O envio ao cidadão depende de
  cada canal aceitar `attachments` em `registerChannelSender` (WhatsApp/e-mail/webchat não verificados aqui).
- Reabertura/transferência fora do horário: o aviso de fora do horário é por "geração" (`queuedAt`), então uma transferência para fila fechada
  pode reenviá-lo.
- Atendente que fica OFFLINE/AWAY mantém as conversas ACTIVE (não há redistribuição automática).
- `settings.routing` não está no tipo `BvOrgSettings` nem no validador de configurações da frente iam (pode ser descartada ao salvar pelo painel admin).
- Fuso/horário de verão: `addBusinessSecondsFast` foi validado contra `addBusinessSeconds` do núcleo apenas em America/Araguaina (sem DST).
- Reenvio: testado só com remetentes de canal simulados. Canais reais (WhatsApp fora da janela de 24 h/template, e-mail) podem recusar de novo; um canal que não é idempotente pode entregar duas vezes se o 1º envio falhou depois de entregar (timeout). O front precisa tratar o evento `message:status`.
- Paginação: `before` por data ISO usa `createdAt < data` (mensagens do mesmo milissegundo da data podem ficar de fora; prefira o id de `nextBefore`). `events` (até 300) e `contact` vêm em toda página, inclusive nas antigas.
- Restauração de versão: não restaura membros nem desfaz exclusão de fila; regras de roteamento ainda não têm restauração (só listagem de versões). Versões gravadas antes desta entrega podem ter snapshot sem todos os campos (campos ausentes ficam como estão).
- `slaAtRisk`: não considera horário útil (compara o prazo já calculado com o relógio); consulta SQL por varredura das conversas abertas do órgão, não medida sob volume.
- Respostas prontas pessoais: migração `20261124_balcao_virtual_3` aplicada só ao Postgres local; o índice único parcial das do órgão (`ownerId IS NULL`) só existe via SQL da migração.
