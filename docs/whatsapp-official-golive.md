# WhatsApp oficial (Cloud API / Embedded Signup) — checklist de go-live

> Este documento descreve o estado **real** do código no `master` nesta data — não uma
> proposta. O pipeline multi-tenant está **implementado e testado por tipo (tsc), mas
> desligado por padrão**. Ninguém percebe nada até as env vars abaixo serem preenchidas.

## Por que isso importa para o custo do Vultr

O Evolution API (Baileys) mantém uma sessão WebSocket sempre ativa por número
conectado — é o processo mais pesado em RAM no servidor Vultr (ver `CLAUDE.md` e
`infra/docker-compose.prod.yml`). A API oficial da Meta é 100% baseada em webhook:
não existe sessão persistente para manter no nosso servidor. Cada cliente migrado
de `provider: 'evolution'` para `provider: 'meta'` reduz a carga do Evolution —
sem precisar trocar de servidor nem de plano.

## O que já está pronto (coexistência total com Evolution — zero cutover forçado)

| Peça | Onde | Status |
|---|---|---|
| Embedded Signup (OAuth code→token, assina app na WABA, salva token criptografado) | `apps/api/src/routes/meta-embedded.ts` | Pronto — hoje só usado para App Review da Meta |
| Botão "Conectar via API oficial" no dashboard | `apps/web/src/app/dashboard/numeros/MetaEmbeddedSignup.tsx` | Pronto — só renderiza se `NEXT_PUBLIC_META_APP_ID`+`NEXT_PUBLIC_META_CONFIG_ID` estiverem setados |
| Pipeline completo de transcrição via Cloud API (baixar áudio, MP3, Whisper, Claude, responder, debitar cota) | `apps/worker/src/index.ts` → `processOfficialWhatsAppJob` | Pronto e em produção — hoje roda com **um único número global** (env `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`) |
| Webhook roteando por `phone_number_id` (multi-tenant) + `numberId` no job | `apps/api/src/routes/whatsapp-webhook.ts` | **Implementado nesta mudança** |
| Worker usando token/phoneNumberId por número (Embedded Signup) em vez do par global | `apps/worker/src/services/whatsapp-official.ts` + `processOfficialWhatsAppJob` | **Implementado nesta mudança**, atrás da flag `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED` |

Com a flag **desligada** (padrão), tudo se comporta exatamente como hoje: um único
número oficial global, resto dos clientes no Evolution. Isso é intencional — a
decisão de quando ativar é do time, não deste commit.

## Pré-requisitos no painel Meta (developers.facebook.com)

1. App com produto **WhatsApp** + **Facebook Login for Business**.
2. Criar uma **configuração de Embedded Signup** → anotar o **Config ID**.
3. Webhook do app apontando para `https://api.zapscript.me/webhook/whatsapp`,
   campo `messages` assinado, verify token = `WHATSAPP_WEBHOOK_TOKEN`.
4. **App Review**: enquanto o app estiver em modo *Development*, só funciona com
   números de teste cadastrados manualmente no painel Meta. Para conectar clientes
   reais é preciso a Meta aprovar os escopos `whatsapp_business_management` e
   `whatsapp_business_messaging` (App Review) e o app entrar em modo *Live*.

## Variáveis de ambiente

- **API + Worker (`.env` do servidor Vultr — ver `CLAUDE.md`):**
  `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` (default `v23.0`),
  `INTERNAL_API_SECRET`, e a flag `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED`.
  Os legados `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` continuam servindo de
  fallback para números sem Embedded Signup.
- **Web (Vercel):** `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID`.
  Sem estas, o botão "Conectar oficial" não aparece (rollout seguro).

Ver `.env.example` para a lista completa comentada.

## Sequência de ativação (quando o time decidir)

1. Preencher `META_APP_ID`/`META_APP_SECRET`/`INTERNAL_API_SECRET` no `.env` do
   Vultr (sem `NEXT_PUBLIC_*` ainda → UI não muda) e rodar o deploy manual
   (`ops.yml` → `action=deploy`, ver `CLAUDE.md`).
2. Validar o webhook: `GET https://api.zapscript.me/webhook/whatsapp` responde ao
   handshake da Meta com o `hub_challenge`.
3. Ligar `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED=true` no `.env` do Vultr + deploy.
   Ainda não muda nada visível — só habilita o worker a usar credenciais por
   número quando existirem.
4. Ligar `NEXT_PUBLIC_META_APP_ID`/`NEXT_PUBLIC_META_CONFIG_ID` no Vercel → botão
   "Conectar via API oficial" passa a aparecer em Dashboard → Números.
5. Testar ponta a ponta com um número de teste: Embedded Signup → enviar áudio →
   confirmar que a transcrição volta pelo número certo.
6. Decidir o escopo do rollout (só números novos vs. migração gradual dos
   existentes) — isso é decisão de produto, não deste checklist.

## Rollback

- Desligar `NEXT_PUBLIC_META_APP_ID`/`NEXT_PUBLIC_META_CONFIG_ID` no Vercel esconde
  o botão de novo; números já conectados via `provider: 'meta'` continuam
  funcionando através do worker.
- Desligar `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED` faz o worker voltar a ignorar
  as credenciais por número — nenhum dado é perdido, só para de ser usado.
- Nenhuma das duas mexe no pipeline Evolution, que segue como está.

## Custo

A Meta cobra por conversa após a cota grátis mensal (custo variável, cresce com o
número de clientes migrados) — trade-off já aceito pelo time em troca de reduzir o
custo fixo do servidor Vultr (Evolution/Baileys é hoje o processo mais pesado em
RAM lá).
