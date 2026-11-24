# ZapScript — Infraestrutura de Produção

**Leia isto antes de assumir onde qualquer coisa está hospedada.** O histórico do
repo tem vestígios de infra antiga (Render, Railway, Upstash) em docs e configs
que NÃO refletem mais a realidade. A infra atual é só esta:

| Camada            | Onde                                                         | Deploy |
|-------------------|----------------------------------------------------------------|--------|
| API + Worker + Redis + Evolution API | **Vultr** — um único servidor (`216.238.120.65`, DNS `api.zapscript.me`), containers via Docker Compose (`/root/docker-compose.zapscript.yml` no servidor) | **Manual.** GitHub Actions → aba *Actions* → workflow **"Ops — Vultr / Migração"** (`.github/workflows/ops.yml`) → Run workflow → `action = deploy`. Faz SSH, clona o `master` e builda as imagens **direto no servidor** (não usa `ghcr.io`, não faz `docker compose pull`), sobe API primeiro (espera healthcheck), depois Worker, e guarda a imagem anterior como `:previous`. `action = rollback` reverte na hora. |
| Frontend (Next.js)| **Vercel** (projeto `zapscript`, conectado ao GitHub) | **Automático.** Todo push em `master` dispara deploy sozinho — não precisa rodar nada. |
| Banco de dados    | **Supabase** (Postgres + Prisma) | Migrations via `prisma migrate deploy`, rodam no start da API. |

Não existe mais Render, Railway nem Upstash em produção — foram descomissionados
na migração de 2026-07-21 (ver `MIGRACAO_VULTR.md` para o histórico). Se algum
doc antigo (`README.md` velho, `SETUP_*.md`, `CHECKLIST_*.md` com data) ainda
mencionar esses serviços, é registro histórico — não é a infra atual.

`.github/workflows/build-and-push.yml` é **só manual** (`workflow_dispatch`) e publica
imagens da API/Worker no `ghcr.io` que **nada consome** — o `ops.yml` builda direto no
servidor e ignora essas imagens. Não assuma que um push em `master` colocou nada novo no ar
na API/Worker.

## CI e gate de deploy

- `.github/workflows/ci.yml` roda em **todo push/PR** (sem filtro de paths): build, type
  check, testes (com Postgres + Redis reais), `pnpm audit` (bloqueia em *critical*) e o job
  **"Lockfiles npm"**, que faz `npm ci` + build de api/worker/web/monitor e `npm audit`
  nos `package-lock.json` — são eles (e não o `pnpm-lock.yaml`) que Docker e Vercel instalam.
- O `ops.yml` com `action=deploy` **recusa rodar se o `ci.yml` do commit não estiver verde**
  (ou ainda em andamento) e builda no servidor o **SHA exato** do disparo, não a ponta atual
  do `master`. `skip_ci_gate=true` é só para emergência. `rollback` não passa pelo gate.
- Ao mexer em dependências: atualize **os dois mundos** — `pnpm-lock.yaml` e o
  `package-lock.json` do app afetado (`npm install <pkg> --package-lock-only` dentro do app).
  Mudar só um deles passa no CI antigo e quebra o `npm ci` do Docker no deploy.
- Jobs do BullMQ: `jobId` customizado **não pode ter `:`** (nem ser só número). Use os
  helpers de `lib/queue-job-id.ts` (existem em `apps/api` e `apps/worker`, devem ficar iguais).

## Fluxo padrão ao pedir "commit + push + deploy"

1. `git commit` na branch de trabalho.
2. Merge/push para `master` (fast-forward quando possível).
3. **Isso sozinho já deploya o Web** (Vercel pega o push automaticamente).
4. Para API/Worker, ainda falta o passo manual: disparar `ops.yml` com
   `action=deploy` (via `gh workflow run` ou pela MCP tool
   `mcp__github__actions_run_trigger` com `method: run_workflow`,
   `workflow_id: ops.yml`, `ref: master`, `inputs: {"action":"deploy"}`). O próprio
   `ops.yml` recusa se o `ci.yml` do commit não estiver verde (ver "CI e gate de deploy").
5. Acompanhar o run com `mcp__github__actions_list` /
   `mcp__github__actions_get` até `conclusion: success`.

## TLS da API (nginx + certbot no host)

- `api.zapscript.me` termina TLS num **nginx instalado no host do Vultr** (fora do Docker),
  com certificado Let's Encrypt via **certbot**. Config de referência: `infra/nginx-zapscript.conf`
  (o `location /.well-known/acme-challenge/` serve de `/var/www/html`).
- **Incidente 2026-11-20:** o certificado expirou e ficou ~16h assim. O certbot estava com
  `authenticator = standalone` (abre a porta 80, ocupada pelo nginx) e toda renovação falhava
  em silêncio; o healthcheck do Docker é interno e não via nada. Corrigido para
  `authenticator = webroot` (`/var/www/html`), validado com `certbot renew --dry-run`.
- **Nunca** emita/renove com `--standalone` nem pare o nginx para renovar. Para reemitir:
  `certbot certonly --webroot -w /var/www/html -d api.zapscript.me --cert-name api.zapscript.me`
  e `systemctl reload nginx`. Para conferir: `certbot certificates`.
- `.github/workflows/tls-expiry.yml` checa todo dia, **de fora**, a validade (alerta com <= 14
  dias) e `https://api.zapscript.me/health`. Run vermelho = olhar o certbot no servidor.
- Comando no servidor sem SSH: `ops.yml` com `action=custom_ssh` + `custom_command` (a saída
  vai para o log do job — nunca imprima `.env`, chaves ou dados de clientes).

## Balcão Virtual (omnichannel — TJ-TO)

Módulo dentro do monorepo: API em `apps/api/src/balcao`, telas em `apps/web/src/app/balcao` (rota `/balcao`), tabelas `Bv*` no
Prisma. **Comece por `docs/balcao/README.md`** (como rodar, roteiro de PoC, matriz requisito → código → o que foi/não foi
verificado) e `docs/balcao/ARQUITETURA.md` (decisões e contratos entre as frentes). Variáveis `BV_*`: `docs/balcao/ENV.md`.

- Roda **no mesmo processo da API** (jobs periódicos com lock em Redis, controlador ARI de voz, poller IMAP): não há serviço novo
  no `ops.yml`. O **Asterisk** (voz) é um container à parte (`infra/asterisk`); HA/backup/DR em `infra/ha` e `infra/backup`.
- Conteúdo de mensagens e credenciais são **cifrados em repouso**; só `core/messages.ts` lê/escreve `BvMessage.body`.
- Testes: `cd apps/api && npx jest --runInBand src/balcao` (Postgres + Redis reais). Fluxo no navegador: `apps/api/scripts/balcao-e2e-smoke.js`.
- O escudo (`lib/security-shield.ts`) **não conta 401 de `/balcao/`** (centenas de atendentes atrás do mesmo IP de NAT); o rate limit global
  também isenta os webhooks do Balcão. Não reverta sem ler o comentário no código.
- Simuladores de canal (`BV_DEV_SIMULATORS=1`) são só para demonstração — **nunca em produção**.

## Outras notas úteis

- `ENCRYPTION_KEY`, `JWT_SECRET`, `INTERNAL_TOKEN`, `ADMIN_TOKEN` etc. vivem no
  `.env` do servidor Vultr, não em variáveis do GitHub nem da Vercel (exceto
  as `NEXT_PUBLIC_*` que o build da Vercel precisa).
- Webhooks do Asaas e da Evolution API apontam para `https://api.zapscript.me`
  (Vultr), não para nenhuma URL `.onrender.com` ou `.railway.app`.
- O sandbox do Claude Code on the web **não consegue SSH no servidor Vultr**
  (porta 22 bloqueada na política de rede do ambiente — só sai HTTP/HTTPS).
  Diagnóstico/comando direto no servidor precisa ser rodado pelo usuário, que
  cola o resultado de volta. Não adianta gerar chave nem pedir autorização —
  é limitação de rede do ambiente, não de credencial.
