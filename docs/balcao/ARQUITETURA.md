# Balcão Virtual — arquitetura, decisões e contratos

Plataforma de atendimento omnichannel (voz, chat/popup, e-mail, WhatsApp oficial) com IA e curadoria, construída
como módulo do monorepo ZapScript para atender ao **Pregão Eletrônico 329/2026 do TJ-TO** (Balcão Virtual com IA).
Este documento é o contrato entre as frentes de trabalho — leia antes de mexer em qualquer coisa.

## 1. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Tudo dentro de `apps/api` (+ `apps/web`)**, em `apps/api/src/balcao`. Sem novo app/imagem. | `api` e `worker` não compartilham código; um app novo multiplicaria Dockerfile, lockfiles, CI e deploy manual. Jobs rodam na API com lock em Redis. |
| D2 | Tabelas `Bv*` com `orgId` em tudo (multi-órgão). Usuário interno próprio (`BvUser`), separado do `User` do SaaS. | Atendente/supervisor/fiscal precisam de login nominal, papéis e MFA; o SaaS usa outro modelo. |
| D3 | Auth do Balcão: JWT HS256 com chave derivada própria (um token do SaaS não vale aqui), refresh token opaco rotativo com detecção de reuso, TOTP opcional/obrigatório por perfil, OIDC (IdP do TJTO) via integrações. | Edital: MFA, OpenID, perfis atendente/supervisor. |
| D4 | RBAC por **permissões** (`core/permissions.ts`), 4 perfis: ATENDENTE, SUPERVISOR, ADMIN, FISCAL. Token de API (`bvt_…`) com escopos para BI. | TR 1.1.3.1.9.1 e 1.1.3.1.8.1 (painel do Fiscal). |
| D5 | **Conteúdo de mensagens cifrado em repouso** (AES-256-GCM, chave versionada, `core/crypto.ts`). Só `core/messages.ts` lê/escreve `BvMessage.body`. | TR 1.1.3.1.14.3.1 (criptografia em repouso), LGPD. |
| D6 | Todo canal entra por `ingestInbound` e sai por `sendMessage` (registro `registerChannelSender`). Módulos conversam por **eventos** (`core/events.ts`). | Frentes independentes, sem import cruzado. |
| D7 | Voz: **Asterisk (PJSIP + ARI)** em container, tronco SIP com a VoIP do TJTO, agentes por **WebRTC (SIP.js)** no navegador, gravação por `bridge record` via ARI. O controle de chamadas (ARI) roda no processo da API. | Único caminho aberto, auditável e sem licença para voz nativa com gravação; o "entroncamento SIP" do edital é PJSIP trunk. |
| D8 | WhatsApp: **Meta Cloud API oficial** (broker próprio, janela de 24 h, templates, contadores por categoria p/ itens 7–9). Evolution/Baileys do ZapScript NÃO é usado no Balcão. | TR 1.1.3.1.2.2 exige API oficial. |
| D9 | IA: base de conhecimento aprovada + **busca full-text do Postgres (português)** + LLM com resposta ancorada (JSON com confiança). Sem vetor/embeddings no MVP. Curadoria = mineração de conversas escaladas gerando sugestões revisadas por humano. | Zero infra nova, determinístico, auditável; evita alucinação (só responde com base aprovada). |
| D10 | Acessibilidade: HTML semântico/ARIA/teclado (eMAG/WCAG) + **VLibras** (avatar 3D oficial do gov.br) para Libras; videochamada via Jitsi (URL configurável) com legenda ao vivo no navegador (Web Speech API). | TR 1.1.3.1.7.1. |
| D11 | Armazenamento de objetos em disco (`BV_STORAGE_DIR`, volume na mesma região) atrás de uma interface trocável por S3-compatível. | Residência de dados no Brasil; simplicidade. |
| D12 | **Núcleo nativo; Tiledesk como base opcional/inicial para console e widget** (autorizado pelo responsável do projeto). O Balcão não depende do Tiledesk para nenhum requisito eliminatório; ver `docs/balcao/TILEDESK.md`. | Tiledesk está fora do repo e nunca foi validado aqui (ponte do Attende-ZapBot sem teste real), é open-core (branding/white label pode ser enterprise) e não cobre voz SIP, tarefas, e-Proc/GOV.BR, curadoria nem painel do fiscal. O núcleo nativo já existia e é testável. |

## 2. Mapa de frentes (propriedade de arquivos)

Cada frente é dona do seu diretório. **Não edite arquivos de outra frente** nem `core/`, `schema.prisma`, `package.json`, lockfiles.

| Frente | Diretório (api) | Prefixo HTTP | Itens do edital |
|---|---|---|---|
| iam | `balcao/iam` | `/balcao/auth`, `/balcao/admin` | perfis, MFA, usuários, auditoria (consulta), config do órgão |
| routing | `balcao/routing` | `/balcao/conversations`, `/queues`, `/supervisor`, `/contacts` | filas, roteamento, inbox, supervisão |
| whatsapp | `balcao/channels/whatsapp` | `/balcao/whatsapp` | broker oficial, itens 7–9 |
| webchat | `balcao/channels/webchat` | `/balcao/webchat` | chat/popup no site |
| email | `balcao/channels/email` | `/balcao/email` | e-mail |
| voice | `balcao/channels/voice` + `infra/asterisk` | `/balcao/voice` | voz, URA, gravação, SIP, item 11 |
| ai | `balcao/ai` | `/balcao/ai`, `/balcao/kb` | chatbot, curadoria, IQA |
| tasks | `balcao/tasks` | `/balcao/tasks` | tarefas internas, service desk, ISA |
| integrations | `balcao/integrations` | `/balcao/integrations` | e-Proc, GOV.BR, OIDC, Google, Jira |
| reports | `balcao/reports` | `/balcao/reports`, `/balcao/fiscal` | KPIs, painel do fiscal, cotas |
| security | `balcao/security`, `infra/backup`, `infra/ha` | `/balcao/security` | LGPD, retenção, exportação final, backup/DR |
| web | `apps/web/src/app/balcao` | — | consoles, admin, fiscal, widget demo |

Testes: `balcao/<frente>/__tests__/*.test.ts`. Documentação da API de cada frente: `docs/balcao/api-<frente>.md`.

## 3. Núcleo (`apps/api/src/balcao/core`) — o que já existe

| Módulo | Para que serve |
|---|---|
| `types.ts` | canais, perfis, status, itens de consumo, `BvAuthContext` |
| `permissions.ts` | `can(role, perm)`, matriz de permissões |
| `http.ts` | `bvAuth`, `requirePerm`, `guard(...perms)`, `sendError`, `parse(zod)`, `req.bv` |
| `session.ts` | `createSession`, `rotateSession`, `revokeSession(s)` (tokens de acesso/refresh) |
| `crypto.ts` | `encryptField/decryptField/encryptJson`, `blindIndex`, `hashToken`, `randomToken`, `sha256Hex` |
| `passwords.ts`, `jwt.ts` | scrypt, política de senha; JWT do Balcão |
| `settings.ts` | `getOrgSettings` (padrões + merge), horário comercial, feriados, `addBusinessSeconds` |
| `events.ts` | barramento: `onBvEvent`, `emitBvEvent` (catálogo de eventos tipado) |
| `realtime.ts` | Socket.IO ns `/bv`: `emitToUser/Org/Supervisors/Conversation`; `getIo()` p/ outros namespaces |
| `scheduler.ts` | `registerJob(name,{intervalMs},fn)` com lock Redis; `onBalcaoStart(fn)` para conexões longas (ARI, IMAP) |
| `audit.ts`, `configVersion.ts` | `audit()/auditReq()` (append-only), `recordConfigVersion()` |
| `storage.ts` | `putObject/getObjectStream/…`, `newKey`, `parseRange` |
| `usage.ts` | `recordUsage`, `setUsageGauge`, `getUsage`, `checkQuota`, `assertQuota` |
| `integrations.ts` | `getIntegration/saveIntegration` (config cifrada), `maskSecrets`, `logIntegration` |
| `counters.ts` | `nextProtocol`, `nextTaskCode` |
| `contacts.ts` | `resolveContact` (identidade única entre canais), documento cifrado, merge |
| `messages.ts` | `createMessage`, `listMessages`, `recentTranscript` (único acesso ao corpo cifrado) |
| `channels.ts` | `registerChannelSender`, `ChannelSendError` |
| `conversations.ts` | `ingestInbound`, `openConversation`, `sendMessage`, `addNote`, `escalateToHuman`, `assignConversation`, `transferConversation`, `closeConversation`, `requestCsat/recordCsat`, `canAccessConversation` |
| `presence.ts` | `setAgentPresence`, `agentLoad` |
| `tools.ts` | registro de ferramentas do bot (`registerBotTool`) — integrações registram, IA executa |
| `testing.ts` | `makeOrg`, `makeUser`, `authHeader`, `buildBalcaoTestApp` |

### Ciclo de uma conversa (quem faz o quê)

1. Canal chama `ingestInbound` → cria contato/conversa (`BOT` se `settings.ai.enabled`, senão `WAITING`) + mensagem → emite `message.inbound` (e `conversation.needs_routing` se `WAITING`).
2. **ai** assina `message.inbound` p/ conversas `BOT`: responde via `sendMessage(senderType:'BOT')` ou chama `escalateToHuman`.
3. **routing** assina `conversation.needs_routing`/`agent.available`: escolhe fila (regras), calcula SLA, escolhe atendente → `assignConversation`.
4. Atendente responde por `sendMessage(senderType:'AGENT')` → canal envia. Transferência: `transferConversation`.
5. `closeConversation` → pede NPS (`requestCsat`) → `recordCsat`. **reports** lê tudo do banco; **tasks** pode criar tarefas ligadas à conversa.

## 4. Convenções obrigatórias

- TypeScript `strict` + `noUnusedLocals/Parameters` (o CI faz `tsc --noEmit`). Mensagens ao usuário e comentários em **português**.
- Rotas: `preHandler: guard('perm', …)`, validação com **zod** (`parse(schema, body, reply)`), erros com `sendError(reply, status, 'dominio.codigo', 'mensagem')`. Auditar leituras sensíveis e mudanças de configuração (`auditReq`, `recordConfigVersion`).
- Nunca ler `BvMessage.body` direto; nunca logar corpo de mensagem, CPF, tokens ou senhas.
- Toda chamada externa (HTTP/SMTP/IMAP/ARI/LLM) atrás de uma função/classe **injetável ou mockável**; testes não podem depender de rede nem de serviços externos. Use servidores HTTP/WS locais nos testes quando fizer sentido.
- Multi-tenant: **toda** query filtra por `orgId`. Teste de isolamento entre dois órgãos em cada frente.
- Jobs: `registerJob` (nunca `setInterval` solto). Conexões longas: `onBalcaoStart`.
- Segredos de integração só via `saveIntegration` (cifrados). Variáveis de ambiente novas → documentar em `docs/balcao/ENV.md` (seção da sua frente) — não editar `.env.example`.
- Testes: `apps/api`: `source <scratchpad>/bv-env.sh && npx jest --runInBand src/balcao/<frente>`. Cada teste cria o próprio órgão (`makeOrg`); **nunca** `deleteMany()` sem filtro nem truncar tabelas (outras frentes testam em paralelo no mesmo banco).
- Typecheck: `cd apps/api && npx tsc --noEmit` — erros em arquivos de outras frentes (em andamento) não são seus; confira só os do seu diretório.
- Não fazer commit. Não editar `schema.prisma`, `package.json`, lockfiles: se faltar coluna/tabela/dependência, **use `metadata`/Json existente** ou descreva o pedido no relatório final.
- Ao terminar: escrever `docs/balcao/api-<frente>.md` (endpoints, permissões, payloads, eventos de socket, variáveis de ambiente, jobs) e uma seção **"Não verificado"** com tudo que depende de sistema externo real.

## 5. Limites conhecidos (honestidade para a PoC)

- Certificações (ISO 27001, SOC 2 Type II, ISO 27017) e data center no Brasil são **contratação/auditoria**, não código — ver `docs/balcao/INFRA-BR-CERTIFICACOES.md`.
- Integrações com e-Proc, GOV.BR, VoIP do TJTO, Google Workspace, Jira e a Meta exigem credenciais/homologação do órgão; o código é testado contra servidores simulados.
- A pontuação, os números de atendimento e os prazos finais dependem de decisão comercial (ver pontos em aberto na análise do edital).
