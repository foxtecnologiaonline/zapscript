# Coolify na Vultr — plano e implementação

Objetivo: ter uma UI de deploy (Coolify) para gerenciar API + Worker + Redis +
Evolution API, com deploy por push no Git, HTTPS automático, logs e rollback
pela interface — em vez do processo manual de hoje (SSH + `docker compose` +
nginx + certbot na unha, documentado em `MIGRACAO_VULTR.md`).

> ⚠️ **Este diretório é código de infraestrutura (scripts + runbook), não uma
> execução automática contra o servidor de produção.** Eu (Claude, rodando num
> ambiente isolado, sem chave SSH nem token da Vultr) não tenho como acessar o
> VPS real. Os passos marcados **[MANUAL]** abaixo só você consegue fazer
> (console da Vultr, DNS, cartão de crédito). Os passos **[SCRIPT]** já estão
> prontos pra rodar.

---

## Caminho automatizado (recomendado)

Reduz os passos manuais ao mínimo tecnicamente possível. Rode a partir de uma
máquina com internet normal (sua máquina local ou um runner de CI) — **não**
dentro de uma sessão do Claude Code neste ambiente, porque a rede daqui
bloqueia por política tanto `api.vultr.com` quanto `api.vercel.com` (testado;
ver detalhes na seção [Limitações deste ambiente](#limitações-deste-ambiente)).

```bash
# 1) Provisiona o VPS na Vultr E instala o Coolify sozinho no primeiro boot
#    (embute infra/coolify/install-coolify.sh via cloud-init — sem SSH manual)
export VULTR_API_KEY="..."                         # my.vultr.com → Account → API
export VULTR_SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)"
./infra/coolify/vultr-provision.sh
# → imprime o IP quando o servidor sobe; aguarde ~5min o cloud-init terminar
#   (acompanhar: ssh root@IP 'tail -f /var/log/coolify-install.log')

# 2) [MANUAL, inevitável] Criar o registro DNS coolify.zapscript.me → IP
#    no painel da Vercel (Domains) — não existe API/tool disponível aqui
#    pra automatizar essa parte.

# 3) [MANUAL, inevitável — só existe pelo navegador]
#    Acesse http://IP:8000, crie o usuário admin, configure o domínio em
#    Settings → Instance, e gere um token em Keys & Tokens → Create New Token.
#    Depois: New Project "zapscript" → New Resource → Docker Compose →
#    conectar o GitHub → branch master →
#    infra/coolify/docker-compose.coolify.yml. Copie o UUID do application
#    da URL (…/application/<UUID>).

# 4) Sobe TODAS as env vars de uma vez (em vez de colar uma por uma) e
#    dispara o deploy
cp infra/coolify/env.coolify.example infra/coolify/.env.coolify.local
# preencha infra/coolify/.env.coolify.local com os valores reais (já no
# .gitignore, não é commitado)
export COOLIFY_URL="https://coolify.zapscript.me"
export COOLIFY_API_TOKEN="..."
export COOLIFY_APP_UUID="..."
./infra/coolify/bootstrap-coolify.sh infra/coolify/.env.coolify.local
```

Os dois passos manuais que sobram (DNS na Vercel e o primeiro login no
Coolify) são inerentes às ferramentas em si — nem Vultr nem Vercel expõem
"criar admin"/"registro DNS" de um jeito que dê pra automatizar daqui sem
credenciais extras que envolvem risco desproporcional pra economia de 2
cliques.

### Limitações deste ambiente

Testado nesta sessão: chamadas a `api.vultr.com` e `api.vercel.com` retornam
`403` do proxy de rede desta sessão (política de egress da organização, não
um bug) — por isso os scripts acima precisam rodar de fora daqui. Os arquivos
já estão prontos e commitados neste branch; só faltou a execução, que requer
uma rede sem esse bloqueio.

---

## Sumário

1. [Decisão: servidor novo vs. servidor existente](#1-decisão-servidor-novo-vs-servidor-existente)
2. [Custo](#2-custo)
3. [Provisionar o VPS](#3-provisionar-o-vps-manual)
4. [Instalar o Coolify](#4-instalar-o-coolify-script)
5. [Setup inicial do Coolify](#5-setup-inicial-do-coolify-manual)
6. [Criar o projeto e os recursos](#6-criar-o-projeto-e-os-recursos-manual--ui)
7. [Deploy de teste (sem tocar em produção)](#7-deploy-de-teste)
8. [Cutover (trocar DNS de verdade)](#8-cutover)
9. [Rollback](#9-rollback)
10. [Depois do cutover](#10-depois-do-cutover)

---

## 1. Decisão: servidor novo vs. servidor existente

O servidor Vultr atual (`216.238.114.73`, ver `MIGRACAO_VULTR.md`) já roda em
produção: Evolution API com sessões de WhatsApp conectadas, API, worker,
Redis, nginx com certificado SSL válido via certbot. O Coolify instala o
próprio proxy (Traefik) e **precisa das portas 80/443 livres** — se você
tentar instalar no servidor atual, o `install-coolify.sh` deste diretório
já bloqueia com erro (ver `[0/6]` no script), porque isso derrubaria o nginx
e, com ele, o Evolution/API/dashboard em produção sem necessidade.

**Recomendação: provisionar um Vultr NOVO, dedicado ao Coolify.**

Motivos:
- Zero risco pro que já está no ar — WhatsApp conectado é o ativo mais frágil
  do produto (reconectar = todo cliente escaneia QR de novo).
- Dá pra testar o deploy completo (build, env vars, healthcheck) antes de
  apontar qualquer domínio real pra lá.
- Migração vira "trocar DNS" quando tudo estiver validado, com o servidor
  antigo como rollback instantâneo (igual ao padrão já usado em
  `deploy/evolution-oci/`, que testou host novo antes de migrar de vez).

Alternativa (não recomendada agora): instalar o Coolify no servidor atual e
desabilitar o proxy próprio dele (Settings → Server → Proxy → Stop), mantendo
o nginx atual na frente. Funciona, mas mistura o gerenciamento manual com o
do Coolify e tira a maior vantagem dele (HTTPS/roteamento automáticos). Só
vale a pena depois que o fluxo novo estiver validado e você quiser economizar
o custo do segundo servidor.

## 2. Custo

| Item | Valor |
|---|---|
| Vultr novo (Coolify) — plano recomendado 4GB/2vCPU (`vc2-2c-4gb`, São Paulo) | ~US$ 24/mês |
| Vultr novo — plano mínimo 2GB/1vCPU (`vc2-1c-2gb`) | ~US$ 12/mês |
| Servidor atual (`216.238.114.73`) | mantém o custo atual até o cutover |

Depois do cutover, se decidir desligar o servidor antigo, o custo final da
infra de containers passa a ser só o do servidor do Coolify (pode redimensionar
o plano depois de ver o uso real de RAM/CPU pela UI do Coolify).

Comece pelo plano de 4GB — o Coolify + Traefik + Postgres interno dele já usa
uma fatia da RAM; 2GB fica justo quando os builds da API/Worker rodam.

## 3. Provisionar o VPS **[MANUAL]**

1. [my.vultr.com](https://my.vultr.com) → **Deploy New Server**
2. **Server type:** Cloud Compute — Shared CPU
3. **Location:** São Paulo (mesma região do servidor atual, baixa latência
   pro Supabase/Asaas e pros clientes do Brasil)
4. **Image:** Ubuntu 24.04 LTS (ou 22.04 LTS — ambos suportados)
5. **Plan:** `vc2-2c-4gb` (recomendado) ou `vc2-1c-2gb` (mínimo)
6. **SSH Keys:** adicione sua chave pública (Settings → SSH Keys, se ainda
   não tiver uma cadastrada na conta Vultr)
7. **Hostname:** `zapscript-coolify`
8. Deploy → anote o **IP público** gerado

DNS (no seu provedor de domínio, ex. Registro.br/Cloudflare):
- Crie um registro **A** apontando um subdomínio de teste para o novo IP,
  por exemplo `coolify.zapscript.me` → `NOVO_IP` (TTL baixo, 300s)
- **Não mude ainda** `api.zapscript.me` nem `evo.zapscript.me` — isso só
  acontece no [cutover](#8-cutover), depois de validar tudo.

## 4. Instalar o Coolify **[SCRIPT]**

> Se você já provisionou o servidor com `vultr-provision.sh` (seção
> [Caminho automatizado](#caminho-automatizado-recomendado)), pode pular esta
> seção — o cloud-init já roda este mesmo script sozinho no primeiro boot.
> Use os passos abaixo só se criou o VPS manualmente (seção 3) ou se quiser
> reinstalar/depurar.

```bash
ssh root@NOVO_IP
curl -o install-coolify.sh \
  https://raw.githubusercontent.com/foxtecnologiaonline/zapscript/claude/coolify-vultr-setup-3asyfo/infra/coolify/install-coolify.sh
chmod +x install-coolify.sh
./install-coolify.sh
```

O script (`infra/coolify/install-coolify.sh`, já neste PR/branch):
- Valida que está rodando como root, em Ubuntu/Debian, com RAM ≥ 2GB
- Aborta se as portas 80/443 já estiverem ocupadas (proteção contra rodar
  sem querer no servidor de produção atual)
- Instala UFW (libera 22, 80, 443 e 8000) e fail2ban
- Baixa e roda o instalador oficial (`cdn.coollabs.io/coolify/install.sh`,
  mantido pelo próprio projeto Coolify)
- No final, mostra a URL `http://NOVO_IP:8000` pra você finalizar o setup

## 5. Setup inicial do Coolify **[MANUAL]**

1. Acesse `http://NOVO_IP:8000` e crie o usuário admin (primeiro acesso)
2. Em **Settings → Instance**, configure o domínio da própria dashboard
   (`coolify.zapscript.me`, apontado no passo 3) e ative "Force HTTPS" —
   o Coolify emite o certificado Let's Encrypt automaticamente
3. Em **Servers**, confirme que o "localhost" (o próprio VPS) está com
   status válido (o instalador já cadastra ele)

## 6. Criar o projeto e os recursos **[MANUAL — UI]**

1. **Projects → New Project** → nome `zapscript`
2. Dentro do projeto, **New Resource → Docker Compose**
3. **Source:** conecte o GitHub (`foxtecnologiaonline/zapscript`) via GitHub
   App do Coolify (Coolify pede permissão de leitura no repo — não precisa
   dar permissão de escrita)
   - Branch: `master` (ou a branch de deploy que vocês usarem)
   - Compose file path: `infra/coolify/docker-compose.coolify.yml`
4. **Environment Variables:** cole os pares de `infra/coolify/env.coolify.example`
   preenchidos com os valores reais — pegue os valores atuais do `.env` de
   produção no servidor antigo (`ssh root@216.238.114.73 cat /opt/zapscript/.env`)
   pra reaproveitar os mesmos segredos onde fizer sentido (ex.: `DATABASE_URL`
   do Supabase é o mesmo banco — **cuidado**, ver nota abaixo). Gere segredos
   novos (`REDIS_PASSWORD`, `EVOLUTION_API_KEY`, `JWT_SECRET`, etc.) com
   `openssl rand -hex 32` em vez de reusar os de produção, já que é um
   ambiente de teste nesta fase.
5. **Domínios por serviço:** no card do serviço `api` dentro do resource,
   defina o domínio de teste, ex. `api-coolify.zapscript.me` (crie o registro
   DNS A pra esse subdomínio também, apontando pro `NOVO_IP`). Deixe
   `evolution` **sem domínio público** (ele só precisa ser alcançado pela
   rede interna do Docker pela API).

> **Nota importante — banco de dados compartilhado:** Se você apontar
> `DATABASE_URL` pro MESMO Supabase de produção, o ambiente de teste no
> Coolify vai ler/escrever nos dados reais (clientes, transcrições, cobranças).
> Pra um teste seguro, ou (a) crie um branch/projeto separado no Supabase pro
> teste, ou (b) já assuma que este deploy de teste É o próximo produção e
> trate com o mesmo cuidado do servidor atual (backups, sem rodar migrations
> destrutivas). Evolution/Redis são independentes por servidor, então esses
> dois não têm esse risco.

## 7. Deploy de teste

1. Clique **Deploy** no resource. Acompanhe os logs de build/pull na própria
   UI do Coolify.
2. Depois de "Healthy", teste pelo domínio de teste:
   ```bash
   curl -s https://api-coolify.zapscript.me/health
   ```
   Deve retornar `{"status":"ok",...}` — igual ao passo 5.1 de `MIGRACAO_VULTR.md`.
3. Conecte uma instância de teste do WhatsApp na Evolution nova (não uma de
   cliente real) pra validar que o container sobe e gera QR normalmente.
4. Confirme nos logs do Coolify (aba **Logs** do resource) que worker e API
   não têm erro de conexão com Redis/Supabase.

Só depois disso tudo verde é que faz sentido pensar em cutover.

## 8. Cutover

Só execute isto depois do passo 7 validado e com o usuário/dono do produto
ciente — é o momento que afeta produção de verdade.

1. **[MANUAL]** DNS: troque `api.zapscript.me` e `evo.zapscript.me` (se
   aplicável) pro `NOVO_IP`, com TTL baixo já preparado com antecedência
2. **[MANUAL]** Regenere os segredos reais de produção (`EVOLUTION_API_KEY`,
   `REDIS_PASSWORD`, etc.) no resource do Coolify — ou migre os dados da
   Evolution do servidor antigo (dump do volume `evolution_instances`) se
   quiser preservar as sessões de WhatsApp já conectadas dos clientes, pra
   não forçar todo mundo a reconectar
3. **[MANUAL]** Atualize Vercel (`NEXT_PUBLIC_API_URL`) e Asaas (webhook)
   exatamente como nas seções 6 e 7 de `MIGRACAO_VULTR.md`
4. Acompanhe métricas/logs pela UI do Coolify nas primeiras horas

## 9. Rollback

Enquanto o servidor antigo (`216.238.114.73`) não for desligado, o rollback
é reverter o DNS (`api.zapscript.me`/`evo.zapscript.me`) de volta pro IP
antigo — o `docker compose` de lá continua rodando intacto, sem qualquer
dependência do Coolify.

## 10. Depois do cutover

- Configure **auto-deploy**: no resource do Coolify, ative o webhook de
  deploy automático a cada push na branch de produção — substitui o
  `scripts/build-and-push.sh` + SSH manual por `git push` puro
- Configure **backups** do volume `evolution_instances` pelas Scheduled Tasks
  do Coolify (ou snapshot do disco Vultr)
- Depois de validar por alguns dias, decida se desliga o servidor antigo
  (economiza o custo dele) ou se ele vira um segundo "server" dentro do
  mesmo Coolify (Settings → Servers → New Server, via SSH) pra rodar outros
  serviços — o Coolify suporta gerenciar múltiplos servidores num painel só

## Checklist resumido

- [ ] `./infra/coolify/vultr-provision.sh` (cria o VPS + instala o Coolify sozinho)
- [ ] DNS de teste `coolify.zapscript.me` → IP impresso pelo script **[manual — Vercel]**
- [ ] Criar usuário admin + gerar API token na UI do Coolify **[manual — só existe assim]**
- [ ] Criar projeto `zapscript` + resource Docker Compose apontando pro repo **[manual — UI]**
- [ ] `./infra/coolify/bootstrap-coolify.sh` (sobe todas as env vars + dispara deploy)
- [ ] Domínio de teste no serviço `api` + DNS correspondente **[manual — Vercel]**
- [ ] `curl /health` + teste de conexão WhatsApp
- [ ] Validar com o dono do produto antes do cutover
- [ ] Cutover: DNS real + segredos de produção + Vercel + Asaas
- [ ] Ativar auto-deploy e backups
- [ ] Decidir sobre o servidor antigo (desligar ou reaproveitar)
