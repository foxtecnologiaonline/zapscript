# ✅ Checklist — Verificação do App WhatsApp Cloud API (Meta App Review)

> Guia prático e otimizado para aprovar o **Embedded Signup** no App Review da Meta.
> App: `1288808192667379` · Business: `1880406532635590` · Domínio: `www.zapscript.me`
>
> **Legenda:** marque `[x]` ao concluir cada item.
> **Convenção de segredos:** todos os segredos são definidos por você **direto nos painéis** (Vultr/Vercel/Meta — ver `CLAUDE.md`) — nunca passam pelo assistente.

---

## 🔎 FASE -1 — Diagnóstico da submissão rejeitada (01/06/2026)

> Lida a partir do PDF `ZapScript_Meta_App_Review_Submitted_On_20260601.pdf`. Três problemas
> reais no conteúdo enviado, além do `manage_app_solution` já identificado (Fase 4):

- [ ] **`Data handling → processor-0` respondido "No"** — pergunta se existem processadores de
      dados de terceiros. A resposta certa é **"Yes"**: o app manda o áudio pro **OpenAI Whisper**
      (transcrição) e o texto pro **Anthropic Claude** (resumo), além de usar **Supabase** (DB +
      storage). Responder "No" quando isso não é verdade é o tipo de inconsistência que a Meta
      audita e pode reprovar sozinha, independente da qualidade do vídeo.
- [ ] **Justificativa de `whatsapp_business_management` fraca/genérica** — o texto enviado foi
      "Conexão do dispositivo com o whatsapp, para que o usuário possa ter acesso aos recursos
      necessários", que não descreve nenhum uso real do produto. Trocar pela justificativa em
      inglês da Fase 4 abaixo.
- [ ] **Credencial de teste fraca** (`senha: 123456`) — trocar por senha forte antes de reenviar;
      não é motivo de reprovação sozinho, mas é má prática numa revisão de segurança.

Correção sugerida (colar em inglês no campo de data handling):
```
Yes. We use the following data processors to provide our service: (1) OpenAI (Whisper API) —
receives the voice message audio to generate a text transcription; (2) Anthropic (Claude API) —
receives the transcribed text to generate a summary; (3) Supabase (hosted on AWS) — database and
temporary audio file storage. These processors only process data to perform the function
contracted by ZapScript and do not use it for their own purposes.
```

---

## 🔧 FASE 0 — Correções de código (assistente)

- [x] Atualizar o default do Graph API de `v18.0` (deprecado) para versão GA atual — feito em
      `apps/api/src/services/whatsapp-official.ts` e `apps/worker/src/services/whatsapp-official.ts`
      (agora usam `META_GRAPH_VERSION`, default `v23.0`, mesmo padrão de `meta-embedded.ts`)
- [ ] Verificar se a migração das colunas Meta (`provider`, `metaWabaId`, `metaPhoneNumberId`, `metaBusinessId`, `metaAccessTokenEnc`, `metaTokenExpiresAt`) está aplicada no Supabase
      > ⚠️ Não consegui confirmar agora — o projeto Supabase do ZapScript (`sqqmusijaovhtiufbzsa`)
      > está com status `INACTIVE` e a conexão deu timeout. Precisa ser reativado antes do
      > revisor conseguir testar qualquer fluxo (isso é independente do problema do Vultr).
- [ ] Typecheck (web + api) + commit + push (branch e master, com autorização) após as correções

---

## 🏢 FASE 1 — Pré-requisitos no painel Meta

- [ ] **Business Verification = Verified** (bloqueante; sem isso as permissões não saem de Standard Access). CNPJ + comprovante; leva 1–3 dias
- [ ] Produto **WhatsApp** adicionado ao app
- [ ] Pelo menos **um número de teste** no WABA
- [ ] Criar **Configuração de Embedded Signup** (WhatsApp → Embedded Signup → Create configuration)
- [ ] Copiar o **Configuration ID** gerado (vira `NEXT_PUBLIC_META_CONFIG_ID`)

---

## 🔑 FASE 2 — Variáveis de ambiente

### Vultr (`.env` do servidor — apps/api + apps/worker)
- [ ] `META_APP_ID` = ID do app (1288808192667379)
- [ ] `META_APP_SECRET` = App Secret
- [ ] `META_GRAPH_VERSION` = versão GA atual (ex.: `v21.0`+)
- [ ] `INTERNAL_API_SECRET` (já existe — só confirmar que está setada)

### Vercel (apps/web)
- [ ] `NEXT_PUBLIC_META_APP_ID` = mesmo App ID
- [ ] `NEXT_PUBLIC_META_CONFIG_ID` = Configuration ID (Fase 1)
- [ ] `NEXT_PUBLIC_META_GRAPH_VERSION` = mesma versão GA
- [ ] **Redeploy do Vercel** após setar as vars
- [ ] Confirmar que o botão azul **"Conectar com a Meta"** aparece em `/dashboard/numeros`
      > ⚠️ A seção só renderiza com `NEXT_PUBLIC_META_APP_ID` **e** `NEXT_PUBLIC_META_CONFIG_ID` setadas. Sem o botão, o revisor reprova.

---

## 🌐 FASE 3 — URLs e domínios (painel Meta)

### Facebook Login → Settings
- [ ] **App Domains:** `zapscript.me` e `www.zapscript.me`
- [ ] **Site URL:** `https://www.zapscript.me`
- [ ] **Valid OAuth Redirect URIs:** `https://www.zapscript.me/`
- [ ] **"Login with the JavaScript SDK"** habilitado para o domínio

### App Settings → Advanced → Security
- [ ] **Deauthorize Callback URL:** `https://www.zapscript.me/api/meta/deauthorize` (já implementado)
- [ ] **Data Deletion Request URL:** `/api/data-deletion-callback` (já configurado — manter)

---

## 🛂 FASE 4 — Permissões (Advanced Access)

- [ ] **REMOVER** `manage_app_solution` do pedido (causa de reprovação anterior — não pedir de novo)
- [ ] Solicitar só estas 3: `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`

### Texto pronto para colar — "Tell us how you're using this permission or feature"

**`[whatsapp_business_messaging]`**
```
ZapScript is a productivity SaaS. A business owner connects their own WhatsApp Business phone
number to our platform via the official Meta Embedded Signup flow. Once connected, when one of
their contacts sends a voice message to that WhatsApp Business number, our backend uses
whatsapp_business_messaging to download the audio and to reply in the same conversation with an
automatically generated text transcription and summary. This permission is only used to send and
receive messages on behalf of the business account that explicitly connected through Embedded
Signup — we do not send unsolicited messages.
```

**`[whatsapp_business_management]`**
```
Right after a business owner completes Embedded Signup, we use whatsapp_business_management to
subscribe our app to their WhatsApp Business Account (POST /{waba-id}/subscribed_apps) so we can
receive their webhook events, and to read their connected phone number details (verified name,
phone_number_id) so we can route incoming messages to the correct customer account inside our
platform. We also use it to let the business owner see their connection status and manage message
templates used in automated transcription replies from our own dashboard.
```

**`[business_management]`**
```
ZapScript uses business_management to let a business owner select and authorize their Business
Portfolio and WhatsApp Business Account during the official Meta Embedded Signup flow. This is
required by the Embedded Signup flow itself so the user can choose which Business and WABA to
connect to our platform for automatic audio transcription of messages received on their WhatsApp
Business number.
```

> As 3 respostas seguem também a pergunta padrão "With permission X, your app can..." — não
> precisa editar essa parte, é texto fixo da Meta explicando o escopo da permissão; só o campo
> "Tell us how you're using this permission" acima é texto livre nosso.

### Data handling (aparece uma vez, não por permissão)

**`processor-0`** (Do you have data processors...) — trocar de "No" para:
```
Yes. We use the following data processors to provide our service: (1) OpenAI (Whisper API) —
receives the voice message audio to generate a text transcription; (2) Anthropic (Claude API) —
receives the transcribed text to generate a summary; (3) Supabase (hosted on AWS) — database and
temporary audio file storage. These processors only process data to perform the function
contracted by ZapScript and do not use it for their own purposes.
```

**`responsible-1`** (legal entity) — manter como está:
```
FOX tecnologIA ltda, CNPJ: 66.586.436/0001-12. Legal representative: Roberto Frattari Tulio Silva, CPF: 01250511666.
```

**`responsible-2`** (país): `Brazil`

**`requests-3`** (pedidos de autoridades públicas nos últimos 12 meses): `No`

**`requests-4`** (políticas sobre pedidos de autoridades): manter as 4 opções marcadas como na submissão anterior — essas não tiveram problema.

---

## 🎥 FASE 5 — Screencast (faz ou quebra a aprovação)

Gravar **uma tela contínua, sem cortes**, narração ou legendas em **inglês**. Pode ser **1 vídeo
só**, anexado nos 3 campos de vídeo (`whatsapp_business_messaging`, `whatsapp_business_management`,
`business_management`) — não precisa gravar 3 vezes.

Roteiro cronometrado (~3 min):

- [ ] **0:00–0:15** — Login na conta de teste (`zapscript.me/entrar`)
- [ ] **0:15–0:40** — Dashboard → Números; mostrar a seção "Conectar via API oficial (Meta)"
- [ ] **0:40–1:10** — Clicar "Conectar com a Meta" → **popup oficial da Meta** abre; selecionar
      Business + WABA + número; concluir (FINISH) — *evidencia `business_management` +
      `whatsapp_business_management`*
- [ ] **1:10–1:25** — Voltar ao app: estado **"Conectado — <número>"**
- [ ] **1:25–1:45** *(recomendado)* — WhatsApp Manager mostrando o app **assinado no WABA** —
      *evidencia `whatsapp_business_management`*
- [ ] **1:45–2:15** — De um celular/WhatsApp Web, enviar um áudio de voz pro número conectado
- [ ] **2:15–2:45** — Mostrar a resposta chegando na mesma conversa com transcrição + resumo —
      *evidencia `whatsapp_business_messaging`*
- [ ] **2:45–3:00** — Clicar "Desconectar", confirmar estado desconectado
- [ ] URL `zapscript.me` visível na barra o tempo todo; resolução legível

---

## 📝 FASE 6 — Instruções para o revisor (campo App Review)

- [ ] Criar/garantir **usuário de teste com plano ativo**
- [ ] Preencher o campo de instruções (modelo em inglês):

```
Test account: <email> / <SENHA_FORTE>   (active plan, no payment needed)

Steps to test business_management and whatsapp_business_management (Embedded Signup):
1. Log in at https://zapscript.me/entrar with the test account above.
2. Go to Dashboard → Números (https://zapscript.me/dashboard/numeros).
3. Scroll to "Conectar via API oficial (Meta)" and click "Conectar com a Meta".
4. Complete the official Meta Embedded Signup popup: select a Business, a WhatsApp Business
   Account and a phone number, then finish.
5. The page updates to "Conectado — <phone number>". At this point our backend has exchanged
   the authorization code for an access token, subscribed our app to the connected WABA
   (POST /{waba-id}/subscribed_apps), and stored the connection.
6. Click "Desconectar" to confirm the disconnect flow also works.

Steps to test whatsapp_business_messaging:
7. From the WhatsApp number you just connected (or the Meta test number), send a short voice
   message to that WhatsApp Business number.
8. Within a few seconds, our platform replies in the same WhatsApp conversation with the text
   transcription and an AI-generated summary of the audio.

Note: This is the official WhatsApp Cloud API flow via Embedded Signup — no phone QR-code
pairing or unofficial libraries are used for accounts connected this way.
```

> ⚠️ Pré-requisito pra esse roteiro funcionar de verdade (não só no texto): o backend precisa
> estar no ar, `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED=true`, e `NEXT_PUBLIC_META_APP_ID`/
> `NEXT_PUBLIC_META_CONFIG_ID` setadas na Vercel (senão o botão nem aparece). Ver Fase 7.

---

## 🧪 FASE 7 — Verificação técnica (antes de submeter)

- [ ] Botão azul aparece em `/dashboard/numeros`
- [ ] Clicar → **popup oficial abre** (sem erro de SDK/domínio)
- [ ] Concluir → `POST /meta/connect` retorna `{ ok: true }`
- [ ] Linha `WhatsappNumber provider='meta'` criada com `metaAccessTokenEnc` **criptografado** (não plaintext)
- [ ] No Graph / WhatsApp Manager: app **assinado no WABA**
- [ ] Testar **deauthorize** (remover o app nas configs do Facebook do usuário) → vínculo limpo

---

## 🚀 FASE 8 — Submeter e acompanhar

- [ ] Submeter com **só as 3 permissões** + screencast + instruções de teste
- [ ] Aguardar retorno (típico: **2–5 dias úteis**)
- [ ] Se reprovar: copiar o motivo específico e ajustar

---

## 📌 Resumo de responsabilidades

| Quem | O quê |
|---|---|
| **Assistente (código)** | Fase 0: Graph version + checagem de migração |
| **Você (painéis)** | Fases 1–8: Business Verification, Config ID, env vars, URLs/domínios, permissões, screencast, submissão |

---

## 🔗 Referências do código (já implementado)

| Item | Arquivo |
|---|---|
| Troca code→token, `subscribed_apps`, persistência criptografada | `apps/api/src/routes/meta-embedded.ts` |
| Status / disconnect / deauthorize-internal | `apps/api/src/routes/meta-embedded.ts` |
| Botão Embedded Signup (FB.login + config_id) | `apps/web/src/app/dashboard/numeros/MetaEmbeddedSignup.tsx` |
| Callback deauthorize (valida `signed_request`) | `apps/web/src/app/api/meta/deauthorize/route.ts` |
| Callback data deletion (pré-existente) | `apps/web/src/app/api/data-deletion-callback/route.ts` |

---

_Gerado em 2026-06-19 · ZapScript._
