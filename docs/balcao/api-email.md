# Balcão Virtual — Canal de e-mail (`/balcao/email`)

Código: `apps/api/src/balcao/channels/email`. Atende TR 1.1.3.1.2.1 (e-mail como canal), PoC 9.1.6.3.2.2 (fluxo de e-mail) e
1.1.3.1.12.1 (100 % das interações registradas): toda mensagem de entrada e de saída vira `BvMessage` na conversa do
contato (histórico unificado, atribuição a atendente pelo roteamento), com cabeçalhos de thread guardados em `channelMeta`.

## Visão geral

| Sentido | Como | Observações |
|---|---|---|
| Entrada (IMAP) | job `balcao.email.poll` → `ImapPoller` (imapflow) | controle por UID/uidValidity em `BvMailbox`; `\Seen` só após ingerir |
| Entrada (HTTP) | `POST /inbound` | provedores que entregam e-mail por webhook; segredo compartilhado |
| Saída (SMTP) | `registerChannelSender('EMAIL')` (nodemailer) | disparado por `sendMessage` do núcleo |
| Simulador | `POST /dev/simulate-inbound` | só com `BV_DEV_SIMULATORS=1` |

Todo cliente externo está atrás de interface injetável (`ImapClientFactory`, `MailTransportFactory` — `setImapClientFactory`,
`setMailTransportFactory`); os testes usam fakes e **nenhuma rede**.

## Endpoints (todos exigem `integration:manage`, exceto `/inbound`)

### `GET /config`
`{ configured, enabled, status, lastError, lastCheckAt, config (segredos "••••••"), webhook: { path, secretConfigured } }`

### `PUT /config`
Corpo (zod): `imap`, `smtp`, `auth?` (OAuth2, abaixo), `from`, `mailbox?`, `autoReply?`, `pollIntervalSec?` (10–3600, padrão 30), `inboundSecret?`, mais
`enabled?` e `generateInboundSecret?` (gera segredo de 48 hex e o devolve **uma única vez** em `inboundSecret`).
Segredos omitidos (ou `"••••••"`) preservam o valor salvo, desde que o `user` não mude. **Sem `auth`**, IMAP e SMTP exigem `user` e `pass` ou
`accessToken`. Grava cifrado (`saveIntegration`), cria/atualiza `BvMailbox`, versiona (`recordConfigVersion`) e audita
(`config.update`, sem segredos). 400 `email.credentials_required` (`error.details` = lista de problemas, ex.: `"auth: informe refreshToken"`).

#### OAuth2 (Google Workspace) com renovação automática — `auth`
```json
PUT /balcao/email/config
{ "imap": { "host": "imap.gmail.com", "port": 993, "secure": true },
  "smtp": { "host": "smtp.gmail.com", "port": 465, "secure": true },
  "auth": { "type": "oauth2", "clientId": "123.apps.googleusercontent.com", "clientSecret": "GOCSPX-…",
            "refreshToken": "1//0g…", "user": "balcao@tjto.exemplo.br", "tokenUrl": "https://oauth2.googleapis.com/token" },
  "from": { "name": "Balcão Virtual TJTO", "address": "balcao@tjto.exemplo.br" } }
→ 200 { "ok": true, "enabled": true,
        "config": { …, "auth": { "type": "oauth2", "clientId": "123.apps…", "clientSecret": "••••••", "refreshToken": "••••••",
                                 "user": "balcao@tjto.exemplo.br", "tokenUrl": "https://oauth2.googleapis.com/token" } } }
```
- `auth.type` = `"oauth2"` (único valor); `clientId`, `user` (e-mail da conta dona do refresh token) obrigatórios; `clientSecret` e `refreshToken` obrigatórios **na
  primeira vez** (depois, omitir ou `"••••••"` preserva o salvo — trocar `user` exige reenviar o `refreshToken`; trocar `clientId` exige reenviar o `clientSecret`);
  `tokenUrl` opcional (padrão `https://oauth2.googleapis.com/token`; **https obrigatório** — `http` só em teste/`BV_EMAIL_OAUTH_ALLOW_HTTP=1`; omitir ou `"••••••"` preserva).
  `tokenUrl` **não** é mascarada nas respostas; `clientSecret` e `refreshToken` são `"••••••"` em GET/PUT/auditoria/versão de config.
- Com `auth`, `imap.user`/`smtp.user` podem ser omitidos (usa `auth.user`) e `pass`/`accessToken` **não são guardados** (os já existentes são removidos ao migrar).
- O **access token** é obtido e renovado sozinho (`grant_type=refresh_token`, form POST): em cache até **1 min antes de expirar**; chamadas concorrentes dividem uma
  renovação; se o servidor (IMAP `AUTHENTICATIONFAILED` / SMTP 535) recusar o token em cache, renova **uma vez** e tenta de novo. IMAP usa **XOAUTH2** (imapflow
  `auth.accessToken`) e SMTP usa nodemailer `auth {type:'OAuth2', user, accessToken}`. Falha de renovação (ex.: `invalid_grant` = refresh token revogado) aparece como
  `Renovação do token OAuth2 recusada (invalid_grant)…` em `lastError`/`config/test` (sem segredos), e no envio vira `FAILED` com `email.oauth_failed`
  (ou `email.oauth_unavailable`, retentável, se o servidor de token estiver inacessível).

### `POST /config/test`
Corpo opcional (config parcial para testar antes de salvar; `auth` com `"••••••"` herda os segredos salvos). Resposta `{ ok, imap:{ok,error?}, smtp:{ok,error?} }` — erros
sem credenciais. IMAP: conecta e abre a pasta; SMTP: `verify()`. Com `auth`, **exercita o fluxo OAuth2** (busca/renova o token no `tokenUrl` e o entrega ao IMAP e ao SMTP).
Sem corpo, usa a config salva e atualiza o status da integração.

### `GET /mailboxes`
`{ items: [{ id, address, folder, enabled, uidValidity, lastUid, lastPolledAt, lastError }] }` (BigInt como string).

### `POST /poll`
Força a coleta agora (ignora o intervalo). `{ polled, fetched, ingested, duplicates, ignored, failed, uidValidityReset?, error? }`.
404 `email.not_configured` se não houver config habilitada. Auditado (`email.poll`).

### `POST /inbound?org=<orgId|slug>` (sem JWT)
Header `X-Inbound-Secret` = `config.inboundSecret` (comparação em tempo constante; sem segredo configurado nunca autentica).
Corpo: `Content-Type: message/rfc822` (MIME bruto) **ou** JSON `{ "raw": "<MIME>", "encoding"?: "base64" }`. Limite 40 MB.
Respostas: `{status:'ingested',conversationId,messageId,protocol,isNew,matchedBy}` | `{status:'duplicate',conversationId}` |
`{status:'ignored',reason}`; 401 `email.unauthorized` (secreto errado, ausente, órgão inexistente — sem distinguir);
400 `email.invalid_body`. Provedores que só enviam `multipart/form-data` (Mailgun/SendGrid "parsed") precisam usar a opção de
postar o MIME bruto.

### Simulador (`BV_DEV_SIMULATORS=1`)
- `POST /dev/simulate-inbound` `{ from, name?, subject, text, messageId?, inReplyTo? }` → mesmo pipeline de entrada.
- `GET /dev/outbox` → últimos e-mails enviados. Em modo dev, órgão **sem** config SMTP envia para essa caixa em memória
  (nunca para a rede), o que permite demonstrar o fluxo completo da PoC sem caixa real.

## Config de exemplo (`BvIntegration`, type `EMAIL_IMAP`)

```json
{
  "imap": { "host": "imap.gmail.com", "port": 993, "secure": true, "user": "balcao@tjto.exemplo.br", "pass": "<senha de app>" },
  "smtp": { "host": "smtp.gmail.com", "port": 465, "secure": true, "user": "balcao@tjto.exemplo.br", "pass": "<senha de app>" },
  "from": { "name": "Balcão Virtual TJTO", "address": "balcao@tjto.exemplo.br" },
  "mailbox": "INBOX",
  "autoReply": { "enabled": true, "text": "Recebemos sua mensagem. Protocolo: {{protocolo}}." },
  "pollIntervalSec": 30,
  "inboundSecret": "<48 hex gerados por generateInboundSecret>"
}
```

**Google Workspace:** (a) habilitar IMAP no Admin Console; (b) com 2FA, criar uma **senha de app** para a conta e usá-la em
`pass` (mais simples, funciona para IMAP e SMTP); (c) **OAuth2 com renovação automática** (`auth`, acima): crie um cliente OAuth no Google Cloud (tipo "aplicativo
da Web"/"computador"), autorize o escopo `https://mail.google.com/` para a conta com `access_type=offline` + `prompt=consent` e guarde o **refresh token**; (d) `accessToken`
estático em `imap`/`smtp` (usado **como está**, sem renovação; expira em ~1 h — só para teste). SMTP: 465 (`secure:true`) ou 587 (`secure:false`, STARTTLS).
Contas Google bloqueiam "apps menos seguros"; senha normal não funciona.

## Regras de entrada

- **Threading** (nesta ordem): (1) token `[PREFIXO-AAAA-NNNNNN]` no assunto (prefixo = `protocolPrefix` do órgão; só vale se o
  remetente é o contato da conversa — o protocolo é sequencial); (2) `In-Reply-To`/`References` casando com
  `channelMessageId` de qualquer mensagem do órgão; (3) mesmo remetente + assunto normalizado (sem Re:/Fwd:/RES:/ENC:/protocolo)
  em conversa aberta. Sem match: novo thread, `channelRef` = 1º `References` / `In-Reply-To` / próprio `Message-ID`.
- **Ignorados (sem conversa, evita loop):** `Auto-Submitted` ≠ `no`, `Precedence` bulk/junk/list/auto_reply,
  `X-Auto-Response-Suppress`, `X-Autoreply`/`X-Autorespond`/`X-Failed-Recipients`, `multipart/report` (DSN), `Return-Path: <>`,
  remetentes `mailer-daemon|postmaster|no-reply|noreply|do-not-reply|nao-responda|bounce(s)` e os próprios endereços do órgão
  (`from.address`, `imap.user`, `smtp.user`). Ficam não lidos na caixa.
- **Corpo:** `text/plain`; só HTML vira texto (sem script/estilo). Anexos até 20 MB vão para `storage` (`attachments`),
  maiores ficam descritos em `channelMeta.skippedAttachments`. Mensagem > 40 MB não é baixada.
- **Antivírus (ClamAV opcional, `BV_CLAMAV_HOST`/`BV_CLAMAV_SOCKET`):** cada anexo é gravado com `putObject(…, { scan: true })` (IMAP e webhook). Recusado
  (`AttachmentRejectedError`: `infected`, ou `scan_unavailable` com o clamd fora e `BV_CLAMAV_FAIL_MODE` ≠ `open`) → o anexo é **descartado** (nada fica no storage) e a
  mensagem é ingerida normalmente com `channelMeta.attachmentsRejected: [{ name, reason: 'infected' | 'scan_unavailable' }]`. Sem ClamAV configurado, nada muda.
- **Dedupe:** `Message-ID` (por órgão). Sem Message-ID, usa hash do conteúdo.
- **UID:** `BvMailbox.lastUid/uidValidity`. Primeira sincronização (ou `uidValidity` diferente) ingere apenas **não lidas dos últimos
  7 dias** e posiciona o `lastUid` no fim; o dedupe impede duplicar. Lotes de 25 (até 5 por ciclo). Falha em uma mensagem não
  impede as demais: ela não é marcada como lida, o UID não avança além dela e é retentada até 3 vezes (depois é abandonada,
  com `lastError`).
- **Uso:** `EMAIL_IN` por mensagem ingerida.

## Regras de saída

- `From` = `config.from`; `To` = e-mail do contato; assunto `Re: <assunto> [PROTOCOLO]`; `In-Reply-To` = último `Message-ID` do
  thread; `References` = cadeia (raiz + até 14 últimos); `Message-ID` próprio `<uuid@domínio-do-from>` gravado em
  `channelMessageId`. Texto + HTML seguro (tudo escapado). Citação da última mensagem do cidadão com
  `channelMeta: { quote: true }` no `sendMessage`. Anexos só do storage do próprio órgão (≤ 25 MB no total).
- **Resposta automática** (`autoReply.enabled`): na criação da conversa, 1 por conversa (`metadata.emailAutoReplySent`), nunca
  para remetentes automáticos (nem chegam a criar conversa); `{{protocolo}}` é substituído, e se ausente o protocolo é anexado.
  Vai com `Auto-Submitted: auto-replied`, `X-Auto-Response-Suppress: All`, `Precedence: bulk` e fica registrada no histórico (SYSTEM).
- **Erros** (`BvMessage.errorCode`, status `FAILED`): `email.smtp_failed`, `email.invalid_recipient`, `email.not_configured`,
  `email.attachment_invalid`, `email.attachments_too_large`, `email.unsupported_kind`, `email.oauth_failed`, `email.oauth_unavailable` (retentável).
- **Uso:** `EMAIL_OUT` por envio bem-sucedido.

## Job

`balcao.email.poll` — `registerJob` a cada 10 s com lock Redis; cada órgão só é coletado quando `pollIntervalSec` (padrão 30 s)
venceu desde `lastPolledAt`. Coleta por polling (sem IDLE/conexão longa; não usa `onBalcaoStart`). Desligado em `NODE_ENV=test`/`BV_JOBS=off`.

## Variáveis de ambiente

Nova: `BV_EMAIL_OAUTH_ALLOW_HTTP=1` (permite `auth.tokenUrl` em `http://`, só para homologação/teste). Do core: `BV_CLAMAV_HOST|PORT|SOCKET|FAIL_MODE|TIMEOUT_MS` (antivírus dos anexos).
Usadas: `BV_DEV_SIMULATORS=1` (simulador + caixa de saída dev), `BV_STORAGE_DIR` (anexos), `BV_JOBS=off`
(desliga jobs), `ENCRYPTION_KEY` (config e corpo cifrados).

## Testes

`cd apps/api && source <scratchpad>/bv-env.sh && npx jest --runInBand src/balcao/channels/email` — 69 testes (parse de fixtures
gerados com nodemailer/mailparser, anti-loop, threading, UID/uidValidity, dedupe, saída com MIME real, SMTP falho, webhook,
config mascarada, isolamento entre órgãos, simulador; `oauth.test.ts`: servidor de token HTTP falso, cache/renovação com relógio injetado, SMTP real mínimo com XOAUTH2,
imapflow mockado, `/config/test`, coleta e envio com retry; `antivirus.test.ts`: clamd falso via TCP). O teste monta um app Fastify só com este plugin (não depende das demais frentes).

## Não verificado

- **IMAP real** (imapflow contra Gmail/Exchange/Dovecot): o adaptador `ImapFlowSession` (busca `uid N:*`, `seen+since`, `fetchOne`
  por UID, `messageFlagsAdd`) e o comportamento de `uidValidity` em servidores reais foram escritos contra a API/tipos do imapflow,
  mas só testados via fake.
- **SMTP real**: autenticação (senha de app / OAuth2), TLS/STARTTLS, mapeamento de códigos de erro, limites do provedor (ex.: Gmail
  500/dia), SPF/DKIM/DMARC do domínio remetente (entregabilidade).
- **OAuth2 contra o Google real**: o fluxo foi testado com um servidor de token HTTP falso (`/token`), um SMTP mínimo que aceita XOAUTH2 e o construtor do imapflow
  mockado — **não** contra `oauth2.googleapis.com`, nem IMAP/SMTP do Gmail com XOAUTH2 real (escopo `https://mail.google.com/`, consentimento, expiração do refresh token em apps
  "em teste" = 7 dias, revogação pelo admin, limites). **Microsoft 365/Exchange Online** (outro `tokenUrl` e `scope`) não é suportado: o corpo do refresh não envia `scope`.
- **Antivírus**: testado com um clamd falso (INSTREAM); ClamAV real (assinaturas, desempenho com anexos de 20 MB) não verificado. Com clamd fora e `fail-closed` o anexo é descartado
  (não há reprocessamento no e-mail: a mensagem já foi marcada como lida).
- **Provedores de webhook** (Mailgun, SendGrid, SES, Postmark) — formato exato e reentrega não testados; só MIME bruto/JSON `{raw}`.
- Caixas grandes/lentas, mensagens malformadas exóticas (charsets raros, S/MIME), cabeçalho `Return-Path` removido pelo MTA
  (não confiável como sinal único de bounce).
- Segurança de rede: o host IMAP/SMTP vem da config do ADMIN (possível uso para sondar a rede interna); restrinja o egress do servidor.
