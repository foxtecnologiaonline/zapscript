# ZapScript — Infraestrutura de Produção

**Leia isto antes de assumir onde qualquer coisa está hospedada.** O histórico do
repo tem vestígios de infra antiga (Render, Railway, Upstash) em docs e configs
que NÃO refletem mais a realidade. A infra atual é só esta:

| Camada            | Onde                                                         | Deploy |
|-------------------|----------------------------------------------------------------|--------|
| API + Worker + Redis + Evolution API | **Vultr** — um único servidor (`216.238.114.73`, DNS `api.zapscript.me`), containers via Docker Compose (`/root/docker-compose.zapscript.yml` no servidor) | **Manual.** GitHub Actions → aba *Actions* → workflow **"Ops — Vultr / Migração"** (`.github/workflows/ops.yml`) → Run workflow → `action = deploy`. Faz SSH, clona o `master` e builda as imagens **direto no servidor** (não usa `ghcr.io`, não faz `docker compose pull`), sobe API primeiro (espera healthcheck), depois Worker, e guarda a imagem anterior como `:previous`. `action = rollback` reverte na hora. |
| Frontend (Next.js)| **Vercel** (projeto `zapscript`, conectado ao GitHub) | **Automático.** Todo push em `master` dispara deploy sozinho — não precisa rodar nada. |
| Banco de dados    | **Supabase** (Postgres + Prisma) | Migrations via `prisma migrate deploy`, rodam no start da API. |

Não existe mais Render, Railway nem Upstash em produção — foram descomissionados
na migração de 2026-07-21 (ver `MIGRACAO_VULTR.md` para o histórico). Se algum
doc antigo (`README.md` velho, `SETUP_*.md`, `CHECKLIST_*.md` com data) ainda
mencionar esses serviços, é registro histórico — não é a infra atual.

`.github/workflows/build-and-push.yml` ainda publica imagens da API/Worker no
`ghcr.io` a cada push em `master`, mas **isso não alimenta o deploy real** — o
`ops.yml` builda direto no servidor e ignora essas imagens. Não assuma que um
push em `master` colocou nada novo no ar na API/Worker.

## Fluxo padrão ao pedir "commit + push + deploy"

1. `git commit` na branch de trabalho.
2. Merge/push para `master` (fast-forward quando possível).
3. **Isso sozinho já deploya o Web** (Vercel pega o push automaticamente).
4. Para API/Worker, ainda falta o passo manual: disparar `ops.yml` com
   `action=deploy` (via `gh workflow run` ou pela MCP tool
   `mcp__github__actions_run_trigger` com `method: run_workflow`,
   `workflow_id: ops.yml`, `ref: master`, `inputs: {"action":"deploy"}`).
5. Acompanhar o run com `mcp__github__actions_list` /
   `mcp__github__actions_get` até `conclusion: success`.

## Outras notas úteis

- `ENCRYPTION_KEY`, `JWT_SECRET`, `INTERNAL_TOKEN`, `ADMIN_TOKEN` etc. vivem no
  `.env` do servidor Vultr, não em variáveis do GitHub nem da Vercel (exceto
  as `NEXT_PUBLIC_*` que o build da Vercel precisa).
- Webhooks do Asaas e da Evolution API apontam para `https://api.zapscript.me`
  (Vultr), não para nenhuma URL `.onrender.com` ou `.railway.app`.
