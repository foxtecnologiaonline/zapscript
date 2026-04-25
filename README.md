# 🟢 ZapScript

> Transcrição automática de áudios do WhatsApp com IA — 99.8% de precisão em português.

---

## 📁 Estrutura do Projeto

```
zapscript/
├── apps/
│   ├── api/          → Servidor Fastify (autenticação, números, billing)
│   ├── worker/       → Pipeline de transcrição (Whisper + Claude)
│   └── web/          → Frontend Next.js 14
├── packages/
│   └── database/     → Schema Prisma + migrations
└── infra/            → Scripts de deploy e configuração
```

---

## ✅ Pré-requisitos

Instale antes de começar:

```bash
# Node.js v20 LTS
https://nodejs.org

# pnpm
npm install -g pnpm

# ffmpeg (converte OGG → MP3)
# Mac:    brew install ffmpeg
# Ubuntu: sudo apt install ffmpeg

# Stripe CLI (para webhooks locais)
# Mac:    brew install stripe/stripe-cli/stripe
# Outros: https://stripe.com/docs/stripe-cli
```

---

## 🔑 Contas necessárias (todas gratuitas para começar)

| Serviço      | Para quê                        | URL                                |
|--------------|---------------------------------|------------------------------------|
| Supabase     | Banco PostgreSQL                | https://supabase.com               |
| Upstash      | Redis (filas BullMQ)            | https://upstash.com                |
| OpenAI       | Whisper API (transcrição)       | https://platform.openai.com        |
| Anthropic    | Claude API (resumos)            | https://console.anthropic.com      |
| Stripe       | Pagamentos                      | https://stripe.com                 |
| Railway      | Hospedagem API + Worker         | https://railway.app                |
| Vercel       | Hospedagem Frontend             | https://vercel.com                 |

---

## 🚀 Setup Local (passo a passo)

### 1. Clonar e instalar

```bash
git clone https://github.com/seu-usuario/zapscript.git
cd zapscript
pnpm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Abrir .env no editor e preencher TODAS as variáveis
```

Gerar JWT_SECRET e ENCRYPTION_KEY:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Rode duas vezes — uma para JWT_SECRET, outra para ENCRYPTION_KEY
```

### 3. Configurar banco de dados

```bash
# Rodar migrations
cd packages/database
npx prisma migrate dev --name init
npx prisma generate

# Seed dos planos (Free, Starter, Pro)
npx ts-node prisma/seed.ts
cd ../..
```

### 4. Criar produtos no Stripe

```bash
stripe login
chmod +x infra/stripe-setup.sh
./infra/stripe-setup.sh
# Copiar os IDs gerados para o .env
```

### 5. Rodar em desenvolvimento

```bash
# Terminal 1 — API + Worker + Frontend simultâneo
pnpm dev

# Terminal 2 — Stripe webhooks locais
pnpm stripe:listen
```

Acessar:
- **Frontend:** http://localhost:3000
- **API:**      http://localhost:3001/health

### 6. Testar fluxo completo

```
1. Abrir localhost:3000 → Cadastrar conta
2. Ir em Números → Adicionar → Conectar → Escanear QR
3. Enviar áudio para o número no WhatsApp
4. Verificar transcrição no chat e no dashboard
5. Testar pagamento (cartão: 4242 4242 4242 4242)
```

---

## 🌐 Deploy em Produção

### Railway (API + Worker)

```bash
# Instalar Railway CLI
npm install -g @railway/cli
railway login

# Criar projeto e fazer deploy
railway init
railway up

# Configurar variáveis de ambiente no dashboard Railway
# (copiar todas do .env)

# Rodar migration em produção
railway run npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma
```

### Vercel (Frontend)

```bash
npm install -g vercel
cd apps/web
vercel --prod

# Configurar variáveis no Vercel dashboard:
# NEXT_PUBLIC_API_URL=https://seu-projeto.railway.app
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### Domínio

```
1. Registrar zapscript.me em namecheap.com (~R$80/ano)
2. Vercel → Settings → Domains → Add → zapscript.me
3. Seguir instruções de DNS (CNAME record)
```

### Stripe Produção

```
1. Stripe Dashboard → Ativar conta → KYC (CNPJ + documentos)
2. Trocar STRIPE_SECRET_KEY de sk_test_ para sk_live_
3. Criar novo webhook apontando para produção:
   https://zapscript-api.railway.app/billing/webhook
4. Atualizar STRIPE_WEBHOOK_SECRET
```

---

## 🏗️ Stack Completa

| Camada       | Tecnologia                   |
|--------------|------------------------------|
| Frontend     | Next.js 14, Tailwind CSS     |
| API          | Fastify, TypeScript          |
| WebSocket    | Socket.io                    |
| Worker/Filas | BullMQ + Redis (Upstash)     |
| WhatsApp     | Baileys (multi-device)       |
| Transcrição  | OpenAI Whisper v1            |
| Resumos      | Anthropic Claude Sonnet      |
| Banco        | PostgreSQL (Supabase) + Prisma|
| Pagamentos   | Stripe                       |
| Criptografia | AES-256-GCM (sessões WA)     |
| Deploy API   | Railway                      |
| Deploy Web   | Vercel                       |

---

## 💰 Custo Estimado (mensal)

| Serviço         | Custo        |
|-----------------|--------------|
| Railway (API+Worker) | ~$10/mês |
| Supabase        | $0 (free tier)|
| Upstash Redis   | $0–3/mês     |
| OpenAI Whisper  | $0.006/min   |
| Anthropic Claude| ~$2/mês      |
| Vercel          | $0 (hobby)   |
| **Total fixo**  | **~$13–15/mês** |

---

## 📋 Variáveis de Ambiente

Ver `.env.example` para lista completa e comentada.

---

## 🔒 Segurança & LGPD

- Áudios processados em memória e descartados imediatamente após transcrição
- Sessões WhatsApp criptografadas com AES-256-GCM antes de salvar no banco
- Row Level Security (RLS) ativado no Supabase — cada usuário acessa apenas seus dados
- JWT com expiração de 30 dias

---

## 📞 Suporte

- Email: contato@zapscript.me
- WhatsApp: disponível no site
