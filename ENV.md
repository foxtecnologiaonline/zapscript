# Variáveis de Ambiente - ZapScript.me

Guia completo para configurar as variáveis de ambiente necessárias para rodar ZapScript em desenvolvimento, staging e produção.

## Índice
- [Instalação Rápida](#instalação-rápida)
- [Variáveis por Ambiente](#variáveis-por-ambiente)
- [Serviços Externos](#serviços-externos)
- [Tokens Internos](#tokens-internos)
- [Troubleshooting](#troubleshooting)

---

## Instalação Rápida

1. **Copie o arquivo de exemplo:**
   ```bash
   cp .env.example .env
   ```

2. **Gere os tokens internos:**
   ```bash
   node scripts/generate-secrets.js
   ```

3. **Preencha as variáveis de terceiros** (ver seção abaixo)

4. **Teste a conexão:**
   ```bash
   npm run test:env
   ```

---

## Variáveis por Ambiente

### 🔴 CRÍTICAS (Obrigatórias)

#### Database
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/zapscript
# Formato: postgresql://[user]:[password]@[host]:[port]/[database]
# Obtém em: supabase.com → Settings → Database → Connection String
```

#### Cache & Queue
```bash
REDIS_URL=redis://default:password@localhost:6379
# Para Upstash: redis://default:PASSWORD@HOST.upstash.io:6379
# Obtém em: upstash.com → Redis → Connect
```

#### JWT & Encryption
```bash
JWT_SECRET=your-secret-key-here-min-32-chars
# Gerar: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# Comprimento mínimo: 24 caracteres (hex)

ENCRYPTION_KEY=your-encryption-key-here-64-chars-hex
# Gerar: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Comprimento: 64 caracteres (32 bytes em hex)
```

#### Supabase
```bash
SUPABASE_URL=https://your-ref.supabase.co
SUPABASE_ANON_KEY=eyJ0eXAiOiJKV1QiLCJhbGc...
SUPABASE_SERVICE_KEY=eyJ0eXAiOiJKV1QiLCJhbGc...
# Obtém em: supabase.com → Settings → API
```

### 🟢 WhatsApp Cloud API (Meta Official)

```bash
WHATSAPP_API_TOKEN=EAAS...           # Access token da Meta
WHATSAPP_BUSINESS_ACCOUNT_ID=123456  # ID da conta business
WHATSAPP_PHONE_NUMBER_ID=123456      # ID do número WhatsApp
WHATSAPP_WEBHOOK_TOKEN=webhook-xyz   # Token para webhooks (você cria)
```

**Setup:**
1. Vá para https://developers.facebook.com
2. Crie um App → Selecione "Business"
3. Adicione produto: WhatsApp
4. Gere Access Token com scope: `whatsapp_business_messaging`
5. Copie: App ID, App Secret, Access Token
6. Configure webhook em: https://zapscript-api.onrender.com/webhook/whatsapp

**Obs:** Meta cobra por mensagem (~R$ 0,05-0,15 cada). Grátis até 1.000/mês.

---

### 🟡 AI & Integrações

#### OpenAI (Transcription)
```bash
OPENAI_API_KEY=sk-proj-your-key-here
# Obtém em: platform.openai.com → API Keys
# Custo: ~$0.02 por minuto de áudio
```

#### Anthropic (Claude)
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
# Obtém em: console.anthropic.com → API Keys
# Modelo padrão: Claude 3 Sonnet
```

#### Asaas (Pagamentos)
```bash
# SANDBOX (Desenvolvimento)
ASAAS_API_KEY=$aact_test_sandbox_key_here
ASAAS_WEBHOOK_TOKEN=generate-random-token-here

# PRODUÇÃO
ASAAS_API_KEY=$aact_prod_key_here
ASAAS_WEBHOOK_TOKEN=generate-random-token-here

# Obtém em:
# Sandbox: sandbox.asaas.com → Configurações → Integrações
# Produção: app.asaas.com → Configurações → Integrações
```

### 🔐 Tokens Internos

```bash
INTERNAL_TOKEN=random-token-for-worker-api-communication
# Usado em: requests de Worker para API (header X-Internal-Token)
# Gerar: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

MONITOR_TOKEN=random-token-for-monitor-agent
# Usado em: agente de monitoramento (header X-Monitor-Token)
# Gerar: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

ADMIN_TOKEN=random-token-for-admin-operations
# Usado em: operações administrativas
# Gerar: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 📧 Email (SMTP)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@gmail.com
SMTP_PASS=sua-senha-app-google  # Gmail: usar "App Password"
SUPPORT_EMAIL=suporte@zapscript.me

# Alternativas:
# SendGrid: smtp.sendgrid.net (porta 587)
# AWS SES: email-smtp.region.amazonaws.com
# Mailgun: smtp.mailgun.org
```

### 🌐 URLs & Configuração

```bash
NODE_ENV=development  # development | staging | production
PORT=3001

APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SUPABASE_URL=https://your-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ0eXAiOiJKV1QiLCJhbGc...
NEXT_PUBLIC_APP_NAME=ZapScript

# WhatsApp Baileys Configuration (opcional)
WHATSAPP_BROWSER_ID=Chrome  # Browser identifier (Chrome, Firefox, Edge, etc)
# Mude para Firefox ou Edge se houver problemas de conexão com Chrome
```

### 📊 Monitoramento (Opcional)

```bash
SENTRY_DSN=https://your-key@sentry.io/project-id
# Obtém em: sentry.io → Projects → Settings → Client Keys (DSN)

DATADOG_API_KEY=your-api-key
# Obtém em: datadoghq.com → Organization Settings → API Keys

# Monitor URLs
API_HEALTH_URL=https://zapscript-api.railway.app/health
DASHBOARD_URL=https://zapscript.me/dashboard
ALERT_EMAIL=seu@email.com
```

---

## Serviços Externos

### 1️⃣ Supabase (PostgreSQL + Auth)

**Setup:**
1. Acesse [supabase.com](https://supabase.com) e faça login
2. Crie um novo projeto
3. Vá para Settings → Database → Connection String
4. Copie `DATABASE_URL` para seu `.env`
5. Vá para Settings → API
6. Copie `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

**Custos:** Plano gratuito até 500 MB de dados

### 2️⃣ Upstash (Redis Serverless)

**Setup:**
1. Acesse [upstash.com](https://upstash.com) e faça login
2. Crie um novo Redis database
3. Vá para Connect → .env
4. Copie `REDIS_URL` para seu `.env`

**Custos:** 10k comandos/dia gratuitos

### 3️⃣ OpenAI (Whisper)

**Setup:**
1. Acesse [platform.openai.com](https://platform.openai.com) e faça login
2. Vá para API Keys
3. Clique "Create new secret key"
4. Copie para `OPENAI_API_KEY`

**Custos:** ~$0.02 por minuto de áudio transcrito

### 4️⃣ Anthropic (Claude)

**Setup:**
1. Acesse [console.anthropic.com](https://console.anthropic.com) e faça login
2. Vá para API Keys
3. Clique "Create Key"
4. Copie para `ANTHROPIC_API_KEY`

**Custos:** Plano pré-pago (credits)

### 5️⃣ Asaas (Pagamentos)

**Setup Sandbox (teste):**
1. Acesse [sandbox.asaas.com](https://sandbox.asaas.com)
2. Crie uma conta de teste
3. Vá para Configurações → Integrações → API
4. Copie a chave com prefixo `$aact_test_` para `ASAAS_API_KEY`

**Setup Produção:**
1. Acesse [app.asaas.com](https://app.asaas.com)
2. Crie conta com CPF/CNPJ
3. Vá para Configurações → Integrações → API
4. Copie a chave com prefixo `$aact_` para `ASAAS_API_KEY`

**Webhook:**
1. Vá para Configurações → Notificações → Webhooks
2. Adicione URL: `https://seu-dominio.com/billing/webhook`
3. Gere um token aleatório e copie para `ASAAS_WEBHOOK_TOKEN`

**Custos:** Taxa de 2.99% + R$0.59 por transação

---

## Tokens Internos

Estes tokens são usados para comunicação interna entre serviços. **Nunca os exponha publicamente.**

### Gerar todos os tokens:

```bash
node scripts/generate-secrets.js
```

Ou manualmente:

```bash
# JWT Secret (24 bytes em hex = 48 caracteres)
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")

# Encryption Key (32 bytes em hex = 64 caracteres)
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Internal Token (16 bytes em hex = 32 caracteres)
INTERNAL_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

# Monitor Token (16 bytes em hex = 32 caracteres)
MONITOR_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

echo "JWT_SECRET=$JWT_SECRET"
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY"
echo "INTERNAL_TOKEN=$INTERNAL_TOKEN"
echo "MONITOR_TOKEN=$MONITOR_TOKEN"
```

---

## Validation

Valide suas variáveis de ambiente:

```bash
npm run test:env
```

Verifica:
- ✓ Todas as variáveis obrigatórias estão presentes
- ✓ Conectividade com PostgreSQL
- ✓ Conectividade com Redis
- ✓ Chaves da OpenAI/Anthropic
- ✓ Integração com Supabase

---

## Troubleshooting

### "Cannot connect to PostgreSQL"
- Verifique se DATABASE_URL está correto
- Teste: `psql $DATABASE_URL -c "SELECT 1"`
- Checa se o IP está whitelisted no firewall

### "Redis connection timeout"
- Verifique se REDIS_URL está correto
- Teste: `redis-cli -u $REDIS_URL ping`
- Upstash: verifique se a região está correta

### "Invalid API Key for OpenAI"
- Gere uma nova chave em platform.openai.com
- Verifique se não tem espaços extras
- Teste quota: `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`

### "Asaas webhook not working"
- Verifique se o webhook está ativo em app.asaas.com
- Teste com `curl -X POST https://seu-dominio.com/billing/webhook -H "Authorization: Bearer $ASAAS_WEBHOOK_TOKEN"`
- Verifique logs em Configurações → Notificações → Histórico

---

## Ambientes

### Development
```bash
NODE_ENV=development
DATABASE_URL=postgresql://... (local ou Supabase)
ASAAS_API_KEY=$aact_test_... (sandbox)
REDIS_URL=redis://localhost:6379 (local ou Upstash)
```

### Staging
```bash
NODE_ENV=staging
DATABASE_URL=postgresql://... (Supabase staging)
ASAAS_API_KEY=$aact_test_... (sandbox)
REDIS_URL=redis://... (Upstash)
```

### Production
```bash
NODE_ENV=production
DATABASE_URL=postgresql://... (Supabase prod, replicated)
ASAAS_API_KEY=$aact_... (production)
REDIS_URL=redis://... (Upstash prod com backup)
SENTRY_DSN=... (error tracking)
```

---

## Segurança

- 🔒 Nunca commite `.env` em git (use `.env.example`)
- 🔒 Use AWS Secrets Manager em produção
- 🔒 Rotacione tokens a cada 90 dias
- 🔒 Nunca compartilhe tokens por Slack/Email
- 🔒 Use variáveis diferentes para cada ambiente
- 🔒 Adicione `.env*` ao `.gitignore`

---

Última atualização: Abril 2026
