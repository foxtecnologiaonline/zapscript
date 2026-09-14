# ZapWidget

Produto **separado do ZapScript.me** (app/banco/auth/billing próprios), criado
a partir do escopo "ZapScript WhatsApp White Label": um widget de chat
embutível, plug-and-play, que conecta ao WhatsApp do cliente via Evolution
API e permite ao dono do site atender seus visitantes por WhatsApp dentro de
uma interface própria (Inbox).

Reaproveita só o **motor de mensageria** (Evolution API) — pode inclusive
apontar para o mesmo servidor Evolution que já roda no Vultr do ZapScript.me,
usando o prefixo `wl-` nas instâncias para nunca colidir com as `zs-` do
produto principal. Tudo o mais (banco, auth, billing, tenancy) é independente.

## Por que existe

O ZapScript.me hoje é uma suíte de módulos de IA (Atende, Copiloto,
Campanhas...) para o dono de um número atender **seus próprios clientes**.
Não é um produto white-label embutível em site de terceiro. Em vez de forçar
esse conceito dentro da arquitetura existente (tenancy por `User`, billing
Asaas em reais/tier fixo, sem conceito de "site embutindo widget"), este é um
app novo, com seu próprio modelo de dados — ver decisão registrada na sessão
que criou este diretório.

## Arquitetura

```
apps/widget/                  # Next.js 14 (App Router) — API + dashboard + widget.js
  public/widget.js            # script embutível (vanilla JS, Shadow DOM, sem build)
  src/lib/messaging/
    engine.ts                 # interface MessagingEngine (Fase 1 ⇄ Fase 2)
    evolution-engine.ts       # implementação Fase 1 (Evolution/Baileys)
    meta-engine.ts            # stub Fase 2 (Meta Cloud API) — ver comentário no arquivo
  src/app/api/
    auth/{login,register}     # login/cadastro do Client (dono do site)
    connections/*             # criar/listar/QR/desconectar números
    disclaimer                # aceite obrigatório do aviso de risco (Fase 1)
    webhook/evolution/:id     # recebe eventos da Evolution (conexão + mensagens)
    conversations/*           # Inbox: listar conversas, mensagens, responder
    widget/:publicKey/*       # endpoints PÚBLICOS chamados pelo widget.js (CORS aberto)
    settings                  # cor/saudação/posição do widget + snippet de embed
  src/app/dashboard/          # painel do dono do site (Next/React, autenticado)

packages/widget-db/           # schema Prisma INDEPENDENTE (não é o mesmo banco do ZapScript.me)
```

### Como a ponte Widget ⇄ WhatsApp funciona

1. Visitante abre o widget no site do cliente → preenche nome + **seu
   WhatsApp** (pré-chat). Sem isso não dá pra ter uma conversa de WhatsApp de
   verdade — é a mesma exigência de qualquer canal WhatsApp não-oficial.
2. `POST /api/widget/:publicKey/start` cria a `Conversation` e dispara uma
   saudação via Evolution para o WhatsApp do visitante — a partir daí a
   conversa existe de fato no WhatsApp dele.
3. Mensagens digitadas no widget ficam visíveis pro agente no **Inbox**
   (`/dashboard/inbox`); a resposta do agente é que sai de verdade por
   WhatsApp (`POST /api/conversations/:id/reply` → `evolutionEngine.sendText`).
4. Se o visitante responder direto pelo próprio app do WhatsApp dele (em vez
   do widget), o webhook (`/api/webhook/evolution/:connectionId`) capta e
   cai na mesma `Conversation` — uma única thread, independente da origem.
5. O widget faz **polling** (`GET /api/widget/:publicKey/messages`) para
   puxar tanto as respostas do agente quanto as mensagens que o visitante
   mandou pelo WhatsApp de verdade.

### Fase 1 → Fase 2 (Meta Cloud API)

Nenhum módulo chama `evolution-engine.ts` diretamente — tudo passa pela
interface `MessagingEngine` (`src/lib/messaging/engine.ts`). Migrar de fato
é: implementar `meta-engine.ts` de ponta a ponta (mesmo desenho que
`apps/api/src/services/whatsapp-official.ts` já usa no ZapScript.me) e trocar
o provider default — nenhum outro arquivo muda. `WhatsappConnection.provider`
já existe no schema para isso.

Critério de corte (escopo §2): volume mensal de mensagens acima do seguro
para motor não-oficial, ou exigência de compliance do cliente.

## O que está pronto nesta primeira versão (MVP mínimo funcional)

- [x] Cadastro/login de Client (sem CNPJ, sem aprovação Meta)
- [x] Conectar número via QR Code (Evolution), status, desconectar
- [x] **Aviso obrigatório** de risco de bloqueio antes de liberar a primeira conexão (escopo §2 e §6)
- [x] Widget embutível (`<script data-key>`), plug-and-play, isolado via Shadow DOM
- [x] Pré-chat (nome + WhatsApp) → ponte real com WhatsApp via Evolution
- [x] Inbox web para o agente responder
- [x] Múltiplas contas conectadas por cliente (schema + API já suportam; UI mostra a lista)
- [x] Camada de adapter Evolution ⇄ Meta Cloud API (Fase 2 como stub, não implementado)
- [x] Customização básica do widget (cor, saudação, posição) + snippet de embed

## Deliberadamente fora desta primeira versão

- **Billing** — não há cobrança implementada (escopo §5 pede validar o
  modelo antes: por número/volume vs. por site). Cadastro é livre por ora.
- **Tempo real via WebSocket** — o widget e o Inbox usam *polling* (a cada
  4-8s), não Socket.IO. Suficiente pro MVP; trocar por push é uma extensão
  isolada (não muda o modelo de dados).
- **Instagram DM / Telegram** (diferencial §4.1) — não iniciado; depende da
  Fase 2 (API oficial da Meta) para o canal Instagram.
- **IA nativa (triagem/sugestão de resposta)** (diferencial §4.3) — não
  implementada aqui. O ZapScript.me já tem uma feature equivalente madura
  (módulo Copiloto) que poderia ser portada/adaptada depois, mas isso não foi
  feito nesta rodada.
- **Deploy/infra de produção** — este app roda localmente
  (`pnpm widget:dev`, porta 3010) mas não foi conectado a nenhum pipeline de
  deploy (Vultr/Vercel). Isso é uma decisão de infra (onde hospedar o
  Postgres do `WIDGET_DATABASE_URL`, onde rodar o Next.js) que fica para
  quando o MVP for validado.
- **Envio de mídia** (imagem/áudio) no widget — só texto por enquanto, tanto
  no webhook de entrada quanto no envio.
- **Restrição de origem do widget** — `Client.allowedOrigin` existe no schema
  e é usado no CORS quando preenchido, mas nada na UI ainda permite
  configurá-lo (fica liberado para qualquer domínio por padrão).

## Rodando localmente

```bash
cp apps/widget/.env.example apps/widget/.env
# preencher WIDGET_DATABASE_URL, WIDGET_JWT_SECRET, WIDGET_EVOLUTION_API_URL, WIDGET_EVOLUTION_API_KEY, WIDGET_PUBLIC_URL

pnpm install
pnpm widget:db:migrate   # cria as tabelas no WIDGET_DATABASE_URL
pnpm widget:dev          # http://localhost:3010
```

Para testar o widget embutido num site qualquer:

```html
<script src="http://localhost:3010/widget.js" data-key="SUA_PUBLIC_KEY" async></script>
```

(a `publicKey` aparece em `/dashboard/widget-settings` depois de logar).
