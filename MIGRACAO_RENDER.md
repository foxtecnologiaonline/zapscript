# GUIA PRÁTICO — Migração Vultr → Render

**Decisão de negócio, não técnica:** isto reverte a migração de 2026-07-21
(ver `MIGRACAO_VULTR.md`), que saiu do Render de propósito pra economizar
~$44/mês. Custo estimado de voltar: **~$28-36/mês em serviços** (`api` +
`worker` + `evolution` + `redis`, plano Starter cada) **+ possível taxa de
workspace** se o plano gratuito de workspace do Render não cobrir domínio
customizado/time — a Render mudou o modelo de preço em 2026-04-23 e não
consegui confirmar o número exato de dentro deste ambiente (acesso a
render.com bloqueado). **O número que importa é o que a tela de "Apply
Blueprint" mostra antes de você confirmar** — pare ali e confira antes de
prosseguir.

**Risco aceito e conhecido:** o Render não tem região no Brasil. O
`zapscript-evolution` (conexão WhatsApp/Baileys) vai rodar com IP de
datacenter nos EUA (região `virginia`), e `deploy/evolution-oci/README.md`
já documentou que isso pode reativar o aviso de fraude/golpe do WhatsApp ao
conectar um número — foi exatamente o problema que a Vultr São Paulo
evitava. Ver seção 5.4 pra como testar isso especificamente, e a nota no
topo do `render.yaml` pra mitigação (mover só o Evolution pra um host BR
depois, sem mexer no resto).

---

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Criar os serviços no Render](#2-criar-os-serviços-no-render)
3. [Preencher os secrets](#3-preencher-os-secrets)
4. [Deploy inicial](#4-deploy-inicial)
5. [Verificação (antes de cortar o tráfego)](#5-verificação)
6. [Cortar o tráfego (DNS)](#6-cortar-o-tráfego-dns)
7. [Descomissionar a Vultr](#7-descomissionar-a-vultr)
8. [Rollback](#8-rollback)

---

## 1. Pré-requisitos

| Item | Onde conseguir |
|---|---|
| Conta no Render com o time/organização certo | [dashboard.render.com](https://dashboard.render.com) — confirmar que é o time do ID `tea-da3pmhou01pc73c5sc0g` mencionado na migração |
| Render GitHub App instalado no repo | Acontece automaticamente no passo 2, via OAuth do dashboard |
| API Key do Render | Account Settings → API Keys → Create API Key |
| Acesso de admin ao repo no GitHub | Pra adicionar o secret `RENDER_API_KEY` |
| `.env` atual da Vultr | `ssh root@216.238.114.73 "cat /opt/zapscript/.env"` — é de onde a maioria dos secrets do passo 3 vem |
| Acesso à Vercel, Asaas, Meta Business Manager | Pra conferir se algo precisa mudar no passo 6 (spoiler: não deveria precisar) |

---

## 2. Criar os serviços no Render

**Só api + worker + redis vêm do Blueprint.** O `zapscript-evolution` é
criado à mão — a combinação imagem-pronta + disco persistente + serviço
privado deu vários erros de schema quando tentada no `render.yaml` (ver
histórico de commits do arquivo), e trocar tentativa-e-erro num ambiente
sem acesso à documentação completa do Render por um formulário guiado do
dashboard resolveu mais rápido. Ver comentário completo no fim do
`render.yaml` — resumo aqui:

### 2.1 Blueprint (api + worker + redis)

Isso **não dá pra fazer só com API key** — a primeira conexão com o GitHub é
um fluxo OAuth que só existe no dashboard.

1. Acesse [dashboard.render.com](https://dashboard.render.com), confirme
   que está no time certo (canto superior esquerdo).
2. **New → Blueprint**.
3. Conecte a conta do GitHub (se ainda não tiver) e selecione
   `foxtecnologiaonline/zapscript`.
4. Branch: `master` (ou a branch desta migração, `claude/zapscript-render-migration-n568q0`,
   se quiser validar antes de ir pro master — dá pra trocar a branch do
   Blueprint depois, em Settings).
5. O Render lê o `render.yaml` da raiz e mostra um preview com os 3
   serviços (`zapscript-api`, `zapscript-worker`, `zapscript-redis`) e o
   **custo estimado**. Confira o custo aqui — é o número real, não a
   estimativa deste doc.
6. **Apply** — os serviços são criados mas ficam travados até os secrets
   obrigatórios (os `sync: false` do render.yaml) serem preenchidos.

### 2.2 Evolution API (manual, fora do Blueprint)

**New → Private Service**:

| Campo | Valor |
|---|---|
| Nome | `zapscript-evolution` (exato — `ops-render.yml` acha o serviço por esse nome) |
| Deploy from | Existing Image |
| Image URL | `atendai/evolution-api:latest` |
| Region | Virginia |
| Plan | Starter (precisa cobrir 1 GB de disco) |
| Disk | name `evolution-instances`, mount path `/evolution/instances`, 1 GB |

Environment desse serviço (preencher depois de criado, em Environment):

```
SERVER_URL=https://api.zapscript.me
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=<mesmo valor de EVOLUTION_API_KEY, ver passo 3>
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
DATABASE_ENABLED=false
REDIS_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
DEL_INSTANCE=false
QRCODE_LIMIT=10
```

Depois de criado, a própria página do serviço no Render mostra o
**endereço interno** dele (formato `http://<host>:<porta>`) — vai precisar
desse valor no passo 3, pro `EVOLUTION_API_URL` de `api` e `worker`.

---

## 3. Preencher os secrets

Dashboard → serviços `zapscript-api`/`zapscript-worker` → **Environment** →
o grupo `zapscript-secrets` aparece uma vez e é compartilhado entre os
dois. Copie os valores direto do `.env` da Vultr (passo 1):

```bash
ssh root@216.238.114.73 "cat /opt/zapscript/.env"
```

Preencha todos os campos marcados `sync: false` no `render.yaml` — a lista
completa (mais de 60 chaves: JWT_SECRET, ENCRYPTION_KEY, SUPABASE_*,
OPENAI_API_KEY, ANTHROPIC_API_KEY, ASAAS_*, EVOLUTION_*, WHATSAPP_*,
META_*, TWILIO_*, ZAPI_*, SMTP_*, etc.) está comentada no próprio
`render.yaml`, agrupada por área. **Não cole nenhum valor real no
`render.yaml`** — o arquivo fica no git, os valores ficam só no dashboard
(ou via API depois).

Três campos merecem atenção especial:

- **`EVOLUTION_API_URL`** (em `api` e `worker`, campo próprio em cada um,
  não vem do grupo): cole o endereço interno que o Render mostrou na
  página do `zapscript-evolution` no passo 2.2.
- **`EVOLUTION_API_KEY`** (no grupo compartilhado) precisa ser o **mesmo
  valor** que você colocou em `AUTHENTICATION_API_KEY` no
  `zapscript-evolution` (passo 2.2) — como o evolution é manual agora, essa
  cópia também é manual, não tem `fromGroup` fazendo isso sozinho.
- **`WHATSAPP_WEBHOOK_TOKEN`** e o token da Meta: **gere valores novos em
  vez de reaproveitar os que estão em `RENDER_ENV_SETUP.md`** — esse
  arquivo tem um `WHATSAPP_API_TOKEN` em texto puro commitado no repo (achado
  à parte desta migração, ver aviso no final deste documento). Reaproveitar
  um token já exposto no histórico do git não é seguro.

Depois de preencher, cada serviço mostra "Deploy pending" — não faça deploy
manual pelo dashboard ainda, o próximo passo cuida disso.

---

## 4. Deploy inicial

Com os secrets preenchidos:

1. No GitHub: **Settings → Secrets and variables → Actions → New repository
   secret** → nome `RENDER_API_KEY`, valor a API key do passo 1.
2. Aba **Actions → "Ops — Render" → Run workflow**:
   - Primeiro rode com `action = status` — deve listar os 3 serviços (pode
     vir vazio/"no deploys yet" na primeira vez, tudo bem, é só pra
     confirmar que o workflow acha os service IDs).
   - Depois `action = deploy` — builda e sobe `evolution` → `api` → `worker`
     nessa ordem, esperando cada um ficar `live` antes do próximo.
3. Acompanhe o log do workflow. Se o parsing de algum passo falhar, o log
   imprime o JSON cru da resposta da Render — é o que precisa pra ajustar o
   `jq` do `ops-render.yml` (ver aviso de confiança no topo daquele
   arquivo: os endpoints de listagem não puderam ser 100% confirmados no
   momento em que foram escritos).

---

## 5. Verificação

**Antes de tocar em qualquer DNS**, valide tudo pela URL pública que o
Render já dá de graça (tipo `https://zapscript-api.onrender.com`) — a Vultr
continua no ar servindo `api.zapscript.me` normalmente enquanto isso.

### 5.1 Health check

```bash
curl -s https://zapscript-api.onrender.com/health | python3 -m json.tool
```

### 5.2 Worker conectado

Dashboard do Render → `zapscript-worker` → Logs — deve mostrar conexão com
Redis e DB sem erro, sem loop de retry.

### 5.3 Evolution alcançável pela API/worker

Não dá pra testar `zapscript-evolution` direto de fora (é `pserv`, privado
de propósito — mesmo comportamento do loopback `127.0.0.1:8080` na Vultr).
Teste indireto: qualquer rota da API que dependa do Evolution (status de
instância, envio de mensagem) via a URL pública de teste.

### 5.4 O teste que mais importa: aviso de fraude do WhatsApp

Conecte um número de teste (não um de cliente) via QR Code usando o
ambiente novo do Render e observe se aparece o aviso de fraude/golpe:

- **Não apareceu** → ótimo, sem ação adicional.
- **Apareceu** → confirma o risco que já era conhecido. Não precisa abortar
  a migração inteira: mova só o `zapscript-evolution` pra um host
  brasileiro (a própria Vultr, dimensionada só pra isso — bem mais barato
  que a stack inteira — ou finalize o piloto em `deploy/evolution-oci/`) e
  aponte `EVOLUTION_API_URL` do `api`/`worker` pra lá. O resto (api, worker,
  redis) continua no Render normalmente.

### 5.5 Dashboard end-to-end

`https://zapscript.me/dashboard` continua apontando pra Vultr até o passo 6
— pra testar o backend novo antes do cutover, aponte um ambiente local ou
de preview do frontend pra `https://zapscript-api.onrender.com` temporariamente
(`NEXT_PUBLIC_API_URL`), sem mexer no `NEXT_PUBLIC_API_URL` de produção na
Vercel ainda.

---

## 6. Cortar o tráfego (DNS)

Diferente da migração pra Vultr (que trocou `NEXT_PUBLIC_API_URL` na
Vercel), aqui dá pra fazer melhor: **manter `api.zapscript.me` como domínio
customizado apontando pro Render**, em vez de trocar a URL em todo lugar
que ela aparece (Vercel, webhook do Asaas, webhook da Meta). Isso reduz o
corte a **uma única mudança de DNS**, sem precisar tocar em Vercel, Asaas
ou Meta Business Manager.

### 6.1 Adicionar o domínio customizado no Render

1. Dashboard → `zapscript-api` → **Settings → Custom Domains → Add Custom
   Domain** → `api.zapscript.me`.
2. O Render mostra o valor exato do CNAME (algo como
   `zapscript-api.onrender.com`) e emite o certificado TLS automaticamente
   depois que o DNS propagar.

### 6.2 Trocar o DNS

No provedor de DNS de `zapscript.me`, troque o registro de `api` (hoje
provavelmente um `A` apontando pra `216.238.114.73`) por um `CNAME`
apontando pro valor que o Render deu no passo 6.1. TTL baixo (300s) antes
da troca, se ainda não estiver baixo.

### 6.3 Confirmar propagação

```bash
dig +short api.zapscript.me
curl -s https://api.zapscript.me/health | python3 -m json.tool
```

Repita por alguns minutos até bater com o IP/CNAME do Render e o healthcheck
responder pela URL final. **Vercel, Asaas e Meta não precisam de nenhuma
mudança** — todos já apontam pra `https://api.zapscript.me`, que agora
resolve pro Render.

### 6.4 Observar de perto

Nas primeiras horas depois do corte: logs da API/worker no Render, fila de
transcrições no dashboard, entrega de webhook do Asaas (Configurações →
Integrações → Webhook → conferir os últimos envios), e mensagens de
WhatsApp entrando/saindo normalmente.

---

## 7. Descomissionar a Vultr

**Só depois de alguns dias estável.** Não desligue no mesmo dia do corte —
o principal motivo de manter a Vultr viva por mais tempo aqui (diferente da
migração anterior) é justamente poder reverter rápido se o aviso de fraude
do WhatsApp (seção 5.4) aparecer só depois, com tráfego real.

1. Confirmar que não sobrou nada apontando pro IP antigo (`dig` de nenhum
   subdomínio deveria mais resolver pra `216.238.114.73`).
2. `ssh root@216.238.114.73` → `docker compose -f docker-compose.zapscript.yml down`.
3. Deletar/liberar o servidor na Vultr quando tiver certeza — ou mantê-lo
   parado (sem custo de tráfego, só o custo fixo do plano) como
   fallback por mais um tempo antes de deletar de vez.

---

## 8. Rollback

Como o corte inteiro foi **um único CNAME** (seção 6), reverter é igual de
simples — desde que a Vultr ainda esteja rodando (por isso a seção 7 pede
pra não descomissionar cedo):

```bash
# No provedor de DNS: troca o CNAME de api.zapscript.me de volta pro
# registro A original, apontando pra 216.238.114.73
```

O Vultr nunca parou de rodar (a menos que já tenha passado pelo passo 7),
então volta a responder assim que o DNS propagar de novo. Nenhuma mudança
na Vercel, Asaas ou Meta é necessária pra reverter — mesma lógica de "só um
ponteiro de DNS" que tornou o corte simples.

Se o problema for só no `zapscript-evolution` (aviso de fraude), não
precisa reverter tudo — ver a mitigação parcial na seção 5.4.

---

## Achado de segurança à parte (não bloqueia esta migração)

`RENDER_ENV_SETUP.md` (doc antigo, de antes da migração pra Vultr) tem um
`WHATSAPP_API_TOKEN` em texto puro commitado no repositório, junto de
`WHATSAPP_WEBHOOK_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID`. Isso é independente
de qual infra está no ar — o token deveria ser rotacionado no Meta Business
Manager e removido do arquivo (ou do histórico do git, se for crítico)
numa tarefa separada. Não foi tocado aqui pra não misturar uma reescrita de
histórico do git com uma migração de infra.

## Resumo do que muda vs. `MIGRACAO_VULTR.md`

| | Vultr (jul/2026) | Render (esta migração) |
|---|---|---|
| API + Worker | 1 servidor, deploy via SSH (`ops.yml`) | 2 serviços gerenciados, deploy via API (`ops-render.yml`) |
| Redis | Container local no mesmo servidor | Key Value gerenciado (`zapscript-redis`), via Blueprint |
| Evolution API | Mesmo servidor, volume Docker local | Serviço privado (`pserv`) com disco persistente — criado à mão no dashboard, fora do Blueprint (seção 2.2) |
| Corte de tráfego | Trocou `NEXT_PUBLIC_API_URL` na Vercel | Domínio customizado — só um CNAME, nada muda em Vercel/Asaas/Meta |
| Custo | ~$33/mês (tudo incluso) | ~$28-36/mês estimado, api+worker+evolution+redis (confirmar na tela de Apply + o formulário manual do evolution) |
| Região BR (evita aviso de fraude no WhatsApp) | Sim (Vultr São Paulo) | **Não** — risco aceito, ver topo deste doc |
