# GUIA PRÁTICO — Migração Render → Vultr

**Economia: ~$44/mês** (de $77 para $33)

---

## Sumário

1. [Build das imagens Docker (seu computador)](#1-build-das-imagens-docker)
2. [SSH no Vultr e preparação](#2-ssh-no-vultr)
3. [Deploy do Redis (sem risco)](#3-deploy-do-redis)
4. [Deploy da API + Worker (sem queda)](#4-deploy-da-api--worker)
5. [Verificação (antes de desligar o Render)](#5-verificacao)
6. [Atualizar Vercel](#6-atualizar-vercel)
7. [Atualizar Asaas](#7-atualizar-asaas)
8. [Descomissionar Render + Upstash](#8-descomissionar)
9. [Rollback (se algo der errado)](#9-rollback)

---

## Pré-requisitos

| Item | Onde conseguir |
|---|---|
| Token de acesso ao GitHub Packages | [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token (classic) → marcar `write:packages` e `read:packages` |
| Chave SSH ou senha do Vultr | Seu provedor / e-mail de criação do servidor |
| Acesso ao Render | [dashboard.render.com](https://dashboard.render.com) |
| Acesso ao Vercel | [vercel.com](https://vercel.com) (projeto zapscript) |
| Acesso ao Asaas | [app.asaas.com](https://app.asaas.com) → Configurações → Integrações |

---

## 1. Build das imagens Docker

Execute no seu computador (no diretório do projeto ZapScript).

### 1.1 Login no GitHub Container Registry

```bash
# Cole o token que você gerou no GitHub (sem espaços)
echo "SEU_TOKEN_GITHUB_AQUI" | docker login ghcr.io -u foxtecnologiaonline --password-stdin

# Deve aparecer: "Login Succeeded"
```

### 1.2 Build + Push

```bash
# Na raiz do projeto
bash scripts/build-and-push.sh v1.0.0-migracao
```

**O que acontece:** O script faz build da API e do Worker em Docker, e envia para `ghcr.io/foxtecnologiaonline/zapscript-api` e `zapscript-worker`.

**Tempo estimado:** 2-5 minutos (depende da sua internet).

**Resultado esperado:**
```
✅ API pushed
✅ Worker pushed
✅ Done: v1.0.0-migracao
```

---

## 2. SSH no Vultr

```bash
# Substitua SENHA_OU_CHAVE pela sua credencial
ssh root@216.238.114.73
```

**Apareceu "Permission denied"?** Você precisa configurar uma chave SSH ou usar senha. Opções:
- **Se tem senha:** o ssh pede a senha
- **Se tem chave:** `ssh -i ~/.ssh/sua-chave root@216.238.114.73`

---

## 3. Deploy do Redis (SEM RISCO)

O Redis é um serviço novo que não existia. Adicionar ele **não afeta nada** que já está rodando (Evolution API continua funcionando normalmente).

Execute **já logado no Vultr**:

### 3.1 Backup do arquivo atual

```bash
cp /opt/zapscript/docker-compose.yml /opt/zapscript/docker-compose.yml.bak
```

### 3.2 Baixar o novo docker-compose

```bash
curl -o /opt/zapscript/docker-compose.yml \
  https://raw.githubusercontent.com/foxtecnologiaonline/zapscript/integration/hub-3.0-modules/infra/docker-compose.prod.yml
```

### 3.3 Verificar se baixou certo

```bash
head -5 /opt/zapscript/docker-compose.yml
# Deve aparecer: "version: '3.9'" e comentários sobre ZapScript
```

### 3.4 Adicionar REDIS_PASSWORD e REDIS_URL ao .env

```bash
# Primeiro, ver o que já tem no .env
cat /opt/zapscript/.env | head -20

# Gerar senha e adicionar ao final do .env
echo "" >> /opt/zapscript/.env
echo "# Redis auto-gerenciado (container local)" >> /opt/zapscript/.env
echo "REDIS_PASSWORD=$(openssl rand -hex 32)" >> /opt/zapscript/.env
echo "REDIS_URL=redis://default:$(grep REDIS_PASSWORD /opt/zapscript/.env | tail -1 | cut -d= -f2)@redis:6379" >> /opt/zapscript/.env
```

**Verificar se ficou certo:**

```bash
grep REDIS /opt/zapscript/.env
```

Deveria aparecer algo como:
```
REDIS_PASSWORD=a1b2c3d4e5f6...
REDIS_URL=redis://default:a1b2c3d4e5f6...@redis:6379
```

### 3.5 Subir o Redis

```bash
docker compose -f /opt/zapscript/docker-compose.yml up -d redis
```

**Verificar:**

```bash
docker compose -f /opt/zapscript/docker-compose.yml logs redis
```

Deveria mostrar: `Ready to accept connections` e `Running mode=standalone`

**Verificar se está saudável:**

```bash
docker compose -f /opt/zapscript/docker-compose.yml ps redis
# Status deve ser "Up" e "(healthy)"
```

:white_check_mark: **Neste ponto o Redis está rodando. A Evolution API continua funcionando normalmente (não foi reiniciada).**

---

## 4. Deploy da API + Worker (SEM QUEDA)

### 4.1 Puxar as imagens novas do ghcr.io

```bash
docker compose -f /opt/zapscript/docker-compose.yml pull api worker
```

Se aparecer erro de permissão, precisa logar no ghcr.io dentro do Vultr:

```bash
echo "SEU_TOKEN_GITHUB_AQUI" | docker login ghcr.io -u foxtecnologiaonline --password-stdin
docker compose -f /opt/zapscript/docker-compose.yml pull api worker
```

### 4.2 Subir a API

```bash
docker compose -f /opt/zapscript/docker-compose.yml up -d api
```

**Explicação:** A API vai subir no mesmo servidor. Como o Nginx já faz proxy de `api.zapscript.me` → `127.0.0.1:3001`, e a API nova vai ocupar a porta 3001, o tráfego começa a ser servido pela API nova automaticamente. O Render ainda está no ar, mas ninguém acessa ele mais (a Vercel aponta para `api.zapscript.me`).

### 4.3 Verificar a API

```bash
# Aguardar uns segundos e testar
sleep 5
curl -s http://127.0.0.1:3001/health | python3 -m json.tool
```

Deveria mostrar:
```json
{
    "status": "ok",
    "ts": "2026-07-21T..."
}
```

Se aparecer `curl: (7) Connection refused` — aguarde mais 10s e tente de novo:

```bash
sleep 10
curl -s http://127.0.0.1:3001/health | python3 -m json.tool
```

### 4.4 Verificar logs da API

```bash
docker compose -f /opt/zapscript/docker-compose.yml logs api --tail 30
```

Deveria mostrar: `ZapScript API rodando na porta 3001` e linhas sobre conexão com Redis, DB, etc.

### 4.5 Subir o Worker

```bash
docker compose -f /opt/zapscript/docker-compose.yml up -d worker
```

O worker depende da API (configurado no compose como `depends_on: api: service_healthy`), então ele só vai iniciar depois que a API estiver saudável.

### 4.6 Verificar o Worker

```bash
docker compose -f /opt/zapscript/docker-compose.yml logs worker --tail 20
```

Deveria mostrar o worker rodando, sem erros de conexão com Redis ou DB.

### 4.7 Verificar TUDO

```bash
docker compose -f /opt/zapscript/docker-compose.yml ps
```

Deveria mostrar todos os 4 serviços com status `Up`:
```
zapscript-api        Up (healthy)
zapscript-worker     Up
zapscript-redis      Up (healthy)
evolution-api        Up
```

---

## 5. Verificação

### 5.1 Health check público

```bash
curl -s https://api.zapscript.me/health | python3 -m json.tool
```

Deve mostrar `"status": "ok"`. Se funcionou, a API está no ar pública e respondendo.

### 5.2 Testar da sua máquina (não no Vultr)

Abra no navegador: [https://api.zapscript.me/health](https://api.zapscript.me/health)

### 5.3 Testar o Socket.IO no dashboard

1. Acesse [https://zapscript.me/dashboard](https://zapscript.me/dashboard)
2. Faça login
3. Verifique se o dashboard carrega normalmente (tabela de transcrições, etc.)

### 5.4 Testar uma transcrição

- Envie um áudio no WhatsApp conectado ao ZapScript
- Verifique se aparece no dashboard

### 5.5 Verificar se o webhook Evolution está funcionando

- A Evolution API envia webhooks para `https://api.zapscript.me/webhook/evolution`
- Espere 1-2 minutos e verifique se conexões WhatsApp continuam ativas

### 5.6 Limpar cache local

```bash
# No Vultr — reinicia serviços caso algum Redis cache velho atrapalhe
docker compose -f /opt/zapscript/docker-compose.yml restart api worker
```

---

## 6. Atualizar Vercel

A Vercel (frontend) ainda aponta para a URL antiga do Render. Precisa atualizar.

### 6.1 Pelo site da Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Selecione o projeto **zapscript**
3. **Settings → Environment Variables**
4. Localize `NEXT_PUBLIC_API_URL`
5. **Mude o valor para:** `https://api.zapscript.me`
6. Salve

### 6.2 Redeploy

1. Vá em **Deployments**
2. Clique nos 3 pontos do último deploy
3. **Redeploy** (ou faça um push no master do GitHub)

### 6.3 Verificar frontend

Acesse [https://zapscript.me](https://zapscript.me) — tudo deve funcionar igual.

---

## 7. Atualizar Asaas

Os webhooks de cobrança (notificações de pagamento PIX/cartão) precisam apontar para a nova URL.

1. Acesse [app.asaas.com](https://app.asaas.com)
2. **Configurações → Integrações → Webhook**
3. Localize a URL do webhook
4. **Mude de:** `https://zapscript-api.onrender.com/billing/webhook`
5. **Para:** `https://api.zapscript.me/billing/webhook`
6. Salve

### Testar

No Asaas, use o botão "Enviar teste" (se disponível) para verificar se o webhook responde 200.

---

## 8. Descomissionar

### 8.1 Desativar Render (só depois de confirmar que está tudo OK)

1. Acesse [dashboard.render.com](https://dashboard.render.com)
2. **Serviços:**
   - `zapscript-api` → **Actions → Delete Service**
   - `zapscript-worker` → **Actions → Delete Service**
   - `zapscript-web` → **Actions → Delete Service** (ou manter se quiser)
3. **Plano Pro:** Settings → **Cancel subscription** (separation o plano Pro pelo anti-sleep, já não precisa mais)

### 8.2 Deletar Upstash

1. Acesse [upstash.com](https://upstash.com)
2. Selecione o Redis do ZapScript
3. **Settings → Delete**

---

## 9. Rollback

Se algo der errado, **volta tudo ao normal instananeamente**:

### Se a API nova falhar

```bash
# No Vultr — parar os containers novos
docker compose -f /opt/zapscript/docker-compose.yml stop api worker

# Restaurar o compose antigo
cp /opt/zapscript/docker-compose.yml.bak /opt/zapscript/docker-compose.yml

# Re-iniciar Evolution (pode ser que ele tenha parado)
docker compose -f /opt/zapscript/docker-compose.yml up -d evolution

# O Render ainda está no ar — ninguém percebeu nada
```

### Se o frontend quebrar

- **Vercel:** reverter `NEXT_PUBLIC_API_URL` para `https://zapscript-api.onrender.com`
- Redeploy

---

## Resumo financeiro

| Serviço | Antes | Depois | Economia |
|---|---|---|---|
| Render API Starter | $4,72 | **$0** | +$4,72 |
| Render Worker Starter | $4,72 | **$0** | +$4,72 |
| Render Pro (anti-sleep) | $25,00 | **$0** | +$25,00 |
| Upstash Redis | $10,00 | **$0** | +$10,00 |
| Vultr (Evolution + API + Worker + Redis) | $33,00 | **$33,00** (mesmo valor) | — |
| Supabase (DB) | $0 | $0 | — |
| Vercel (frontend) | $0 | $0 | — |
| **Total** | **~$77** | **~$33** | **~$44/mês** |

## Checklist resumido

- [ ] `bash scripts/build-and-push.sh v1.0.0-migracao` (buildar imagens)
- [ ] SSH no Vultr (`ssh root@216.238.114.73`)
- [ ] `cp /opt/zapscript/docker-compose.yml /opt/zapscript/docker-compose.yml.bak`
- [ ] Baixar compose novo + adicionar REDIS_PASSWORD ao .env
- [ ] `docker compose up -d redis` + verificar
- [ ] `docker compose pull api worker`
- [ ] `docker compose up -d api` + verificar `/health`
- [ ] `docker compose up -d worker` + verificar logs
- [ ] Testar dashboard + transcrição + webhooks
- [ ] Vercel: atualizar `NEXT_PUBLIC_API_URL`
- [ ] Asaas: atualizar webhook URL
- [ ] **Só depois:** deletar Render + Upstash
