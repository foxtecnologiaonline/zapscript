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

- [ ] **REMOVER** `manage_app_solution` do pedido (causa de reprovação anterior)
- [ ] Solicitar `whatsapp_business_messaging`
- [ ] Solicitar `whatsapp_business_management`
- [ ] Solicitar `business_management`

**Justificativas (colar em inglês):**

| Permissão | Justificativa |
|---|---|
| `whatsapp_business_messaging` | *Our app lets a business owner connect their own WhatsApp Business Account via Embedded Signup so our service can send and receive messages (audio transcription summaries) on their behalf.* |
| `whatsapp_business_management` | *Used to subscribe our app to the connected WABA (`/{waba-id}/subscribed_apps`) and read the connected phone number details after Embedded Signup.* |
| `business_management` | *Required by Embedded Signup to let the user select/authorize their Business and WABA during the official Meta connection flow.* |

---

## 🎥 FASE 5 — Screencast (faz ou quebra a aprovação)

Gravar **uma tela contínua, sem cortes**, com narração/legendas em **inglês**:

- [ ] Login na **conta de teste** que será fornecida à Meta
- [ ] Navegar até `/dashboard/numeros` e mostrar a seção **"Conectar via API oficial (Meta)"**
- [ ] Clicar **"Conectar com a Meta"** → o **popup oficial da Meta** abre
- [ ] Selecionar Business + WABA + número no popup e **concluir** (FINISH)
- [ ] Voltar ao app mostrando estado **"Conectado — <número>"**
- [ ] (Recomendado) Mostrar no **WhatsApp Manager** que o app está **assinado no WABA**
- [ ] Mostrar o **"Desconectar"** funcionando
- [ ] URL `www.zapscript.me` visível na barra; resolução legível; 2–4 min

---

## 📝 FASE 6 — Instruções para o revisor (campo App Review)

- [ ] Criar/garantir **usuário de teste com plano ativo**
- [ ] Preencher o campo de instruções (modelo em inglês):

```
Test account: <email> / <senha>   (já com plano ativo)
Steps:
1. Log in at https://www.zapscript.me/entrar
2. Go to Dashboard → Números (https://www.zapscript.me/dashboard/numeros)
3. Scroll to "Conectar via API oficial (Meta)" and click "Conectar com a Meta"
4. Complete the official Meta Embedded Signup popup (select Business → WABA → phone)
5. The page shows "Conectado". Our backend subscribes our app to the WABA.
Note: This is the official WhatsApp Cloud API connection flow via Embedded Signup.
```

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
