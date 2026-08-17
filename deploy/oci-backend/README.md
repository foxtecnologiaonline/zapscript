# API + Worker no Oracle Cloud Always Free (+ Redis no Upstash)

Objetivo: colocar o backend no ar de novo, **de graça e pra valer** — não como ponte
temporária. Dividido em 2 serviços pra não depender só da RAM de uma VM:

- **Redis → Upstash free tier** (managed, fora da VM; o código já foi feito pra rodar nele —
  ver comentários em `apps/*/src/*/queue.ts`)
- **API + Worker → 1 VM na OCI** (Always Free, ARM). Sem Evolution API (não precisa dela no
  caminho oficial da Meta) e sem Redis local, então a VM só roda 2 processos Node leves —
  sobra bastante RAM da cota Always Free.

O banco continua sendo o Supabase, sem mudança nenhuma aí.

> Você já tem conta na OCI, então pula direto pra Parte 1. A conta do Upstash (Parte 0) é
> separada — se não tiver, é cadastro rápido (GitHub/Google login) e o plano grátis não pede
> cartão.

---

## Parte 0 — Redis grátis no Upstash

1. [upstash.com](https://upstash.com) → **Create database** → plano **Free**.
   Região: escolha a mais perto da VM da OCI (Parte 1) pra menor latência.
2. Depois de criado, na aba **Connect**, escolha **".env"** ou **"ioredis"** — copia a linha
   que começa com `rediss://default:...@....upstash.io:6379`.
3. Guarde esse valor — vai virar `REDIS_URL` no `.env` da Parte 2.

> O tier grátis do Upstash (256MB / ~10k comandos por dia) é diferente do Upstash **pago** que
> o ZapScript usou antes e descomissionou por custo (ver `CLAUDE.md`) — aqui é escolha
> deliberada por ser gratuito, não uma volta atrás por engano.

---

## Parte 1 — Console OCI (só você consegue fazer)

### 1.1 Criar a VM
Console OCI → **Compute → Instances → Create instance**:
- **Image:** Ubuntu 22.04
- **Shape:** `VM.Standard.A1.Flex` (Ampere/ARM, **Always Free**) — recomendo **2 OCPU / 12 GB
  RAM** (metade da cota Always Free — sobra a outra metade pra uma segunda VM no futuro, se
  precisar)
- **Networking:** *Assign a public IPv4 address* = **Yes**
- **SSH keys:** cole sua chave pública (gere uma nova com `ssh-keygen` se não tiver uma à mão)
- **Create**

Anote o **Public IP** da instância.

> ⚠️ Gotcha conhecido da OCI: o shape `A1.Flex` Always Free às vezes dá "Out of capacity" na
> região escolhida. Se acontecer, tente de novo em alguns minutos, ou troque de
> Availability Domain dentro da mesma região — não é erro seu, é disponibilidade da OCI.

### 1.2 Abrir portas 80/443 na rede (Security List)
Console OCI → **Networking → Virtual Cloud Networks** → sua VCN → **Security Lists** →
*Default Security List* → **Add Ingress Rules**, crie duas:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

> Isto libera só a **rede**. As portas no **SO** (iptables) são abertas pelo `setup.sh`.

### 1.3 Atualizar o DNS
No provedor de DNS do domínio `zapscript.me`, edite o registro **A** de `api.zapscript.me`
pra apontar pro **Public IP** novo da VM (era o IP da Vultr — troca o valor, não cria um
registro novo). TTL baixo (300) ajuda a propagar rápido.

---

## Parte 2 — Deploy (via SSH, na VM)

```bash
ssh ubuntu@SEU_IP_PUBLICO

# 1) Clonar o repo inteiro (as imagens são buildadas na própria VM, não puxadas do ghcr.io —
#    ver o comentário no topo do setup.sh)
git clone https://github.com/foxtecnologiaonline/zapscript.git
cd zapscript

# 2) Preencher os segredos
cp .env.example .env
nano .env
#   Preencher pelo menos: DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
#   SUPABASE_SERVICE_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, JWT_SECRET, ENCRYPTION_KEY,
#   INTERNAL_TOKEN, ADMIN_TOKEN, ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, RESEND_API_KEY,
#   REDIS_URL (a connection string do Upstash da Parte 0), DOMAIN=api.zapscript.me
#   Se for reativar o caminho oficial da Meta agora: META_APP_ID, META_APP_SECRET,
#   INTERNAL_API_SECRET, e WHATSAPP_OFFICIAL_MULTITENANT_ENABLED=true

# 3) Rodar o bootstrap (abre firewall do SO, instala Docker, builda e sobe tudo)
chmod +x deploy/oci-backend/setup.sh
./deploy/oci-backend/setup.sh
```

## Parte 3 — Verificação

```bash
# Acompanhar o SSL (Let's Encrypt via Caddy) — rodar da raiz do repo.
# --env-file .env é necessário aqui também (ver comentário no setup.sh):
# sem ele o Compose não acha DOMAIN e os containers sobem errados.
sudo docker compose -f deploy/oci-backend/docker-compose.yml --env-file .env logs -f caddy
# Espere aparecer "certificate obtained"

# Testar
curl https://api.zapscript.me/health
# Deve responder {"status":"ok",...}
```

Depois disso, o resto da stack já enxerga o Supabase (banco) e o Upstash (fila). Não precisa
mexer na Vercel — `NEXT_PUBLIC_API_URL` já aponta pra `api.zapscript.me`, só o IP por trás do
DNS mudou.

## Rollback / troca de VM

Se essa VM tiver problema, é só repetir a Parte 1 numa VM nova, colar o **mesmo** `REDIS_URL`
do Upstash no `.env` novo, e trocar o DNS de novo — nenhum dado de produção mora na VM (banco
é Supabase, fila é Upstash, segredos ficam só no `.env` que você preenche de novo). Zero
estado local pra perder — a VM em si é totalmente descartável.

## Diferença pro deploy antigo (Vultr)

| | Vultr (`infra/docker-compose.prod.yml`) | OCI + Upstash (aqui) |
|---|---|---|
| Evolution API | Sim (Baileys, sempre-on) | **Não** — caminho 100% oficial (Meta Cloud API) |
| Redis | Container local na Vultr | Upstash free tier (fora da VM) |
| Proxy/SSL | Nginx nativo no host | Caddy em container (SSL automático) |
| Build das imagens | Direto no servidor via `ops.yml` (SSH) | Direto na VM via `setup.sh` (manual, primeira vez) |
| Custo | ~$45/mês | **$0 — Always Free, permanente** |
