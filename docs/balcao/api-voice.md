# Balcão Virtual — Canal de voz (`/balcao/voice`)

Código: `apps/api/src/balcao/channels/voice` · Asterisk: `infra/asterisk` (README com o passo a passo de implantação).
Atende TR 1.1.3.1.2.3 e 1.1.3.1.12.1 (voz nativa, gravação e armazenamento de 100 % das chamadas, com busca/reprodução/API),
1.1.3.1.6.1 (URA com cut-thru, force-play e echo), 1.1.3.1.15.2 (entroncamento SIP com a VoIP do TJTO — PoC eliminatória),
URA 0800 (cabeçalhos SIP `X-*`), aviso de gravação, protocolo por interação telefônica, softphone WebRTC do atendente e o
item 11 (canais simultâneos e minutos de voz).

## 1. Arquitetura

```
                       ┌──────────────────────── Vultr (um servidor) ─────────────────────────┐
 Cidadão ─► PSTN/0800 ─┤                                                                        │
   TJTO VoIP / SBC     │   ┌────────────── container Asterisk 20 ─────────────┐                │
   ──SIP+RTP (5060,    │   │ PJSIP  tjto-trunk  (identify por IP / auth)        │   ARI HTTP+WS  │
      10000-10200/udp)─┼──►│ dialplan from-trunk → Stasis(balcao,in,<DID>)      │◄──────────────┐│
                       │   │ ARI :8088 (só rede Docker)   WSS :8089 (/ws)       │               ││
                       │   │ gravação em /var/spool/asterisk/recording (WAV)    │               ││
                       │   └──────▲──────────────────────────────▲─────────────┘               ││
                       │          │ volumes: recordings, sounds  │ WebRTC (DTLS-SRTP)          ││
                       │   ┌──────┴──────────────────────────────┴───────┐                     ││
                       │   │ API Balcão (processo único) ── AriController ├─────────────────────┘│
                       │   │  URA (ivr.ts) · fila → routing (assigned)    │                      │
                       │   │  gravações → core/storage (sha256) · usage   │── Socket.IO /bv ──► Console (Softphone SIP.js)
                       │   │  rotas HTTP /balcao/voice/*                  │                      │
                       │   └──────────────────────────────────────────────┘                      │
                       └────────────────────────────────────────────────────────────────────────┘
 Atendente (navegador, SIP.js) ──wss://<host>:8089/ws── Asterisk   (credenciais: GET /balcao/voice/softphone)
```

Ciclo de uma chamada recebida (`controller.ts`):

1. `StasisStart(args: in,<DID>)` → cria `BvCall` (RINGING) e a conversa `VOICE` (`BOT`, **protocolo atribuído na hora**); resolve o
   órgão pelo DID (`resolveOrgForDid`: `definition.dids` do fluxo ACTIVE → `dids` da integração SIP_TRUNK/URA_0800 → `BV_VOICE_ORG_ID` →
   único órgão com tronco). DID desconhecido: a chamada é atendida e derrubada (`rejected`), nada é criado.
2. Atende, **inicia a gravação** da fase da URA (`recordIvrPhase`, padrão ligado), toca o **aviso de gravação**
   (`settings.recordingNotice`, *force-play*: não interrompível; marca `recordingNotified`) e fala o **protocolo** (`speakProtocol`).
3. Roda a **URA** (fluxo ACTIVE do DID, definição congelada no início da chamada) → `queue` | `transfer` | `hangup`.
4. `queue`: toca música de espera, conversa `WAITING` (`escalateToHuman`) → **routing** escolhe o atendente (`conversation.assigned`)
   → a API origina `PJSIP/<ramal>` → o softphone atende → ponte `mixing` + **gravação da ponte** (a da URA é encerrada).
   Não atendeu em `BV_AGENT_RING_SEC` / recusou / caiu: o atendente fica `AWAY` e a conversa volta à fila (`REQUEUED`).
   Espera máxima `BV_VOICE_MAX_QUEUE_SEC` (20 min), depois mensagem e `QUEUE_TIMEOUT`.
5. Fim: para as gravações, move os WAV para o storage (sha256 + tamanho em `BvCall`), calcula duração, **registra `VOICE_MINUTES`**,
   fecha a conversa (sem CSAT por voz), emite `call:ended` e `call.ended` no barramento.

Chamada **originada** (click-to-call): `POST /calls/dial` toca o ramal do atendente; ao atender (o softphone atende sozinho) a API
disca o número pelo tronco, faz a ponte e grava. **Transbordo** (`POST /calls/:id/transfer` ou nó `transfer` da URA): a API origina
`PJSIP/<número>@tjto-trunk` e liga o destino à ponte; o atendente sai e a ligação segue gravada até o fim. É transbordo por ponte
(blind transfer com mídia passando pelo Balcão), **não** SIP REFER. Se o destino não atende em `transferRingSec`, o atendente continua
com o cidadão e recebe `call:transfer_failed`.

Higiene/robustez: reconexão do ARI com backoff exponencial + jitter; a cada (re)conexão `reconcile()` encerra chamadas "vivas" do banco
sem canal no Asterisk (`LOST_CONTROL`); job `voice.stale-calls` (5 min) encerra as vivas há > 6 h (`STALE`); gravação que termina depois
da chamada (queda da API) é recuperada e anexada.

> **Uma única instância da API deve controlar o ARI.** Duas réplicas conectadas à mesma aplicação (`balcao`) receberiam os mesmos
> eventos e tratariam cada chamada em duplicidade. O deploy atual (Vultr, um container de API) atende; para HA use ARI por réplica
> com aplicações Stasis distintas (`BV_ARI_APP`) ou eleição de líder — fora do MVP.

## 2. Requisitos do edital × implementação

| Requisito | Onde | Teste |
|---|---|---|
| Gravação de 100 % das chamadas (1.1.3.1.2.3 / .12.1) | gravação da URA (canal) desde o atendimento + gravação da ponte; `GET /recording/coverage` mede a cobertura | `ari.test.ts` (arquivo no storage, sha256), `voice.test.ts` (cobertura) |
| Busca / reprodução / API das gravações | `GET /calls` (filtros), `GET /calls/:id/recording` (**Range 206**, `recording.listen` auditado), `/recording/meta?verify=true` | `voice.test.ts` |
| URA: cut-thru, force-play, echo (1.1.3.1.6.1) | `bargeIn`/`forcePlay` no `menu`/`play`; `echo`+`confirm` no `collect` | `ivr.test.ts`, `ari.test.ts` (DELETE /playbacks) |
| Árvore editável **sem interromper o serviço** | rascunho → `publish` (transação, lock por órgão+nome); chamadas em curso seguem com a definição carregada; rollback = publicar versão arquivada | `voice.test.ts` |
| Múltiplos idiomas | nó `language` + `i18n` nos prompts + frases padrão pt-BR/en/es | `ivr.test.ts` |
| Protocolo por interação telefônica | protocolo da conversa falado no início (`speakProtocol`) | `ari.test.ts` |
| Entroncamento SIP com a VoIP do TJTO | `infra/asterisk` (PJSIP trunk ip/userpass/registration), `PUT /config`, `POST /config/test`, transbordo/click-to-call pelo tronco | `ari.test.ts`, `voice.test.ts` (**PoC real: não verificado**) |
| URA 0800: cabeçalhos `X-*` | dialplan → `BV_X_*` + leitura `PJSIP_HEADER` de `preserveHeaders` → `metadata.voice.headers`; `entryByHeader` escolhe o início | `ari.test.ts`, `ivr.test.ts` |
| Aviso de gravação | `settings.recordingNotice` falado em *force-play* antes de qualquer menu; `recordingNotified` | `ari.test.ts` |
| Softphone WebRTC do atendente | `GET /softphone` (credenciais derivadas) + `apps/web/.../_softphone/Softphone.tsx` (SIP.js) | `voice.test.ts` (paridade com o Asterisk) |
| Item 11 | `VOICE_PEAK_CHANNELS` (gauge, máximo do dia, entrada + saída) e `VOICE_MINUTES` (minutos por chamada, arredondados para cima, mín. 1) | `ari.test.ts` |

## 3. Endpoints

Prefixo `/balcao/voice`. Erros: `{ "error": { "code", "message", "details"? } }`. Todas as consultas filtram por órgão
(multi-tenant); chamada de outro órgão = 404.

### Chamadas e gravações

| Método e caminho | Permissão | Corpo / query | Resposta |
|---|---|---|---|
| `GET /status` | `conversation:monitor` | — | `{ enabled, connected, started, app, url, reconnects, lastEventAt, lastError, activeCalls, byState }` (`started:false` = controlador desligado) |
| `GET /calls` | `conversation:read` (atendente só vê as suas; `conversation:read_all` vê todas) | `from`,`to` (ISO), `number` (parte do número, dígitos), `agentUserId`, `status` (RINGING\|IVR\|QUEUED\|ACTIVE\|ENDED\|ABANDONED\|FAILED), `direction` (IN\|OUT), `protocol` (contém), `hasRecording` (true\|false), `minDuration`,`maxDuration` (s), `limit` (1–200, 50), `cursor` | `{ items: CallDto[], nextCursor }` ordenado do mais recente |
| `GET /calls/:id` | `conversation:read` | — | `CallDto` + `voice { did, headers (X-* da URA 0800), flow, transferredTo, transferredAt, simulated, hasUraRecording }` + `ivr { lang, category, queue, outcome, vars, sensitiveCollected }` |
| `GET /calls/:id/recording` | `recording:listen` | `part=main\|ura` (padrão `main`), `download=true`, header `Range: bytes=a-b` | `audio/wav`; **200** completo ou **206** com `Content-Range`; `416` se o Range for inválido; audita `recording.listen` (`entityId`=chamada, `meta.part/range/download/protocol`). 404 `recording.not_found` |
| `GET /calls/:id/recording/meta` | `recording:listen` | `verify=true` recalcula o sha256 do arquivo | `{ callId, format, sha256, sizeBytes, durationSec, recordedAt, integrityOk? }` (audita `recording.meta`) |
| `GET /recording/coverage` | `report:read` (supervisor, admin, **fiscal**) | `from`,`to` | `{ total, withRecording, withoutRecording, coveragePct, recentMissing: [{id,startedAt,endReason}] }` — conta chamadas finalizadas atendidas pela plataforma (IN ENDED/ABANDONED, ou com `answeredAt`) |
| `POST /calls/:id/transfer` | `conversation:transfer` | `{ number }` (`^\+?[0-9*#]{2,20}$`) | `202 { ok }` · 409 `call.not_active` / `call.transfer_in_progress` · 404 · 503 `voice.disabled`; audita `call.transfer` (só os 4 últimos dígitos) |
| `POST /calls/:id/hangup` | `conversation:close` | — | `{ ok }` · 404 |
| `POST /calls/dial` | `conversation:reply` | `{ number }` | `202 { callId, conversationId }` · 409 `voice.no_extension`/`voice.busy` · 502 `voice.originate_failed`; audita `call.dial` |
| `GET /softphone` | `conversation:reply` | — | `{ wssUrl, sipUri, domain, ramal, senha, iceServers, displayName }` com `Cache-Control: no-store`; 409 `voice.no_extension`; 503 `voice.not_configured` (sem `BV_SIP_SECRET`); audita `softphone.credentials` |

`CallDto`: `{ id, conversationId, protocol, direction, from, to, status, agentUserId, startedAt, answeredAt, endedAt, durationSec,
ivrFlowId, ivrPath, recordingNotified, endReason, hasRecording, recordingSha256, recordingSizeBytes }`. `endReason` típicos:
`CALLER_HANGUP[_IVR|_QUEUE]`, `AGENT_HANGUP[_API]`, `AGENT_NO_ANSWER`, `IVR_END`, `IVR_MAX_RETRIES`, `QUEUE_TIMEOUT`, `TRANSFERRED`,
`TRANSFER_FAILED|TIMEOUT`, `DIAL_FAILED`, `ORIGINATE_FAILED`, `CONVERSATION_CLOSED`, `LOST_CONTROL`, `STALE`, `SIMULATED`, `ERROR`.

### URA (todas `ivr:manage`)

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `GET /ivr/flows` | query `status`, `name` | `{ items: [{ id, name, version, status, language, dids, publishedAt, createdAt, createdById }] }` |
| `POST /ivr/flows` | `{ name, language?, definition }` | `201` rascunho (versão = última+1) + `validation { ok, errors, warnings }`. Aceita erros de grafo (trabalho em andamento); estrutura inválida = 422 `ivr.invalid` |
| `GET /ivr/flows/:id` | — | fluxo com `definition` |
| `PUT /ivr/flows/:id` | `{ language?, definition? }` | só **rascunho** (409 `ivr.not_draft` se ativo/arquivado) |
| `DELETE /ivr/flows/:id` | — | `204`; só rascunho |
| `POST /ivr/flows/:id/publish` | — | torna **ACTIVE** (aceita DRAFT ou ARCHIVED → rollback) e arquiva a anterior do mesmo nome, em uma transação; 422 `ivr.invalid` se houver erros; 409 `ivr.did_conflict` se outro fluxo ativo já atende um dos DIDs; `{ …flow, archivedId, warnings }`; versiona (`IVR_FLOW`), audita `ivr.publish` e pré-aquece os prompts de texto (TTS) |
| `POST /ivr/validate` | `{ definition }` | `{ ok, errors, warnings }` |
| `POST /ivr/flows/:id/simulate` · `POST /ivr/simulate` | `{ inputs[], at?, lang?, headers?, definition? }` | `{ outcome, trail, lang, vars, sensitiveVars, spoken[], unusedInputs[], validation }` — roda a URA sem telefonia (`at` simula horário/feriado) |
| `POST /ivr/prompts?ext=wav&name=` | corpo bruto `audio/wav` (≤ 12 MB; WAV PCM 16-bit mono 8/16 kHz; também `sln`, `sln16`, `sln24`, `ulaw`, `alaw`, `gsm`) | `201 { audioKey, sizeBytes, sha256 }` — use `audioKey` no `prompt` do nó |

Entradas do simulador (na ordem em que o motor pede): `"1"` = dígito após o prompt · `""`/`"timeout"` = sem resposta · `"~1"` = dígito
**durante** o prompt (cut-thru; em *force-play* é descartado) · `"12345#"` = sequência para `collect`.

### Configuração do tronco (`integration:manage`)

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `GET /config` | — | `{ configured, enabled, status, config (segredos "••••••"), defaults, environment { voiceEnabled, ariUrl, agentExtensions, sipSecretConfigured } }` |
| `PUT /config` | `{ enabled?, config }` (zod **strict**; campos abaixo). `"••••••"` preserva a senha guardada | `{ ok, config }`; grava cifrado (`SIP_TRUNK`), versiona e audita `config.update` sem segredos. Se `BV_VOICE_ENABLED=1` e o ARI ainda não conectou, tenta conectar já |
| `POST /config/test` | — | `{ ok, ari { ok, version, connected }, trunk { endpoint, state } }` (`ok` = tronco `online`); atualiza o status da integração; 503 sem telefonia, 502 se o ARI falhar |

Campos de `config`: `host`, `port`, `transport` (udp\|tcp\|tls), `authMode` (registration\|userpass\|ip), `username`, `password`,
`identifyIps[]`, `codecs[]` (ulaw\|alaw\|opus\|g722), `dtmfMode`, `fromUser`, `fromDomain` (referência/documentação — o que vale para o
Asterisk são as variáveis `BV_TRUNK_*`), **`trunkEndpoint`** (nome do endpoint PJSIP usado para discar, padrão `tjto-trunk`), **`dids[]`**,
**`preserveHeaders[]`** (apenas `X-*`; padrão `X-URA-Option`, `X-URA-Id`, `X-Protocolo-0800`), `transferCallerId` (`original`\|`trunk`),
`transferRingSec` (5–120, 45), `speakProtocol` (`start`\|`off`), `autoCloseOnEnd`, `recordIvrPhase` (**manter `true`**: com `false` o
cidadão que desliga na URA/fila não é gravado, o que viola "100 %"), `ari { url, username, password }` (alternativa às `BV_ARI_*`).
Mudar credenciais do ARI exige reiniciar a API; `dids`, cabeçalhos, transbordo etc. valem na próxima chamada.

```json
PUT /balcao/voice/config
{ "enabled": true,
  "config": { "trunkEndpoint": "tjto-trunk", "dids": ["08006320000", "6332180000"],
              "preserveHeaders": ["X-URA-Option", "X-URA-Id", "X-Protocolo-0800"],
              "transferRingSec": 45, "transferCallerId": "original" } }
```

### Simulador (desenvolvimento)

`POST /dev/simulate-call` — `ivr:manage` e **somente** com `BV_DEV_SIMULATORS=1` (senão 404). Corpo `{ from, did, inputs[], headers?,
agentUserId?, durationSec?, closeConversation? }`. Percorre a URA do DID, cria `BvCall` + conversa (protocolo real) + gravação WAV
fictícia (tom de 1–3 s) e, se `agentUserId`, atribui a conversa; **não** registra `VOICE_MINUTES`. Resposta `201 { callId,
conversationId, protocol, outcome, trail, lang, recording { sha256, sizeBytes }, unusedInputs }` — a chamada aparece em `/calls`, toca em
`/calls/:id/recording` e alimenta os relatórios, o que permite demonstrar a PoC sem Asterisk.

## 4. Formato do fluxo da URA

`definition` (JSON, validado por zod *strict* — campo desconhecido é erro):

| Campo | Descrição |
|---|---|
| `start` | id do nó inicial |
| `dids[]` | DIDs/0800 atendidos (um DID só pode ser servido por **um** fluxo ativo; fluxo ativo sem `dids` é o padrão) |
| `defaultLang` | idioma inicial (padrão: `settings.language`) |
| `entryByHeader` | `{ header, map: { "<valor>": "<nó>" } }` — início alternativo conforme cabeçalho SIP (ex.: `X-URA-Option`) |
| `nodes` | `{ "<id>": nó }` (≤ 500; id `[A-Za-z0-9_.-]{1,64}`) |

Nós (`type`): `menu` (opções 0-9 * #, `bargeIn` = cut-thru padrão `true`, `forcePlay`, `repeatKey` padrão `*`, `maxRetries` 2, `timeoutSec` 5,
`timeoutNode`/`invalidNode`, `timeoutPrompt`/`invalidPrompt`), `play` (`next`, `bargeIn`, `forcePlay`), `collect` (`var`, `minDigits`,
`maxDigits`, `terminator` padrão `#`, `validate` none\|cpf\|cnpj, `sensitive`, **`echo`**, `confirm`), `schedule` (`open`/`closed`/`holiday`,
`hours?`; usa horário comercial e feriados do órgão), `language` (dígito → idioma, `next`), `queue` (`category`, `queue`, `priority` 0–10,
`mohClass`), `transfer` (`destination { type: external|extension|ura0800, number }`), `hangup`. Prompt = `{ text?, audioKey?, lang?, i18n?: { "<idioma>": { text?, audioKey? } } }`
(`audioKey` tem prioridade sobre `text`; `text` vira TTS com cache). **Validação** (publicar exige zero erros): nó inexistente, início
ausente, sem nó `queue`, `queue` inalcançável, ciclo sem saída; avisos: nó inalcançável, `forcePlay` + `bargeIn`.
`collect` com `validate: cpf|cnpj` (ou `sensitive`) **nunca** grava o valor na trilha, nos logs nem na conversa — só o tamanho.
Valores não sensíveis ficam em `metadata.ivr.vars` (ex.: número do processo).

Exemplo completo (URA 0800 do Balcão):

```json
{
  "start": "idioma",
  "dids": ["08006320000"],
  "defaultLang": "pt-BR",
  "entryByHeader": { "header": "X-URA-Option", "map": { "1": "processo", "2": "horario" } },
  "nodes": {
    "idioma": {
      "type": "language",
      "prompt": { "text": "Para português, digite 1. For English, press 2.", "lang": "pt-BR" },
      "languages": { "1": "pt-BR", "2": "en" }, "next": "aviso", "maxRetries": 1
    },
    "aviso": {
      "type": "play", "forcePlay": true, "next": "menu",
      "prompt": { "text": "Atendimento do Tribunal de Justiça. Seus dados serão tratados conforme a LGPD.",
                  "i18n": { "en": { "text": "Court service. Your data is handled under the LGPD." } } }
    },
    "menu": {
      "type": "menu", "bargeIn": true, "maxRetries": 2, "timeoutSec": 5,
      "prompt": { "text": "Para consultar um processo, digite 1. Horário de atendimento, 2. Falar com um atendente, 0.",
                  "i18n": { "en": { "text": "For a case, press 1. Opening hours, 2. For an agent, 0." } } },
      "options": { "1": "processo", "2": "horario", "0": "expediente" },
      "invalidNode": "expediente"
    },
    "processo": {
      "type": "collect", "var": "processo", "minDigits": 7, "maxDigits": 20, "terminator": "#", "echo": true, "confirm": true,
      "prompt": { "text": "Digite o número do processo seguido da tecla jogo da velha." }, "next": "expediente", "timeoutNode": "expediente"
    },
    "horario": {
      "type": "play", "next": "bye",
      "prompt": { "text": "Funcionamos de segunda a sexta, das oito às dezoito horas." }
    },
    "expediente": { "type": "schedule", "open": "fila", "closed": "fechado", "holiday": "fechado" },
    "fechado": { "type": "hangup", "prompt": { "text": "Nosso atendimento está fechado. Ligue em dia útil, das oito às dezoito horas." } },
    "fila": { "type": "queue", "category": "PROCESSO", "queue": "atendimento", "priority": 2, "mohClass": "default",
              "prompt": { "text": "Aguarde, você será atendido." } },
    "bye": { "type": "hangup", "prompt": { "text": "Obrigado por ligar." } }
  }
}
```

Para transbordar direto para a telefonia do TJTO a partir da URA: `{ "type": "transfer", "destination": { "type": "ura0800", "number": "08006000000" } }`.

## 5. Eventos

**Socket.IO** (namespace `/bv`, autenticado por JWT; enviados ao atendente da chamada e aos supervisores — filtre por `agentUserId`).
Payload base: `{ callId, conversationId, direction ('IN'|'OUT'), from, to, state }` mais:

| Evento | Quando | Extras |
|---|---|---|
| `call:ringing` | o ramal do atendente começou a tocar (entrada: após a atribuição; saída: click-to-call) | `agentUserId` |
| `call:queued` | entrou na fila (ou voltou: `requeued:true, reason`) | `category` |
| `call:active` | ponte estabelecida; ou transbordo concluído (`transferred:true, to`) | `agentUserId` |
| `call:transfer_failed` | destino do transbordo não atendeu (a chamada continua) | `cause` |
| `call:ended` | fim da chamada | `status`, `durationSec`, `reason`, `prevState` |

Barramento interno (`core/events`): emite `call.started` e `call.ended` (`{ orgId, callId, conversationId }`); consome
`conversation.assigned` (toca o ramal) e `conversation.closed` canal `VOICE` (derruba a ligação). Eventos de conversa
(`conversation:*`) seguem do núcleo. Jobs: `voice.stale-calls` (5 min).

## 6. Variáveis de ambiente

**API** (`/opt/zapscript/.env`):

| Variável | Padrão | Uso |
|---|---|---|
| `BV_VOICE_ENABLED` | — | `1` liga o controlador ARI. Sem ele as rotas existem mas a telefonia fica desligada (503) |
| `BV_ARI_URL` | — | ex.: `http://asterisk:8088`. Sem ela, usa `ari` da 1ª integração `SIP_TRUNK` habilitada |
| `BV_ARI_USER` / `BV_ARI_PASS` | `balcao` / — | credenciais do ARI (mesmas do Asterisk) |
| `BV_ARI_APP` | `balcao` | aplicação Stasis. **O `extensions.conf` tem `Stasis(balcao,…)` fixo**: se mudar, edite o dialplan |
| `BV_ASTERISK_RECORDING_DIR` | `/var/spool/asterisk/recording` | onde a API lê as gravações (volume compartilhado); sem o arquivo, baixa pelo ARI |
| `BV_ASTERISK_RECORDING_KEEP` | — | `1` não apaga o WAV original do Asterisk |
| `BV_ASTERISK_SOUNDS_DIR` | `/var/lib/asterisk/sounds/balcao` | onde a API escreve prompts/TTS para o Asterisk tocar (volume compartilhado, obrigatório) |
| `BV_STORAGE_DIR` | `/var/lib/zapscript/bv-storage` | storage das gravações (volume persistente + backup) |
| `BV_AGENT_RING_SEC` | `20` | tempo tocando no atendente antes de devolver à fila |
| `BV_VOICE_MAX_QUEUE_SEC` | `1200` | espera máxima na fila (mín. 10) |
| `BV_VOICE_ORG_ID` | — | órgão padrão para DID sem fluxo/`dids` (instalação de um órgão só) |
| `BV_SIP_SECRET` | — | segredo que deriva a senha SIP dos ramais (**igual ao do Asterisk**); sem ele `/softphone` = 503 |
| `BV_SIP_DOMAIN` | `BV_SIP_WSS_HOST` ou `balcao.local` | domínio no `sip:ramal@domínio` |
| `BV_SIP_WSS_HOST` | `BV_SIP_DOMAIN` | host do WSS (`wss://<host>:8089/ws`) |
| `BV_SIP_WSS_URL` | derivada | URL completa do WSS (se atrás de proxy/porta diferente) |
| `BV_ICE_SERVERS` | STUN público do Google | JSON `[{"urls":"turn:…","username":"…","credential":"…"}]` — em rede restrita do órgão use STUN/TURN próprios |
| `BV_AGENT_EXT_START` / `BV_AGENT_EXT_END` | `1001` / `1050` | faixa de ramais (a API só as exibe em `GET /config`; quem gera os endpoints é o Asterisk) |
| `BV_TTS_ENABLED` | — | `1` liga o TTS dos prompts de texto (OpenAI, PCM 24 kHz → `.sln24`) |
| `BV_TTS_API_KEY` | `OPENAI_API_KEY` | chave do TTS |
| `BV_TTS_VOICE` / `BV_TTS_MODEL` | `alloy` / `tts-1` | voz e modelo |
| `BV_DEV_SIMULATORS` | — | `1` libera `POST /dev/simulate-call` (**nunca em produção**) |

**Asterisk** (`infra/asterisk/asterisk.env`): `BV_ARI_USER`, `BV_ARI_PASS` (obrig.), `BV_SIP_SECRET` (obrig.), `BV_EXTERNAL_IP` (obrig.),
`BV_AGENT_EXT_START|END`, `BV_AGENT_CODECS`, `BV_AGENT_TRANSPORT`, `BV_TEST_CALLER_EXT`, `BV_RTP_START|END`, `BV_STUN_SERVER`,
`BV_WSS_CERT|KEY`, `BV_WSS_SELF_SIGNED`, `BV_HTTP_BIND`, `BV_HTTP_TLS_BIND`, `BV_LOCAL_NET`, `BV_ARI_CHANNELVARS`, `BV_LANGUAGE`,
`BV_TRUNK_HOST|PORT|TRANSPORT|AUTH|USER|PASS|IPS|CODECS|FROM_USER|FROM_DOMAIN|TLS_CERT|TLS_KEY` — comentadas em `asterisk.env.example` e
no README da pasta.

## 7. Runbook de teste com softphone

**A. Sem Asterisk (qualquer máquina de desenvolvimento)** — valida URA, protocolo, busca e reprodução:

1. `BV_DEV_SIMULATORS=1` na API; entre como ADMIN/SUPERVISOR.
2. `POST /ivr/flows` com o exemplo da §4 → `POST /ivr/flows/:id/simulate` com `{"inputs":["1","~5","~1","1234567#","1"],"at":"2026-03-10T15:00:00Z"}` (terça, horário comercial) até a trilha chegar em `queue` (`~5` é digitado durante o aviso *force-play* e descartado; `~1` interrompe o menu — cut-thru).
3. `POST /ivr/flows/:id/publish` e `POST /dev/simulate-call` (sem `at`: usa a hora atual — fora do expediente o exemplo cai em `fechado`) `{ "from":"63999990000", "did":"08006320000", "inputs":["1","~5","~1","1234567#","1"], "agentUserId":"<id>" }`.
4. `GET /calls?protocol=<BV-…>` encontra a chamada; `GET /calls/:id/recording` com `Range: bytes=0-43` devolve 206; `/recording/meta?verify=true` → `integrityOk:true`;
   `/recording/coverage` mostra 100 %; a trilha de auditoria registra `recording.listen`.

**B. Com Asterisk, sem tronco (PoC de bancada)** — valida softphone, DTMF, gravação e fila:

1. Suba o Asterisk (`infra/asterisk/README.md` §2–4) com `BV_TRUNK_HOST` vazio, `BV_TEST_CALLER_EXT=9001`, `BV_WSS_SELF_SIGNED=1` (ou cert real) e a API com `BV_VOICE_ENABLED=1`, `BV_ARI_*`, `BV_SIP_SECRET`, `BV_SIP_DOMAIN=<host>`.
2. Crie dois usuários (atendente e supervisor), defina `sipExtension` do atendente (`PATCH /balcao/admin/users/:id` `{ "sipExtension":"1001" }`) e ponha-o `ONLINE`.
3. Publique um fluxo cujo `dids` contenha o número que o softphone de teste vai discar (ex.: `08006320000`).
4. `GET /status` → `connected:true`. Abra o console do atendente: o Softphone registra o ramal 1001 (WSS 8089 — com certificado autoassinado, abra antes `https://<host>:8089` e aceite).
5. Registre um softphone comum (Linphone/Zoiper) como `9001`, senha = a derivada do ramal (`BV_SIP_SECRET=… BV_TEST_CALLER_EXT=9001 node infra/asterisk/gen-agents.js | grep -A4 '^\[9001\]'`, linha `password=`), servidor `<host>:5060` UDP, DTMF RFC 4733. Disque `08006320000`.
6. Confira: aviso de gravação → protocolo falado → menu; digite `1` durante o prompt (cut-thru: o áudio corta); informe o processo e confirme (echo); caia na fila (música); a conversa aparece `WAITING`, o routing atribui, o ramal 1001 toca (`call:ringing`), o atendente atende (`call:active`), converse, **transfira** para um número de teste, desligue (`call:ended`).
7. `GET /calls/:id` (duração, `ivrPath`, `voice.headers`), `/recording` (ouça as duas vozes), `/recording/meta?verify=true`, `/recording/coverage`, `GET /reports` de consumo (`VOICE_MINUTES`, `VOICE_PEAK_CHANNELS`: faça duas ligações simultâneas).
8. Falhas a provocar: não atender (volta à fila após `BV_AGENT_RING_SEC`, atendente `AWAY`), desligar na URA/fila (`ABANDONED`, gravação existe), publicar uma nova versão **durante** uma chamada (a em curso termina na versão antiga; a próxima usa a nova), reiniciar a API (reconexão do ARI + `reconcile`).

**C. PoC com o tronco do TJTO** — `infra/asterisk/README.md` §6; `POST /config/test` → `trunk.state:"online"`; ligue para o 0800/DID real; envie uma chamada com
`X-URA-Option` e confira `GET /calls/:id → voice.headers`; transbordo para um ramal do TJTO e click-to-call a um número externo.

## 8. Limites conhecidos e decisões

- **Gravação**: fica em arquivos WAV no `BV_STORAGE_DIR` com sha256 (integridade verificável); a criptografia em repouso depende do
  **volume/disco criptografado** (não há cifragem por arquivo — o Range exigiria cifra em blocos). Retenção/expurgo: frente `security`.
- **Fase da URA**: gravada pelo canal do cidadão; a gravação "principal" é a da ponte (cidadão + atendente). Se a chamada não chega a
  atendente, a gravação da URA vira a gravação da chamada (`part=main`); quando existem as duas, a da URA fica em `part=ura`.
- **Discagem pelo tronco**: qualquer usuário com `conversation:reply` pode usar `POST /calls/dial`/transbordo para qualquer número
  `^\+?[0-9*#]{2,20}$`. Restrinja destinos no SBC/tronco do TJTO (plano de discagem de saída) — não há lista de permissão no MVP.
- **DID**: casamento exato com o número que o tronco entrega no INVITE (confirme com o TJTO se vem com `+55`/DDD).
- **Chamada anônima** (`anonymous`/`unknown`): contato `anonimo:<callId>`, número gravado como `anonimo`.
- **ARI único** (ver §1). Credenciais do ARI vindas de integração valem para a primeira integração habilitada — em instalação multi-órgão use `BV_ARI_*`.
- O processo da API perde as sessões em memória num restart; as chamadas já conectadas no Asterisk ficam sem controle até o `reconcile`,
  que as encerra no banco (`LOST_CONTROL`) — o Asterisk derruba o canal quando a aplicação Stasis some.

## Não verificado

Tudo abaixo depende de sistema externo real e **nunca foi executado** neste repositório (os testes usam um ARI simulado em Node:
`__tests__/fakeAri.ts`, que implementa só a parte do ARI que o controlador usa — se a API real divergir, é aqui que quebra):

1. **Asterisk real**: build do `Dockerfile`, subida do compose, validade dos `.conf` gerados pelo Asterisk 20 (apenas o texto gerado foi inspecionado
   e testado), nomes/opções do PJSIP e do `http.conf`, `channelvars` do ARI expondo `BV_X_*`, eventos `StasisStart/ChannelDtmfReceived/PlaybackFinished/RecordingFinished`
   com os campos assumidos, `POST /channels/{id}/play` com `media` composta (`digits:`/`characters:`), `POST /bridges/{id}/record`, `GET /recordings/stored/{name}/file`.
2. **Gravação da fase da URA**: a gravação por **canal** (`/channels/{id}/record`) pode registrar apenas o áudio vindo do cidadão (sem os prompts tocados pelo
   Asterisk). A gravação da **ponte** (cidadão + atendente) é a principal. Validar na PoC; se necessário, trocar a gravação da URA por canal *snoop*
   (`spy=both`) ou por ponte com reprodução na ponte.
3. **Tronco SIP real com a VoIP do TJTO**: autenticação, `identify`, codecs, DTMF RFC 4733 ponta a ponta, formato do DID, cabeçalhos `X-*` reais da URA 0800,
   transbordo e discagem pelo tronco, `qualify` (`config/test`), SIP TLS.
4. **TTS real**: OpenAI `pcm` 24 kHz gravado como `.sln24` e lido pelo Asterisk; latência da primeira síntese (o `publish` pré-aquece os prompts, mas a 1ª chamada
   pode tocar silêncio se o TTS demorar); qualidade em português; custo. Sem `BV_TTS_ENABLED` prompts só-texto tocam silêncio — use áudios enviados (`/ivr/prompts`).
   O protocolo é falado com `digits:`/`characters:` (sons do Asterisk, em inglês se não houver o pacote pt_BR).
5. **WebRTC em navegador**: registro SIP.js no WSS 8089, DTLS-SRTP/ICE, TURN em rede restrita, auto-resposta do click-to-call, permissão de microfone,
   troca de certificado (reload do TLS do `http.conf` sem reiniciar). O `Softphone.tsx` não foi exercitado contra um Asterisk.
6. **Capacidade**: nº real de canais simultâneos (RTP/CPU/gravação em disco) e dimensionamento da faixa RTP; contagem de `VOICE_PEAK_CHANNELS` sob carga real.
7. **Reprodução de gravação em `<audio>` de navegador** (Range/seek) e desempenho com milhares de gravações (a busca usa índices de data; `protocol`/`number` são `contains`).
