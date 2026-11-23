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
Corpo (zod): `imap`, `smtp`, `from`, `mailbox?`, `autoReply?`, `pollIntervalSec?` (10–3600, padrão 30), `inboundSecret?`, mais
`enabled?` e `generateInboundSecret?` (gera segredo de 48 hex e o devolve **uma única vez** em `inboundSecret`).
Segredos omitidos (ou `"••••••"`) preservam o valor salvo, desde que o `user` não mude. IMAP e SMTP exigem `pass` ou
`accessToken`. Grava cifrado (`saveIntegration`), cria/atualiza `BvMailbox`, versiona (`recordConfigVersion`) e audita
(`config.update`, sem segredos).

### `POST /config/test`
Corpo opcional (config parcial para testar antes de salvar). Resposta `{ ok, imap:{ok,error?}, smtp:{ok,error?} }` — erros
sem credenciais. IMAP: conecta e abre a pasta; SMTP: `verify()`. Sem corpo, usa a config salva e atualiza o status da integração.

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
`pass` (caminho recomendado, funciona para IMAP e SMTP); (c) alternativamente OAuth2 com `accessToken` — o token é usado
**como está** (sem renovação automática; expira em ~1 h), portanto serve para teste, não para produção. SMTP: 465 (`secure:true`)
ou 587 (`secure:false`, STARTTLS). Contas Google bloqueiam "apps menos seguros"; senha normal não funciona.

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
  `email.attachment_invalid`, `email.attachments_too_large`, `email.unsupported_kind`.
- **Uso:** `EMAIL_OUT` por envio bem-sucedido.

## Job

`balcao.email.poll` — `registerJob` a cada 10 s com lock Redis; cada órgão só é coletado quando `pollIntervalSec` (padrão 30 s)
venceu desde `lastPolledAt`. Coleta por polling (sem IDLE/conexão longa; não usa `onBalcaoStart`). Desligado em `NODE_ENV=test`/`BV_JOBS=off`.

## Variáveis de ambiente

Nenhuma nova. Usadas: `BV_DEV_SIMULATORS=1` (simulador + caixa de saída dev), `BV_STORAGE_DIR` (anexos), `BV_JOBS=off`
(desliga jobs), `ENCRYPTION_KEY` (config e corpo cifrados).

## Testes

`cd apps/api && source <scratchpad>/bv-env.sh && npx jest --runInBand src/balcao/channels/email` — 45 testes (parse de fixtures
gerados com nodemailer/mailparser, anti-loop, threading, UID/uidValidity, dedupe, saída com MIME real, SMTP falho, webhook,
config mascarada, isolamento entre órgãos, simulador). O teste monta um app Fastify só com este plugin (não depende das demais frentes).

## Não verificado

- **IMAP real** (imapflow contra Gmail/Exchange/Dovecot): o adaptador `ImapFlowSession` (busca `uid N:*`, `seen+since`, `fetchOne`
  por UID, `messageFlagsAdd`) e o comportamento de `uidValidity` em servidores reais foram escritos contra a API/tipos do imapflow,
  mas só testados via fake.
- **SMTP real**: autenticação (senha de app / OAuth2), TLS/STARTTLS, mapeamento de códigos de erro, limites do provedor (ex.: Gmail
  500/dia), SPF/DKIM/DMARC do domínio remetente (entregabilidade).
- **OAuth2** do Google/Microsoft: sem renovação de token; `accessToken` estático.
- **Provedores de webhook** (Mailgun, SendGrid, SES, Postmark) — formato exato e reentrega não testados; só MIME bruto/JSON `{raw}`.
- Caixas grandes/lentas, mensagens malformadas exóticas (charsets raros, S/MIME), cabeçalho `Return-Path` removido pelo MTA
  (não confiável como sinal único de bounce).
- Segurança de rede: o host IMAP/SMTP vem da config do ADMIN (possível uso para sondar a rede interna); restrinja o egress do servidor.
