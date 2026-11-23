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
| GET `/conversations/:id` | conversation:read + acesso | `—` (audita `conversation.read`) | `{conversation, contact (documento mascarado), messages (decifradas, inclui notas), events, canReply}` |
| POST `/conversations/:id/messages` | conversation:reply + acesso; só atribuído ou supervisão | `{text?, attachments?:[descritor]}` (um dos dois) | 201 `{message, delivery:{status,error}}`; 403 `conversation.not_assigned`; 409 conversa encerrada |
| POST `/conversations/:id/notes` | conversation:reply + acesso | `{text}` | 201 `{message}` |
| POST `/conversations/:id/pickup` | conversation:reply + acesso | — (WAITING sem dono; respeita `maxConcurrent`, supervisor isento) | `{conversation}`; 409 `conversation.already_assigned` / `agent.at_capacity` |
| POST `/conversations/:id/assign` | conversation:monitor | `{userId}` (audita) | `{conversation}` |
| POST `/conversations/:id/transfer` | conversation:transfer; atribuído ou supervisão | `{toUserId \| toQueueId, note?}` | `{conversation}` |
| POST `/conversations/:id/close` | conversation:close; atribuído ou supervisão | `{reason: RESOLVED\|ABANDONED\|TRANSFERRED_OUT\|SPAM\|TIMEOUT}` (padrão RESOLVED; dispara NPS) | `{conversation}` |
| POST `/conversations/:id/read` | conversation:read + acesso | — | `{ok:true}` (zera `unreadForAgent`) |
| POST `/conversations/:id/attachments` | conversation:reply; atribuído ou supervisão | multipart, campo `file`, ≤ 15 MB | 201 `{attachment:{key,name,mime,size,sha256}}`; 415 tipo/assinatura inválidos; 413 > 15 MB |
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

### Agentes e supervisão
| Método e path | Perm | Notas |
|---|---|---|
| GET `/agents` | conversation:monitor | `?presence, queueId, available=true` → `{items:[{id,name,role,presence,presenceAt,skills,maxConcurrent,load,queueIds}]}` |
| GET `/agents/me`, PUT `/agents/me/presence` `{presence: OFFLINE\|ONLINE\|AWAY\|BUSY}` | conversation:read | usa `setAgentPresence` (ONLINE dispara `agent.available`) |
| GET `/supervisor/overview` | conversation:monitor | `{generatedAt, totals, queues:[{queueId,name,waiting,longestWaitSec,active,agentsOnline,agentsBusy,agentsAvailable,maxWaitSec}], agents:[{userId,presence,load,maxConcurrent,conversations[≤20]}], slaBreaches[≤100]}` (fila "Sem fila" só se houver conversas) |
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
| GET `/canned-responses?q=` | conversation:read | |
| POST/PATCH/DELETE `/canned-responses[/:id]` | queue:manage | `{shortcut (sem "/"), title, body}`; atalho único por órgão (409) |

## 3. Eventos de socket (namespace `/bv`)
Do núcleo (já existentes): `conversation:new|assigned|closed`, `message:new`, `presence:changed`. Emitidos/ampliados por esta frente:
- `conversation:updated` → supervisão: `{id,status,queueId,priority,assignedUserId,slaFirstResponseDueAt?,slaResolutionDueAt?}` (roteamento, overflow, leitura) e ao atribuído (`unreadForAgent`).
- `conversation:queued` → cada membro da fila: `{id,protocol,channel,queueId,priority}`.
- `conversation:taken_over` → atendente anterior: `{id, byUserId}`.
- `sla:breach` → supervisão + atribuído: `{conversationId,protocol,queueId,assignedUserId,kind}`.
- `notification` → usuário: `{id,type:'SLA_BREACH',title,body,data,createdAt}`.

Eventos do barramento emitidos: `sla.breach`. Eventos de conversa gravados: `QUEUED, OVERFLOW, SLA_BREACH, TIMEOUT, TAKEOVER, ATTACHMENT_UPLOADED`.

## 4. Variáveis de ambiente e configuração
| Nome | Padrão | Uso |
|---|---|---|
| `BV_ROUTING_SWEEP_MS` | 15000 | intervalo do job `balcao.routing.sweep` (mín. 1000) |
| `BV_ROUTING_SWEEP_BATCH` | 500 | máx. de conversas por passo do sweep |
| `BV_ROUTING_TIMEOUT_HOURS` | 24 | inatividade para TIMEOUT (0 desliga) |
| `BV_ROUTING_OVERFLOW_BOOST` | 5 | aumento de prioridade no overflow sem fila de destino |

Opcional por órgão em `BvOrg.settings.routing`: `{ categoryWeights: {ADVOGADO:2,…}, timeoutHours, overflowPriorityBoost }` (sobrepõe o ambiente).
Também usa `BV_STORAGE_DIR` (anexos) e `REDIS_URL` (locks). (Pendente copiar esta tabela para `docs/balcao/ENV.md`, que está fora do escopo desta frente.)

## 5. Testes
`cd apps/api && source <scratchpad>/bv-env.sh && npx jest --runInBand src/balcao/routing` — 33 testes (regras, horário, skills, capacidade,
estratégias, drenagem, overflow, ciclo, SLA, timeout, concorrência, fluxo REST completo, anexos, permissões, isolamento entre órgãos).

## 6. Não verificado
- Entrega real em Socket.IO: os testes não sobem servidor de socket (`getIo()` nulo); os emits foram revistos só por leitura.
- Carga: ~250 atendentes/40 supervisores/milhares de conversas não foram testados; consultas usam índices existentes, mas `GET /supervisor/overview`
  e o sweep não foram medidos sob volume (overview lê até 3000 conversas ativas e 1000 agentes).
- Multi-réplica: locks Redis testados só com uma instância; sem Redis cai para trava em processo.
- Anexos: armazenamento em disco local; sem antivírus/varredura; assinatura conferida só para JPEG/PNG/GIF/WebP/PDF. O envio ao cidadão depende de
  cada canal aceitar `attachments` em `registerChannelSender` (WhatsApp/e-mail/webchat não verificados aqui).
- Reabertura/transferência fora do horário: o aviso de fora do horário é por "geração" (`queuedAt`), então uma transferência para fila fechada
  pode reenviá-lo.
- Atendente que fica OFFLINE/AWAY mantém as conversas ACTIVE (não há redistribuição automática).
- `settings.routing` não está no tipo `BvOrgSettings` nem no validador de configurações da frente iam (pode ser descartada ao salvar pelo painel admin).
- Fuso/horário de verão: `addBusinessSecondsFast` foi validado contra `addBusinessSeconds` do núcleo apenas em America/Araguaina (sem DST).
