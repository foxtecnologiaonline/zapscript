# ZapScript — Infraestrutura de Produção

**Leia isto antes de assumir onde qualquer coisa está hospedada.** O histórico
do repo tem vestígios de infra antiga (Render, Railway, Upstash, e agora
também Vultr) em docs e configs que podem NÃO refletir a realidade no momento
em que você está lendo — confira a data dos docs de migração antes de confiar
numa tabela às cegas.

## Migração Vultr → Render PAUSADA (desde 2026-08-21, pausada no mesmo dia)

A ideia era voltar pro Render (runbook em `MIGRACAO_RENDER.md`, `render.yaml`
e `.github/workflows/ops-render.yml` já commitados) — mas **foi pausada antes
do corte de tráfego acontecer**, por causa do custo: o Render nunca rodou de
graça pra este projeto (era ~$77/mês antes de sair de lá em julho, ver
`MIGRACAO_VULTR.md`), e mesmo o setup mínimo viável ficaria uns ~$28-36/mês só
de api+worker+redis+evolution, sem contar que free tier quebraria o produto
de verdade (serviço web grátis "dorme" e derruba webhook do WhatsApp/Asaas;
sem disco persistente no free tier, todo cliente perderia a sessão do
WhatsApp a cada restart).

Em vez disso, a direção agora é **reduzir o custo da própria Vultr** (que
subiu pra ~$45/mês, custo real hoje — bate menos com o ~$33/mês documentado
em `MIGRACAO_VULTR.md`) via **um servidor Vultr novo, menor**, substituindo o
atual — não uma migração de provedor, só um resize por substituição. Ver
seção abaixo / conversa em andamento pro runbook dessa parte.

`render.yaml`, `ops-render.yml` e `MIGRACAO_RENDER.md` **continuam no repo,
não foram deletados** — só não é mais o plano ativo. Se a decisão for
retomada no futuro, o trabalho já fica pronto (só precisa reconferir se o
código não andou tanto que os `sync: false` do `render.yaml` ficaram
desatualizados).

**A Vultr continua sendo a infra real de verdade** — é a tabela "Infra
atual" logo abaixo. Se algum dia o corte pro Render acontecer de verdade,
atualize esta seção: mova a Vultr pra "histórico" (do jeito que a migração
de julho fez com o Render antigo) e promova a tabela "Depois do
corte" pra "Infra atual".

## Infra atual (Vultr — vale até o corte do parágrafo acima acontecer)

| Camada            | Onde                                                         | Deploy |
|-------------------|----------------------------------------------------------------|--------|
| API + Worker + Redis + Evolution API | **Vultr** — um único servidor (`216.238.114.73`, DNS `api.zapscript.me`), containers via Docker Compose (`/root/docker-compose.zapscript.yml` no servidor) | **Manual.** GitHub Actions → aba *Actions* → workflow **"Ops — Vultr / Migração"** (`.github/workflows/ops.yml`) → Run workflow → `action = deploy`. Faz SSH, clona o `master` e builda as imagens **direto no servidor** (não usa `ghcr.io`, não faz `docker compose pull`), sobe API primeiro (espera healthcheck), depois Worker, e guarda a imagem anterior como `:previous`. `action = rollback` reverte na hora. |
| Frontend (Next.js)| **Vercel** (projeto `zapscript`, conectado ao GitHub) | **Automático.** Todo push em `master` dispara deploy sozinho — não precisa rodar nada. |
| Banco de dados    | **Supabase** (Postgres + Prisma) | Migrations via `prisma migrate deploy`, rodam no start da API. |

Frontend (Vercel) e banco (Supabase) **não mudam** com a migração pro Render
— só API+Worker+Redis+Evolution API saem da Vultr.

Railway e Upstash continuam descomissionados (migração de 2026-07-21, ver
`MIGRACAO_VULTR.md`) — isso não voltou nesta migração. Se algum doc antigo
(`README.md` velho, `SETUP_*.md`, `CHECKLIST_*.md` com data,
`RENDER_ENV_SETUP.md` — esse é de **antes** de 2026-07-21) mencionar infra
diferente das tabelas deste arquivo, é registro histórico — confira a data
antes de reaproveitar qualquer coisa de lá, secrets inclusive (ver nota de
segurança no fim deste arquivo).

`.github/workflows/build-and-push.yml` ainda publica imagens da API/Worker no
`ghcr.io` a cada push em `master`, mas **isso não alimenta nenhum dos dois
deploys reais** — nem `ops.yml` (Vultr, builda direto no servidor via SSH)
nem `ops-render.yml` (Render, builda direto do Dockerfile via git). Não
assuma que um push em `master` colocou nada novo no ar na API/Worker, em
nenhuma das duas infras.

## Infra alvo, depois que o corte pro Render acontecer

| Camada            | Onde                                                         | Deploy |
|-------------------|----------------------------------------------------------------|--------|
| API + Worker + Redis | **Render** (`render.yaml` na raiz do repo) | **Manual.** Actions → **"Ops — Render"** (`.github/workflows/ops-render.yml`) → `action = deploy`. Chama a API do Render (`RENDER_API_KEY` como secret do repo), sobe `evolution` → `api` (espera healthcheck) → `worker`, nessa ordem. `action = rollback` volta api+worker pro deploy `live` anterior. `action = status` só lê, sem side-effect. |
| Evolution API (WhatsApp) | **Render**, serviço privado (`pserv`) com disco persistente para a sessão — OU um host brasileiro à parte (Vultr dimensionado só pra isso, ou o piloto em `deploy/evolution-oci/`), **se** o aviso de fraude do WhatsApp voltar | Mesmo workflow acima, ou runbook manual do host BR |
| Frontend (Next.js)| **Vercel** — sem mudança nenhuma nesta migração | Automático |
| Banco de dados    | **Supabase** — sem mudança nenhuma nesta migração | Automático (`prisma migrate deploy` no start da API) |

`api.zapscript.me` continua sendo o domínio de todo mundo (Vercel, Asaas,
Meta) depois do corte — a mudança foi só um CNAME apontando pro Render em vez
da Vultr (`MIGRACAO_RENDER.md`, seção 6). Nenhuma dessas integrações externas
precisa de reconfiguração por causa desta migração.

## Fluxo padrão ao pedir "commit + push + deploy"

1. `git commit` na branch de trabalho.
2. Merge/push para `master` (fast-forward quando possível).
3. **Isso sozinho já deploya o Web** (Vercel pega o push automaticamente).
4. Para API/Worker, ainda falta o passo manual — **confira antes qual infra
   está valendo agora** (seção "Migração em andamento" acima) pra saber qual
   workflow disparar:
   - Ainda na Vultr: `ops.yml`, `workflow_id: ops.yml`.
   - Já no Render: `ops-render.yml`, `workflow_id: ops-render.yml`.
   Em ambos os casos: `action=deploy`, via `gh workflow run` ou a MCP tool
   `mcp__github__actions_run_trigger` (`method: run_workflow`, `ref: master`,
   `inputs: {"action":"deploy"}`).
5. Acompanhar o run com `mcp__github__actions_list` /
   `mcp__github__actions_get` até `conclusion: success`.

## Outras notas úteis

- `ENCRYPTION_KEY`, `JWT_SECRET`, `INTERNAL_TOKEN`, `ADMIN_TOKEN` etc. vivem
  hoje no `.env` do servidor Vultr. Depois do corte pro Render, migram para o
  grupo `zapscript-secrets` no dashboard do Render (ver comentários no
  `render.yaml`). Nunca em variáveis do GitHub nem da Vercel — exceto as
  `NEXT_PUBLIC_*` que o build da Vercel precisa, e `RENDER_API_KEY`, que é do
  GitHub Actions (`ops-render.yml`), não da aplicação.
- Webhooks do Asaas e da Evolution API apontam para `https://api.zapscript.me`
  — isso não muda com a migração pro Render (ver tabela acima), e não deve
  virar nenhuma URL `.onrender.com` crua nem `.railway.app` em nenhuma config.
- `RENDER_ENV_SETUP.md` é de **antes** da migração pra Vultr (pré-2026-07-21)
  e tem um `WHATSAPP_API_TOKEN` em texto puro commitado no repo — achado de
  segurança à parte, não relacionado a qual infra está no ar. Não reaproveitar
  os valores de lá; ver nota equivalente no fim do `MIGRACAO_RENDER.md`.
