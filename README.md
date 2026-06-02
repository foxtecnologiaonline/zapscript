# 🟢 ZapScript

> Transcrição automática de áudios do WhatsApp com IA — 99.8% de precisão em português.

---

## 📁 Estrutura do Projeto

```
zapscript/
├── apps/
│   ├── api/          → Servidor Fastify (autenticação, números, billing, webhooks)
│   ├── worker/       → Pipeline de transcrição (Whisper + Claude)
│   ├── web/          → Frontend Next.js 14
│   └── monitor/      → Health checker + alertas
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

# ffmpeg (converte OGG/M4A/WAV → MP3)
# Mac:    brew install ffmpeg
# Ubuntu: sudo apt install ffmpeg
# Windows: https://ffmpeg.org/download.html
```

---

## 🔑 Contas necessárias

| Serviço      | Para quê                              | URL                                |
|--------------|---------------------------------------|------------------------------------|
| Supabase     | Banco PostgreSQL                      | https://supabase.com               |
| Upstash      | Redis (filas BullMQ)                  | https://upstash.com                |
| OpenAI       | Whisper API (transcrição)             | https://platform.openai.com        |
| Groq         | Whisper turbo (primário, mais rápido) | https://console.groq.com           |
| Anthropic    | Claude API (resumos)                  | https://console.anthropic.com      |
| Asaas        | Pagamentos (PIX + cartão)             | https://asaas.com                  |
| Evolution API| WhatsApp self-hosted                  | https://github.com/EvolutionAPI    |
| Resend       | E-mail transacional                   | https://resend.com                 |
| Railway      | Hospedagem API + Worker               | https://railway.app                |
| Vercel       | Hospedagem Frontend                   | https://vercel.com                 |

---

## 🚀 Setup Local

### 1. Clonar e instalar

```bash
git clone https://github.com/foxtecnologiaonline/zapscript.git
cd zapscript
pnpm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Abrir .env no editor e preencher TODAS as variáveis
```

Gerar secrets:
```bash
node infra/gen-secrets.js
```

### 3. Configurar banco de dados

```bash
cd packages/database
npx prisma migrate dev --name init
npx prisma generate
npx ts-node prisma/seed.ts   # Seed: planos Free, Pro, Executive
cd ../..
```

### 4. Rodar em desenvolvimento

```bash
# API + Worker + Frontend simultâneo
pnpm dev
```

Acessar:
- **Frontend:** http://localhost:3000
- **API:**      http://localhost:3001/health

### 5. Testar fluxo completo

```
1. localhost:3000 → Cadastrar conta
2. Dashboard → Números → Conectar via QR (Evolution API)
3. Enviar áudio para o número no WhatsApp
4. Transcrição aparece no dashboard em ~10s
5. Testar pagamento: dashboard → Plano → Assinar Pro
```

---

## 🌐 Deploy em Produção

### Railway (API + Worker)

```bash
npm install -g @railway/cli
railway login
railway init
railway up

# Configurar variáveis no Railway dashboard
# Rodar migrations em produção:
railway run npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma
```

### Vercel (Frontend)

```bash
npm install -g vercel
cd apps/web
vercel --prod

# Variáveis no Vercel dashboard:
# NEXT_PUBLIC_API_URL=https://zapscript-api.railway.app
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## 🏗️ Stack Completa

| Camada       | Tecnologia                         |
|--------------|------------------------------------|
| Frontend     | Next.js 14, Tailwind CSS           |
| API          | Fastify, TypeScript                |
| WebSocket    | Socket.io + Redis adapter          |
| Worker/Filas | BullMQ + Redis (Upstash)           |
| WhatsApp     | Evolution API (instâncias dedicadas)|
| Transcrição  | Groq whisper-large-v3-turbo (primary) + OpenAI whisper-1 (fallback) |
| Resumos      | Anthropic Claude Haiku (primary) + GPT-4o-mini (fallback) |
| Banco        | PostgreSQL (Supabase) + Prisma     |
| Pagamentos   | Asaas (PIX + cartão)               |
| E-mail       | Resend API                         |
| Criptografia | AES-256-GCM (dados sensíveis)      |
| Error tracking | Sentry                           |
| Deploy API   | Railway                            |
| Deploy Web   | Vercel                             |

---

## 💰 Planos

| Plano     | Preço       | Minutos | Números |
|-----------|-------------|---------|---------|
| Free      | R$0/mês     | 20      | 1       |
| Pro       | R$29,90/mês | 100     | 2       |
| Executive | R$49,90/mês | 300     | 3       |

---

## 🔒 Segurança & LGPD

- Áudios processados em memória e descartados após transcrição
- Textos e telefones criptografados com AES-256-GCM no banco
- Row Level Security (RLS) ativado no Supabase
- JWT com expiração de 30 dias
- HMAC-SHA256 em todos os webhooks (Asaas + Evolution + webhooks personalizados)
- Rate limiting global + proteção contra abusos
- Soft-delete + pseudonymização (direitos LGPD)

---

## 📞 Suporte

- Email: suporte@zapscript.me
- Site: https://zapscript.me
