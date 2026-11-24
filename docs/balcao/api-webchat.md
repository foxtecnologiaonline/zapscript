# Balcão Virtual — Webchat (widget embarcável + API pública do visitante)

Frente `webchat` — código em `apps/api/src/balcao/channels/webchat`, prefixo HTTP `/balcao/webchat`.
Entrega o **chat/popup no site** do órgão: um script JS puro que o cidadão carrega no site do tribunal, uma API
pública (`/public/*`) usada por esse script e um namespace Socket.IO próprio do visitante (`/bv-visitor`).
Tudo entra no núcleo por `ingestInbound` (canal `WEBCHAT`, `channelRef` = id da sessão do visitante) e sai por
`sendMessage` (`registerChannelSender('WEBCHAT')`). Atende TR 1.1.3.1.7.1 (acessibilidade: eMAG/WCAG, VLibras,
videochamada) e os itens de chat do edital. Erros: `{ "error": { "code", "message", "details?" } }`.

## 1. Instalação no site

```html
<script src="https://api.zapscript.me/balcao/webchat/widget.js"
        data-org="slug-do-orgao" async></script>
```

1. O `slug` é o do órgão (`BvOrg.slug`).
2. Em `settings.webchat.allowedOrigins` do órgão (admin do Balcão), cadastre as origens que podem embutir o chat,
   p.ex. `["https://www.tjto.jus.br", "https://*.tjto.jus.br"]`. O curinga `*.` casa subdomínios (não o domínio raiz).
3. Se o site hospedeiro usa CSP: `script-src` e `connect-src` precisam da origem da API (HTTP **e** `wss://`); o
   widget só carrega código de terceiros do VLibras (`https://vlibras.gov.br`) e apenas com `data-vlibras="true"`.
   O botão de vídeo não incorpora o Jitsi: o link da sala aparece na conversa e abre em nova aba (nenhuma regra `frame-src` é necessária).
4. O proxy da API deve repassar `Upgrade` em `/socket.io/` (já é o caso em `infra/nginx-zapscript.conf`). Sem WebSocket o
   widget cai sozinho para polling HTTP a cada 3,5 s.

### Atributos do `<script>`

| Atributo | Padrão | Efeito |
|---|---|---|
| `data-org` | **obrigatório** | slug do órgão |
| `data-lang` | `settings.language` do órgão (`pt-BR`) | idioma da interface (`pt-BR`, `en`; faltas em `en` caem para `pt-BR`) |
| `data-position` | `settings.webchat.position` ou `right` | `left` / `right` |
| `data-color` | `settings.webchat.primaryColor` | cor da marca `#rrggbb`; a cor do texto (branco/preto) é calculada para contraste ≥ 4,5:1 |
| `data-vlibras` | desligado | `true` carrega o plugin VLibras (Libras) |

API JS para o site hospedeiro: `window.BalcaoVirtual.open()`, `.close()`, `.version`.

### Recursos do widget

- **Isolamento**: Shadow DOM (CSS do site não vaza para o chat e vice-versa); sem dependências; ~33 KB na v1.1.0 (teste limita a 40 KB).
- **Acessibilidade**: painel `role="dialog"` `aria-modal` com rótulo; **foco preso** (Tab/Shift+Tab) e retorno do foco ao botão ao fechar;
  **Esc** fecha; região de mensagens `role="log"` `aria-live="polite"` (focável por teclado); status `role="status"` e erros `role="alert"`;
  todos os campos com `<label>`; alvos de toque ≥ 44 px; foco visível; escala de NPS em `fieldset/legend` + radios (teclado/leitor de tela);
  **tamanho da fonte** A−/A+ (5 níveis) e **alto contraste** (também ativado por `prefers-contrast: more`), ambos lembrados em `localStorage`
  (`bv.wc.prefs`); **`prefers-reduced-motion`** desliga animações; layout em tela cheia no celular; links `rel="noopener noreferrer"`;
  texto sempre inserido como texto (nunca HTML do servidor).
- **Avisos**: LGPD e uso de IA (recolhíveis; também exibidos antes de iniciar a conversa). Nome/e-mail opcionais (e-mail casa o contato com outros canais).
- **Retomada**: o token do visitante fica em `sessionStorage` (`bv.wc.token.<org>`); ao recarregar a página o histórico volta por `GET /public/history`.
- **Fora do horário** (`open=false` em `/public/config`): aviso `offlineMessage` e os botões passam a "Deixar mensagem" — a mensagem é registrada e vai para a fila.
- **Falar com atendente humano**, **anexos** (imagem/PDF, pré-visualização de imagens), **atendimento por vídeo** (Jitsi), **encerrar** (com confirmação)
  e **NPS 0–10** (+ comentário opcional) ao final.
- **Legendas** (v1.1.0): botão **"Legendas"** (`aria-pressed`) no grupo de ações. Ligado, exibe as legendas do atendente (evento `caption`) numa região
  `role="log"` `aria-live="polite"` (só frases **finais** são anunciadas; trechos parciais aparecem numa linha fora da região viva) e, se o navegador tiver
  `window.SpeechRecognition || window.webkitSpeechRecognition`, captura a fala do visitante (`lang = pt-BR`, contínua, com parciais) e a envia por `POST /public/caption`
  (parciais a cada ≥ 400 ms; frases finais sempre). **A captura depende de Chrome/Edge e de permissão de microfone**; o reconhecimento é feito pelo navegador, que pode enviar o
  áudio ao fornecedor dele (o widget avisa). Sem suporte ou com microfone negado o widget **degrada**: mostra o aviso e continua exibindo as legendas do atendente.
  Desliga sozinho ao encerrar/expirar a conversa. **Relé efêmero: nenhum texto de legenda é gravado** (ver §4.1).
- **Tempo real**: Socket.IO mínimo embutido (Engine.IO v4 sobre WebSocket) com reconexão exponencial e fallback para polling.

## 2. API pública (`/balcao/webchat/public/*`)

CORS refletido para este prefixo (`origin: true`, sem credenciais, cabeçalhos `Content-Type`, `Authorization`, `X-Visitor-Token`); a restrição
real é a **lista de origens do órgão** (§3). Rotas com token exigem `X-Visitor-Token: bvv_…`.

| Método e rota | Auth | Corpo / query → resposta |
|---|---|---|
| `GET /public/config?org=<slug>` | Origin | → `{org,title,color,position,lang,welcome,privacyNotice,aiNotice,offlineMessage,open,features{human,video,attachments,csat},attachments{maxBytes,types},maxMessageChars,version}`. Só dados de apresentação (sem ids, filas ou e-mails). `open` considera horário comercial/feriados |
| `POST /public/session` | Origin | `{org, name?, email?}` → **201** `{token, conversationId:null, expiresInSec}`. O token só é devolvido aqui |
| `POST /public/identify` | token | `{email, name?}` → `{ok}`; une o contato anônimo (conversa em curso) ao identificado por e-mail |
| `POST /public/messages` | token | `{text, clientMsgId?}` → **201** `{message, state, duplicate, csat}`. `clientMsgId` (8–64 `[A-Za-z0-9_-]`) torna o reenvio idempotente. Cria/reabre a conversa (bot ou fila, conforme `settings.ai.enabled`) |
| `GET /public/messages?since=<ISO>&limit=` | token | **Polling**: só mensagens **destinadas ao visitante** (bot/atendente/sistema). `since` é inclusivo (o cliente deduplica por `id`); sem `since` devolve as últimas `limit` (≤ 100). → `{messages[], state, serverTime}` |
| `GET /public/history` | token | últimas 100 mensagens (visitante + atendimento), para retomada |
| `POST /public/attachments` | token | `multipart/form-data` (`file`, `text?` legenda) → **201** `{message, state}` · **422 `attachment.rejected`** (ClamAV opcional: `putObject(…, {scan:true})`). PNG/JPEG/WEBP/GIF/PDF, limite `BV_WEBCHAT_MAX_ATTACHMENT_MB` (5); o tipo é validado pelos **bytes iniciais** (não pelo Content-Type) |
| `GET /public/attachments/:messageId/:index` | token | baixa anexo da conversa **da própria sessão** (imagem inline; demais como download; `CSP: sandbox`, `nosniff`, `no-store`) |
| `POST /public/caption` | token | `{ text (1–1000, truncado a 500 após limpeza), final?: boolean=false }` → **204**. Relé da legenda do visitante à equipe (§4.1). 400 `validation.failed`/`webchat.empty_message` · 409 `webchat.no_conversation` (sem conversa iniciada) / `webchat.conversation_closed` · 429 `webchat.rate_limited` (`BV_WEBCHAT_RL_CAPTION`) |
| `POST /public/typing` | token | 204. Avisa o atendente que o visitante está digitando (o socket faz o mesmo) |
| `POST /public/human` | token | cria a conversa se preciso e **escala para a fila humana** → `{state}` |
| `POST /public/video` | token | escala para a fila e cria a sala Jitsi → **201** `{url, room, state}`; o link também vai como mensagem de sistema (visível ao atendente) |
| `POST /public/csat` | token | `{score 0–10, comment?}` só após o encerramento; uma única vez → `{ok}` (grava via `recordCsat`; entra no NPS) |
| `POST /public/end` | token | `{resolved=true, leave=false}` encerra a conversa (`RESOLVED`/`ABANDONED`, pede NPS); `leave=true` também encerra a **sessão** e derruba os sockets |

`state` = `{conversationId, protocol, status: none|bot|waiting|active|closed, csat:{requested, done, prompt}}`.
Mensagem pública = `{id, from: visitor|bot|agent|system, kind, text, attachments[{name,mime,size,path}], at}` — **sem** id de atendente, metadados de IA ou do canal.

**Notas internas nunca vazam**: mensagens `INTERNAL`/`NOTE`/`EVENT` são excluídas por `toVisitorView` e pelo filtro das consultas (polling, histórico, anexos e socket).

### Códigos de erro

`webchat.org_not_found` 404 · `webchat.origin_not_allowed` 403 · `webchat.session_invalid` 401 (mesma resposta para token ausente, malformado, desconhecido, encerrado ou expirado — sem enumeração) ·
`webchat.rate_limited` 429 (+ `Retry-After`) · `webchat.empty_message` 400 · `webchat.message_too_long` 413 · `webchat.quota_exceeded` 429 (cota `BLOCK` de `WEBCHAT_MSG`) ·
**`attachment.rejected` 422** (antivírus recusou o arquivo; `error.details.reason` = `infected` \| `scan_unavailable`; nada é gravado nem vira mensagem) ·
`webchat.attachment_too_large` 413 · `webchat.attachment_type` 415 · `webchat.attachment_missing`/`attachment_empty` 400 · `webchat.attachments_disabled` / `human_disabled` / `video_disabled` 403 ·
`webchat.conversation_closed` 409 · `webchat.csat_not_available` / `csat_already` 409 · `webchat.not_found` 404 · `webchat.internal` 500 · `validation.failed` 400.

## 3. Segurança

- **Origin**: validada contra `settings.webchat.allowedOrigins` em `config`, `session`, em **toda** rota com token (token roubado não funciona em outro site) e no handshake do Socket.IO.
  Lista preenchida → sempre exige (POST sem `Origin` é negado; GET sem `Origin` passa); lista **vazia** → liberado em desenvolvimento e **negado em produção**
  (`NODE_ENV=production` ou `BV_WEBCHAT_ENFORCE_ORIGIN=1`); `"*"` libera explicitamente; `Origin: null` é negado. A própria origem da API é aceita (página `/demo`).
  Alterações em `settings` valem em até ~30 s (cache de configurações).
- **Token do visitante**: `bvv_` + 32 bytes aleatórios; no banco só o **hash** (`BvWebchatSession.tokenHash`). Expira por inatividade (`BV_WEBCHAT_SESSION_TTL_SEC`, 12 h; renovado a cada ≥ 15 s de atividade). A sessão guarda IP/User-Agent/Origin truncados; o job `webchat.purge-sessions` (6 h) apaga sessões inativas há > 30 dias.
- **Rate limit** (Redis, janela de 1 min; se o Redis falhar usa contador local — nunca fica sem limite):

| Variável | Padrão | Escopo |
|---|---|---|
| `BV_WEBCHAT_RL_IP` | 300 | por IP, todas as rotas públicas |
| `BV_WEBCHAT_RL_SESSIONS` | 10 | sessões novas por IP |
| `BV_WEBCHAT_RL_MSG` | 20 | mensagens por sessão |
| `BV_WEBCHAT_RL_ATTACH` | 6 | anexos por sessão |
| `BV_WEBCHAT_RL_POLL` | 120 | leituras (polling/histórico/download) por sessão |
| `BV_WEBCHAT_RL_TYPING` | 60 | "digitando" |
| `BV_WEBCHAT_RL_CAPTION` | 240 | trechos de legenda por minuto, por sessão (visitante) e por atendente |
| `BV_WEBCHAT_RL_ACTION` | 30 | human/csat/end/video/identify |

- Entrada em texto puro: remove controles C0/C1, BOM e caracteres bidi de sobreposição; nomes de arquivo saneados. Uma conversa por sessão (exclusão mútua local evita duas conversas para mensagens simultâneas).
- `GET /widget.js`: `Cross-Origin-Resource-Policy: cross-site`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=300, stale-while-revalidate=86400` e `ETag` (304).
- Anexos do visitante: chave de storage sempre sob `<orgId>/`; download só da própria conversa/órgão.

## 4. Socket.IO — namespace `/bv-visitor`

Conexão: `io(API_ORIGIN + '/bv-visitor', { auth: { token: '<bvv_…>' } })` (o widget usa o protocolo direto via `wss://…/socket.io/?EIO=4&transport=websocket`).
Handshake recusado com `unauthorized` (token inválido/expirado) ou `origin_not_allowed`. O visitante entra **só** na sala da própria conversa (`bvv:conv:<id>`);
sessões que expiram com o socket aberto são desconectadas pela varredura (5 min) e `POST /public/end {leave:true}` desconecta na hora.

| Evento | Direção | Payload |
|---|---|---|
| `message:new` | servidor → visitante | `{message}` (mensagem pública; nunca notas) |
| `typing` | servidor → visitante | `{from:'agent'}` |
| `csat:request` | servidor → visitante | `{conversationId, prompt}` (após encerramento `RESOLVED` com NPS habilitado) |
| `conversation:closed` | servidor → visitante | `{conversationId}` |
| `caption` | servidor → visitante | `{conversationId, from:'AGENT', text, final}` (legenda do atendente; relé efêmero, §4.1) |
| `typing` | visitante → servidor | (sem payload; repassado à equipe como `typing {conversationId, from:'CONTACT'}` no namespace `/bv`) |

### 4.1 Legendas em tempo real (videochamada / chat de vídeo)

Relé **efêmero** entre as duas pontas; o texto passa só pela memória do processo e **não é gravado** (nem em `BvMessage`, eventos, auditoria, uso ou log). Quem não estiver conectado
por Socket.IO no instante simplesmente não recebe aquele trecho (não há reenvio nem polling). Payload do evento `caption` (igual nos dois sentidos):
`{ conversationId, from: 'VISITOR' | 'AGENT', text, final }` — `final:false` = parcial (substitui o parcial anterior do mesmo falante); `final:true` = frase concluída. Não há eco ao emissor.

| Sentido | Como enviar | Como receber |
|---|---|---|
| visitante → atendente | `POST /balcao/webchat/public/caption` `{text, final}` (token do visitante) | evento `caption` `{from:'VISITOR'}` no namespace **`/bv`**, sala da conversa — o atendente precisa ter feito `emit('conv:join', conversationId)` (como já faz para `message:new`) |
| atendente → visitante | `POST /balcao/webchat/conversations/:id/caption` `{text, final}` (JWT do Balcão) | evento `caption` `{from:'AGENT'}` no namespace **`/bv-visitor`** (todos os sockets da sessão na conversa) |

`POST /balcao/webchat/conversations/:id/caption` — permissão `conversation:reply`; só o **atendente atribuído** ou a **supervisão** (`conversation:monitor`). Corpo igual ao do visitante.
Resposta **200 `{ delivered: boolean }`** (`delivered:false` = nenhum socket de visitante conectado na conversa). Erros: 401 · 403 `auth.forbidden` (sem `conversation:reply`) / `conversation.forbidden`
(não atribuído e sem supervisão) · 404 `conversation.not_found` (inclusive de outro órgão) · 409 `webchat.not_webchat` (conversa de outro canal) / `conversation.closed` · 400 · 429 `webchat.rate_limited`.
O texto é limpo (controles/bidi removidos, espaços normalizados) e limitado a 500 caracteres.

O núcleo só emite no namespace `/bv` (equipe); a entrega ao visitante é feita por `delivery.ts` (`message.outbound`, `conversation.closed`) e pelo repasse do `typing` do atendente.
O remetente do canal apenas confirma `SENT` (`channelMeta.delivery = socket|poll`); a mensagem fica disponível no polling mesmo sem socket.

## 5. Atendimento por vídeo (Jitsi)

`POST /public/video` gera `<BV_JITSI_BASE_URL>/bv-<protocolo>-<10 caracteres aleatórios>` e registra mensagem `SYSTEM` com o link (`channelMeta.videoRoom`),
visível ao atendente na conversa. A legenda ao vivo e o VLibras dependem do navegador/serviço (ver D10 em `ARQUITETURA.md`).

## 6. Página de demonstração

`GET /balcao/webchat/demo?org=<slug>[&vlibras=1][&position=left]` — HTML semântico (skip link, `lang`, modo escuro) que embute o widget; o slug é validado/escapado
e não há script inline (CSP próprio da rota: `script-src 'self' https://vlibras.gov.br`). Desligue com `BV_WEBCHAT_DEMO=off` (404).

## 7. Configuração

`settings.webchat` do órgão (todos opcionais além dos padrões do núcleo): `allowedOrigins[]`, `title`, `primaryColor` (`#rrggbb`), `offlineMessage`, `welcomeMessage`,
`privacyNotice`, `aiNotice`, `videoEnabled` (padrão true), `humanButtonEnabled` (true), `attachmentsEnabled` (true), `position` (`left`|`right`). Também usados: `settings.csat`, `settings.ai`, `businessHours`/feriados, `language`.

| Variável | Padrão | Uso |
|---|---|---|
| `BV_JITSI_BASE_URL` | `https://meet.jit.si` | base das salas de vídeo (URL `http(s)` inválida volta ao padrão) |
| `BV_WEBCHAT_SESSION_TTL_SEC` | 43200 | inatividade até expirar a sessão (mín. 60) |
| `BV_WEBCHAT_MAX_MESSAGE_CHARS` | 2000 | tamanho máximo de mensagem (10–20000) |
| `BV_WEBCHAT_MAX_ATTACHMENT_MB` | 5 | limite de anexo (1–15) |
| `BV_WEBCHAT_ENFORCE_ORIGIN` | — | `1` força validação de Origin fora de produção |
| `BV_WEBCHAT_DEMO` | ligado | `off` desativa `/demo` |
| `BV_WEBCHAT_RL_*` | ver §3 | limites de taxa |

Consumo: cada mensagem/anexo do visitante e cada resposta enviada conta `WEBCHAT_MSG` (cota `BLOCK` → 429 `webchat.quota_exceeded`). Job: `webchat.purge-sessions`.

## 8. Testes

`npx jest --runInBand src/balcao/channels/webchat` — 52 casos (inclui `captions.test.ts`: relé por HTTP + Socket.IO nos dois sentidos, permissões, rate limit, "nada é gravado" e conteúdo estático do widget; `antivirus.test.ts`: clamd falso) com app Fastify mínimo + Socket.IO local (sem rede externa): servir/ETag/CORP do script, validade do JS e checagem
estática de acessibilidade, contraste AA da cor do texto sobre qualquer cor de marca, config pública, ciclo visitante↔atendente↔polling, notas internas que não vazam, idempotência,
identificação/merge, humano/vídeo/NPS/encerramento, anexos (bytes forjados, limite, isolamento), Origin (lista, curinga, produção), rate limit, expiração/TTL, fora do horário, token só como hash,
isolamento entre órgãos e eventos de socket (inclusive visitante de outro órgão).

## 9. Não verificado

- **O widget não foi executado em navegador real** (nem em jsdom): os testes validam o JS por sintaxe (`vm.Script`), por inspeção estática do código (ARIA, foco, Esc, contraste, movimento reduzido) e por chamadas à API/Socket.IO.
  Falta teste manual/automatizado com leitor de tela (NVDA/JAWS/VoiceOver), navegação só por teclado, zoom 200%/400%, dispositivos móveis e a bateria de auditoria eMAG/WCAG (axe/Lighthouse).
- Cliente Socket.IO embutido (Engine.IO v4 mínimo) testado contra o servidor local com a biblioteca `ws`, não em navegadores reais nem atrás de proxies/CDN que bloqueiem WebSocket (há fallback para polling).
- VLibras (script e disponibilidade de `vlibras.gov.br`) e Jitsi real (`meet.jit.si` ou instância do órgão): dependem de serviços externos; o botão só cria a sala e envia o link.
- **Legendas**: `SpeechRecognition` **nunca foi executado** (nenhum navegador/DOM nos testes — só o relé servidor e a inspeção estática do widget). Qualidade do pt-BR, reinício automático após silêncio
  (`onend`), comportamento no Safari/Firefox (sem suporte), permissão de microfone, e o fato de o áudio ir ao fornecedor do navegador (LGPD: avaliar com o órgão) estão por validar. A fala do
  visitante dentro da sala **Jitsi** é outra mídia: o widget só capta o microfone do próprio navegador (pode competir com o microfone do Jitsi na mesma aba/dispositivo). O console do atendente precisa
  ligar o `POST …/caption` a um reconhecimento de fala próprio (não existe no front).
- **Antivírus**: testado com clamd falso; ClamAV real não verificado.
- Visão do **atendente** (console React) está fora desta frente; a mensagem de vídeo e o `typing` chegam pelo núcleo.
- O `index.ts` global aplica `@fastify/rate-limit` (150 req/min por IP) a **todas** as rotas, inclusive `/balcao/webchat/public/*`; visitantes atrás do mesmo NAT corporativo podem esbarrar nele antes do limite próprio (300/min por IP). Considere incluir `/balcao/webchat/public` no `skip` (arquivo fora desta frente).
- Anti-bot (CAPTCHA) não existe: a proteção contra abuso é rate limit + Origin + cota. Retenção do conteúdo segue a política do núcleo/segurança (`settings.retention`).
- Cenários de várias réplicas da API: rate limit usa Redis (ok), mas a exclusão mútua por sessão é local ao processo; duas mensagens simultâneas da mesma sessão em instâncias diferentes poderiam criar duas conversas (improvável; o `ingestInbound` procura conversa aberta por `channelRef`).
