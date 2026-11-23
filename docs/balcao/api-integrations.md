# Balcão Virtual — API de Integrações (`/balcao/integrations`)

Frente **integrations** (`apps/api/src/balcao/integrations`). Cobre o TR 1.1.3.1.15.1 (e-Proc, Google Workspace, Jira; VoIP/URA são da frente voice) e 1.1.3.1.16.1 (IdP do TJTO e GOV.BR padrão ouro para consulta processual). Toda config fica cifrada em `BvIntegration.configEnc` (AES-GCM); chamadas externas são registradas em `BvIntegrationLog` (operação, duração, **código** do erro; nunca corpo, CPF, número de processo ou segredo).

## 1. Endpoints

Autenticação "JWT do Balcão" = `Authorization: Bearer <accessToken>`; rotas **públicas** são as do cidadão/IdP/webhook.

| Método e rota | Perm./Auth | Descrição |
|---|---|---|
| `GET /` | `integration:manage` | Lista os 10 tipos (`EPROC GOVBR OIDC_TJTO GOOGLE_WORKSPACE JIRA` + `WHATSAPP EMAIL_IMAP SIP_TRUNK URA_0800 LLM`, `managedHere:false` para os de outras frentes) com `status`, `lastCheckAt`, `lastError`. |
| `GET /:type` | idem | Config com segredos mascarados (`••••••`). |
| `PUT /:type` `{enabled?, config}` | idem | Valida (zod por tipo + SSRF nas URLs), cifra, versiona (`recordConfigVersion`) e audita `integration.update`. Segredo omitido/vazio/`••••••` **mantém o atual**. Status volta a `UNCONFIGURED` até novo teste. Só os 5 tipos desta frente. |
| `POST /:type/test` | idem | Teste de conexão específico; grava `status` OK/ERROR, `lastCheckAt`, `lastError`; audita `integration.test`. |
| `GET /:type/logs?limit=` | idem | Últimas chamadas (≤200). |
| `GET /eproc/processo/:numero?movimentos=true` | `conversation:read` | Consulta e-Proc (número CNJ com dígito verificador). Audita `eproc.consulta` com número mascarado. Erros: 400 número inválido, 403 sigiloso, 404 não encontrado, 409 não configurado, 502 indisponível. |
| `GET /govbr/authorize?conversationId&contactId&exp&sig` | pública | Início do login do cidadão (link assinado, 30 min). Redireciona ao GOV.BR. |
| `GET /govbr/callback?code&state` | pública | Retorno do GOV.BR; página HTML "Você já pode voltar ao atendimento" ou página de erro genérica. |
| `GET /oidc/login?org=<slug>` | pública | Início do login da equipe (IdP do TJTO). |
| `GET /oidc/callback?code&state` | pública | Retorno do IdP; redireciona a `frontendRedirect?code=…` (ou `?error=…`). |
| `POST /oidc/exchange` `{code}` | pública | Troca o código (uso único, 30 s) por sessão: `{accessToken, refreshToken, expiresIn, sessionId, user}`; audita `auth.oidc_login`. |
| `POST /google/meet` `{conversationId?, summary, start(ISO c/ offset), durationMin, attendees[]}` | `conversation:reply` | Cria evento na Agenda com Meet; devolve `{eventId, meetLink, start, end}`; com conversa, envia o link como mensagem do atendente. |
| `POST /google/mail/send` `{to[], subject, text}` | `conversation:reply` | Envia e-mail pelo Gmail como o usuário delegado (202). |
| `POST /jira/webhook?org=<slug>[&secret=]` | segredo | Webhook de status do Jira (ver §4.5). |
| `POST /jira/issues` `{taskId}` | `task:manage` | Cria issue manualmente (qualquer `kind`). |

**Exports para outras frentes:** `buildGovbrLoginUrl(orgId, conversationId)`, `consultarProcesso(orgId, numero, {movimentos, viewerDocument}, deps?)` (em `integrations/index.ts`).

**Ferramentas do bot** (registradas em `core/tools.ts` ao carregar o plugin): `eproc.consultar_processo` (`minIdentityLevel:'ouro'`; resumo sem partes sigilosas — partes só aparecem, mascaradas, se o CPF verificado do cidadão consta como parte/advogado) e `identity.request_login` (devolve o link GOV.BR).

## 2. Configuração por integração (campos)

Todos aceitam `allowPrivateHosts` (só homologação; **ignorado em produção**) e `timeoutMs`.

- **EPROC**: `mode: soap|rest`, `endpoint`, `wsdlUrl?`, `wsdlNamespace` (padrão MNI 2.2.2), `tiposNamespace`, `soapAction`, `idConsultante`, `senhaConsultante` (soap) ou `token` (rest), `retries` (1), `retryDelayMs`, `maxResponseBytes`, `maxMovimentos` (10), `maskPartyNames` (true), `tpu:{classes,assuntos,movimentos}` (código nacional → descrição).
- **GOVBR**: `clientId`, `clientSecret`, `redirectUri`, `issuer`, `authorizeUrl`, `tokenUrl`, `jwksUri`, `userinfoUrl?`, `confiabilidadesUrl?` (aceita `{cpf}`), `scopes`, `requiredLevel` (`ouro`), `tokenAuthMethod` (`basic`|`post`).
- **OIDC_TJTO**: mesmos campos OIDC + `frontendRedirect`, `autoProvision` (false), `defaultRole` (ATENDENTE|SUPERVISOR|FISCAL — nunca ADMIN), `roleClaim` (`groups`), `roleMapping` (`{grupo: perfil}`; ADMIN só aqui, explícito), `emailClaim`, `nameClaim`, `allowedEmailDomains?`, `requireAmr?` (MFA no IdP, ex.: `["mfa","otp"]`).
- **GOOGLE_WORKSPACE**: `serviceAccountJson` (string do JSON; cifrado/mascarado), `delegatedUser`, `calendarId`, `timeZone` (America/Araguaina), `calendarBaseUrl`/`gmailBaseUrl` (padrão Google).
- **JIRA**: `baseUrl`, `email`, `apiToken`, `projectKey`, `apiVersion` (`3` Cloud | `2` Server), `issueTypeMap`, `priorityMap`, `statusMap` (nome do status Jira em minúsculas → status da tarefa), `syncKinds` (`["SERVICE_REQUEST"]`), `webhookSecret`.

## 3. Variáveis de ambiente

| Variável | Uso |
|---|---|
| `BV_PUBLIC_API_URL` (fallback `API_PUBLIC_URL`, padrão `https://api.zapscript.me`) | Base dos links entregues ao cidadão (`/balcao/integrations/govbr/authorize…`). |
| `ENCRYPTION_KEY` | Já existente: cifra a config e deriva o índice cego do `sub` do GOV.BR. |
| `NODE_ENV=production` | Desliga `allowPrivateHosts` e exige https nas URLs de integração. |

Redis (já existente) guarda `state/nonce/code_verifier` (TTL 10 min) e códigos de troca (30 s), todos de uso único (`GET`+`DEL` atômico).

## 4. Fluxos

### 4.1 e-Proc
```
bot/atendente → consultarProcesso(org, numero)
  → valida CNJ (mod 97) → carrega config → SOAP consultarProcesso (retry curto p/ 5xx/timeout)
  → fast-xml-parser (sem DOCTYPE/ENTITY) → Fault? sigilo? sucesso=false? → erro com código eproc.*
  → normaliza {numero, classe, assunto, orgaoJulgador, situacao, dataAutuacao, partes[], ultimosMovimentos[]}
```
Saneamento: caracteres de controle/`<>` removidos, textos truncados, CPFs em descrições mascarados, movimentos sigilosos descartados; nomes de partes mascarados (`M**** da S****`). Processo com `nivelSigilo>0` ou mensagem de segredo/permissão → `eproc.sigiloso` sem dados.

### 4.2 GOV.BR (cidadão)
```
bot → identity.request_login → link assinado (HMAC, 30 min)
cidadão → GET /govbr/authorize → [state, nonce, code_verifier em Redis, 10 min] → 302 GOV.BR (PKCE S256)
GOV.BR → GET /govbr/callback?code&state → consome state (1 uso) → troca code (+verifier)
  → valida id_token (JWKS, iss, aud, exp, nonce) → sub=CPF (dígitos verificadores) → nível (confiabilidades; falha = fechado)
  → nível ≥ requiredLevel? → grava contato (CPF cifrado, govbrSub = índice cego, govbrLevel, identityVerifiedAt, nome; mescla contato duplicado)
  → mensagem SYSTEM "Identidade confirmada (nível ouro)." → página "Você já pode voltar ao atendimento"
```
### 4.3 Login da equipe (IdP do TJTO)
```
front → GET /oidc/login?org=slug → 302 IdP (PKCE) → GET /oidc/callback → valida state/nonce/PKCE/id_token
  → usuário por oidcSub, senão por e-mail verificado (recusa se já vinculado a outro sub) → senão autoProvision (perfil mapeado)
  → inativo? recusa → código de troca (30 s, uso único) → 302 frontendRedirect?code=…
front → POST /oidc/exchange {code} → createSession → tokens (nunca na URL)
```
Erros no callback voltam como `frontendRedirect?error=<invalid_state|oidc_failed|user_not_found|user_inactive|account_conflict|domain_not_allowed|mfa_required>`. O MFA é o do IdP (use `requireAmr`); o TOTP local não é pedido neste fluxo.

### 4.4 Google
Assertion JWT RS256 da conta de serviço (`sub` = usuário delegado) → `token_uri` → access token (cache até 1 min antes de expirar). Agenda: `events.insert?conferenceDataVersion=1` com `conferenceData.createRequest`. Gmail: `messages.send` com RFC 2822 UTF-8 (cabeçalhos higienizados).

### 4.5 Jira
`task.created` (emitido pela frente tasks) → se `kind ∈ syncKinds`: reserva `externalRef='JIRA-PENDING'` (idempotência/concorrência), cria a issue, grava a chave; falha libera para nova tentativa. Webhook: segredo em `X-Jira-Secret`, `?secret=` ou HMAC-SHA256 do corpo em `X-Hub-Signature(-256)`; busca a tarefa por `orgId + externalRef`, mapeia status (`statusMap`, senão `statusCategory`), grava histórico e emite `task.closed` ao concluir/cancelar.

## 5. URLs de callback a cadastrar

- **GOV.BR** (cadastro do cliente/`redirect_uri`): `https://api.zapscript.me/balcao/integrations/govbr/callback` (idêntico ao `redirectUri` configurado).
- **IdP do TJTO**: `https://api.zapscript.me/balcao/integrations/oidc/callback`; `frontendRedirect` = página do console (ex.: `https://<web>/balcao/login/oidc`) que lê `?code=` e chama `/oidc/exchange`.
- **Jira** (Webhook do projeto): `https://api.zapscript.me/balcao/integrations/jira/webhook?org=<slug>` com o segredo (Cloud: campo *secret*; senão `&secret=`).
- Google: não há callback (conta de serviço).

## 6. Segurança (hardening)

- Cliente HTTP único (`http-client.ts`): timeout, tamanho máximo de resposta, **sem seguir redirects**, bloqueio SSRF **na resolução DNS** (loopback, privados, link-local/metadata, CGNAT, multicast, IPv6 equivalentes, `localhost`, `*.internal`); `allowPrivateHosts` só com `NODE_ENV!=='production'`. Testes injetam a política via config.
- JWT/JWKS verificados com `node:crypto` (`jws.ts`, RS256/PS256/ES256; `none`/HS* rejeitados). *O `jose` v6 era ESM-only e quebrava o Jest; o código não depende mais dele.*
- state/nonce/PKCE de uso único com TTL; rate limit por IP nas rotas públicas (fail-open sem Redis); páginas de erro genéricas; `Cache-Control: no-store` e CSP restritiva nas páginas HTML.
- Segredos nunca em log/auditoria; CPF só cifrado (e mascarado com `maskDocument`/`maskCnj` quando exibido).

## 7. Testes

`source <scratchpad>/bv-env.sh && cd apps/api && npx jest --runInBand src/balcao/integrations` — servidores locais imitando e-Proc (SOAP/REST), IdP OIDC (RSA/JWKS/token com PKCE), Google (token/Agenda/Gmail) e Jira.

## 8. Checklist de homologação

- **e-Proc**: WSDL/endpoint do MNI do TJTO; credencial de consultante com perfil de consulta; versão do MNI (namespace); número de processo público, em segredo e inexistente; tabelas TPU (classes/assuntos/movimentos) ou campos de descrição devolvidos; situação processual (qual atributo/`outroParametro`); limites de taxa; certificado TLS da cadeia ICP/ITI.
- **GOV.BR**: cadastro do cliente no ambiente de homologação (staging) com `redirect_uri` exato; escopos aprovados (`govbr_confiabilidades`); formato real da resposta de confiabilidades/níveis (ids 1–3?); `sub` = CPF; conferir `iss`/JWKS de produção; autenticação do cliente no token endpoint (basic).
- **IdP do TJTO**: protocolo (OIDC), `issuer`, claims de e-mail/nome/grupos, mapeamento de grupos → perfis, `amr` de MFA, tempo de vida do `id_token`.
- **Google**: delegação de domínio no Admin Console com escopos `calendar.events` e `gmail.send`; usuário delegado com licença Meet; política do Workspace para convidados externos.
- **Jira**: tipo de issue/prioridades/workflow reais e `statusMap`; webhook com segredo; versão (Cloud v3 / Server v2).

## 9. Não verificado

Tudo abaixo foi testado **apenas contra simuladores locais**; exige o sistema real:

- Formato exato das respostas do **MNI do e-Proc/TJTO** (atributos como `classeProcessual`, `outroParametro` de situação, nomes de TPU, tratamento de `nivelSigilo` por perfil do consultante) e o contrato do modo REST (definido por nós, genérico).
- **GOV.BR**: comportamento real do `sub`, escopos, API de confiabilidades (formato/URL), `client_secret_basic`, políticas de `redirect_uri`, claim de nível. Sem endpoint de confiabilidades nem claim, o nível assumido é `bronze` (falha fechada para ouro).
- **IdP do TJTO**: claims reais, grupos, `amr`; comportamento de logout/sessão única (não implementado).
- **Google**: delegação de domínio real, criação de Meet pela API (`conferenceData`), cotas; **Jira**: payloads reais de webhook, ADF, campos obrigatórios do projeto.
- SSRF por DNS foi testado com IPs literais e `localhost`; resolução de nomes reais em rede interna do TJTO não foi exercitada.
- Integrações **não implementadas aqui**: URA 0800, VoIP/SIP (frente voice), WhatsApp, e-mail IMAP, LLM.
