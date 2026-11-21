# 🔧 SETUP DE INTEGRAÇÕES — Guia Prático 2026-05-04

**Tempo estimado:** 30-45 minutos  
**Resultado:** Pronto para deploy em staging

---

## 1️⃣ SENTRY (Error Tracking) — 10 minutos

### Passo 1: Criar Conta Sentry

1. Abrir https://sentry.io
2. Clicar "Sign Up" (se não tiver conta)
3. Registrar com email (pode usar ativacao@zapscript.me)
4. Verificar email
5. Fazer login

### Passo 2: Criar Projeto

1. Dashboard → "Create Project"
2. Selecionar "Node.js" como plataforma
3. Nome do projeto: **"ZapScript API"**
4. Team: "Default Team" (ok)
5. Clicar "Create Project"

### Passo 3: Obter DSN

Na página do projeto, você verá:
```
DSN: https://[KEY]@sentry.io/[PROJECT_ID]
```

**Copie esse valor completo** (você vai precisar em 2 passos)

### Passo 4: Configurações do Projeto (opcional mas recomendado)

1. Na página do projeto, ir para "Settings"
2. Environment: "production"
3. Release Tracking: Ativar (automatiza versões)
4. Performance Monitoring: Ativar (0.1 sample rate)

### Passo 5: Salvar em Notas Temporárias

Abra um editor de texto e salve:
```
SENTRY_DSN=https://[sua-key-aqui]@sentry.io/[seu-id]
```

✅ **Sentry pronto!**

---

## 2️⃣ EMAIL PROVIDER — 15 minutos

### Opção A: SendGrid (RECOMENDADO para Produção)

#### Setup SendGrid

1. **Criar Conta**
   - Abrir https://sendgrid.com
   - Clicar "Sign Up Free"
   - Registrar com email pessoal (vai receber verificação)
   - Confirmar email
   - Fazer login

2. **Obter API Key**
   - Menu → "Settings" → "API Keys"
   - Clicar "+ Create API Key"
   - Name: "ZapScript Production"
   - Permissions: "Mail Send" (apenas isso)
   - Clicar "Create & Copy"
   - **Salvar em notas:**
     ```
     SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     ```

3. **Verificar Domínio** (CRÍTICO!)
   - Menu → "Settings" → "Sender Authentication"
   - Clicar "Authenticate Your Domain"
   - Digitar: `zapscript.me`
   - Clicar "Next"
   - Clicar "Skip Advanced Settings"
   - SendGrid vai gerar 3 registros DNS (CNAME)
   - **Copie esses registros**
   - Ir para seu DNS provider (namecheap, Cloudflare, etc)
   - Adicionar os 3 CNAMEs
   - Voltar ao SendGrid e clicar "Verify"
   - ⏳ Pode levar 24h para propagar (continue mesmo se não verificar agora)

4. **Salvar em Notas**
   ```
   SENDGRID_API_KEY=SG.xxx...
   SMTP_FROM=ZapScript <noreply@zapscript.me>
   SUPPORT_EMAIL=suporte@zapscript.me
   EMAIL_PROVIDER=sendgrid
   ```

---

### Opção B: Gmail (se preferir, mais simples mas limitado)

#### Setup Gmail

1. **Ativar 2FA na Conta Gmail**
   - Abrir https://myaccount.google.com/security
   - Procurar "Verificação em 2 etapas"
   - Clicar e seguir instruções
   - Usar seu telefone como segundo fator

2. **Gerar Senha de App**
   - Ir para https://myaccount.google.com/apppasswords
   - Selecionar:
     - App: "Mail"
     - Device: "Windows Computer" (mesmo que não seja Windows)
   - Clicar "Generate"
   - Google vai gerar uma senha de 16 caracteres
   - **Copiar a senha** (ex: `abcd efgh ijkl mnop`)

3. **Salvar em Notas**
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=ativacao@zapscript.me
   SMTP_PASS=abcd efgh ijkl mnop
   SMTP_FROM=ZapScript <ativacao@zapscript.me>
   SUPPORT_EMAIL=suporte@zapscript.me
   EMAIL_PROVIDER=gmail
   ```

**Limitação:** 500 emails/dia (para desenvolvimento está ok)

---

## 3️⃣ ROTEAR SECRETS — 10 minutos

### Gerar Novos Secrets

Abra o terminal e execute:

```bash
cd "C:\FOX tecnologIA\ZapScript"

# Gerar JWT_SECRET (48 caracteres hex)
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"

# Gerar ENCRYPTION_KEY (32 caracteres hex)
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar INTERNAL_TOKEN (32 caracteres hex)
node -e "console.log('INTERNAL_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar MONITOR_TOKEN (32 caracteres hex)
node -e "console.log('MONITOR_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar ADMIN_TOKEN (32 caracteres hex)
node -e "console.log('ADMIN_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
```

### Salvar Todos os Secrets

Abra seu editor de texto e cole tudo o que você copiou:

```
# SENTRY
SENTRY_DSN=https://...@sentry.io/...

# EMAIL (escolha uma opção)
# Opção A: SendGrid
SENDGRID_API_KEY=SG.xxx...
# Opção B: Gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ativacao@zapscript.me
SMTP_PASS=abcd efgh ijkl mnop

# Comum para ambos
SMTP_FROM=ZapScript <noreply@zapscript.me>
SUPPORT_EMAIL=suporte@zapscript.me

# SECRETS GERADOS
JWT_SECRET=xxx...
ENCRYPTION_KEY=xxx...
INTERNAL_TOKEN=xxx...
MONITOR_TOKEN=xxx...
ADMIN_TOKEN=xxx...
```

---

## 4️⃣ CONFIGURAR .env LOCAL — 5 minutos

### Atualizar Arquivo .env

1. Abrir: `C:\FOX tecnologIA\ZapScript\.env`
   (Se não existir, criar: `cp .env.example .env`)

2. Encontrar e atualizar estas variáveis:

```bash
# Sentry
SENTRY_DSN=<COPIAR DE SENTRY>

# Email (SendGrid)
SENDGRID_API_KEY=<COPIAR DE SENDGRID>
SMTP_FROM=ZapScript <noreply@zapscript.me>

# OU Email (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ativacao@zapscript.me
SMTP_PASS=<COPIAR DE GOOGLE>

# Comum
SUPPORT_EMAIL=suporte@zapscript.me

# Secrets
JWT_SECRET=<GERAR NOVO>
ENCRYPTION_KEY=<GERAR NOVO>
INTERNAL_TOKEN=<GERAR NOVO>
MONITOR_TOKEN=<GERAR NOVO>
ADMIN_TOKEN=<GERAR NOVO>

# Asaas (se ainda não tem)
ASAAS_API_KEY=$aact_test_...  # ou $aact_live_... em produção
ASAAS_WEBHOOK_TOKEN=<GERAR NOVO>

# WhatsApp (Meta)
WHATSAPP_API_TOKEN=EAAS...
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_WEBHOOK_TOKEN=<GERAR NOVO>
```

### ✅ Salvar arquivo

Não commitdar esse arquivo (.env já está em .gitignore)

---

## 5️⃣ TESTAR LOCALMENTE — 5 minutos

### Teste 1: Sentry

```bash
cd "C:\FOX tecnologIA\ZapScript"
npm run dev
```

Em outro terminal:
```bash
curl -X GET http://localhost:3001/health
# Deve retornar JSON com status ok
```

Forçar erro:
```bash
curl -X GET http://localhost:3001/invalid-route
# Deve logar no console e enviar para Sentry
```

Verificar em Sentry dashboard → deve aparecer um erro (404)

### Teste 2: Email

```bash
# Testar SMTP connection
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.verify((err, success) => {
  if (err) console.error('ERRO:', err);
  if (success) console.log('✅ SMTP conectado com sucesso!');
});
"
```

Deve retornar: `✅ SMTP conectado com sucesso!`

### Teste 3: Health Check com Sentry

```bash
curl -X GET http://localhost:3001/health
# Deve retornar:
{
  "status": "ok",
  "ts": "2026-05-04T10:30:00Z",
  "app": "ZapScript",
  "env": "development",
  "checks": {
    "redis": "ok",
    "database": "ok"
  }
}
```

---

## 6️⃣ PREPARAR PARA RAILWAY (Staging) — 5 minutos

### Copiar Variáveis de Ambiente

1. Abrir seu arquivo `.env` com os secrets
2. Copiar TODAS as variáveis
3. Ir para Railway:
   - https://railway.app/dashboard
   - Selecionar projeto "ZapScript API"
   - Aba "Variables"
   - Clicar "Add Variable"
   - Adicionar cada uma:
     - SENTRY_DSN
     - SENDGRID_API_KEY
     - SMTP_FROM
     - SUPPORT_EMAIL
     - JWT_SECRET
     - ENCRYPTION_KEY
     - INTERNAL_TOKEN
     - MONITOR_TOKEN
     - ADMIN_TOKEN
     - ASAAS_API_KEY
     - ASAAS_WEBHOOK_TOKEN
     - WHATSAPP_API_TOKEN
     - Etc (copie todas do .env)

### Não esquecer:
- ✅ Não colocar valores entre aspas em Railway
- ✅ Salvar as mudanças
- ✅ Pode levar 1-2 min para Railway redeploy

---

## 7️⃣ VERIFICAR META/WHATSAPP (Status) — 5 minutos

### Verificar Approval Status

1. Abrir https://developers.facebook.com
2. Fazer login com conta Meta/Facebook
3. Ir para seu App
4. Selecionar "WhatsApp"
5. Procurar "App Review" ou "Submission"
6. Verificar status:
   - ✅ **Approved** = Pronto para usar
   - ⏳ **In Review** = Aguarde 5-7 dias
   - ❌ **Rejected** = Revise e reenvie

### Se Still Pending:
```
Nada a fazer — aguarde email de aprovação da Meta
Enquanto isso, tudo funciona em sandbox mode
```

### Se Approved:
```
✅ Você já tem todos os tokens necessários
✅ Tudo configurado em .env
✅ Webhooks já estão prontos
```

---

## ✅ CHECKLIST FINAL

```
SENTRY:
☐ Conta criada
☐ Projeto criado
☐ DSN copiado
☐ Salvo em notas

EMAIL (SendGrid):
☐ Conta criada
☐ API Key gerada
☐ Domínio adicionado no DNS
☐ Salvo em notas

ou EMAIL (Gmail):
☐ 2FA ativado
☐ App password gerado
☐ Salvo em notas

SECRETS:
☐ 5 secrets gerados (JWT, ENCRYPTION, INTERNAL, MONITOR, ADMIN)
☐ Salvos em notas

.env LOCAL:
☐ Arquivo .env atualizado
☐ Todos os secrets adicionados
☐ Arquivo não commitado (já está em .gitignore)

TESTES:
☐ Sentry testado (GET /health)
☐ Email testado (SMTP connection)
☐ Health check OK

RAILWAY:
☐ Variáveis adicionadas em Railway
☐ Deploy completado
☐ Health check em produção OK (/health)

META/WHATSAPP:
☐ Status verificado
☐ Se não aprovado, aguarde
☐ Se aprovado, tudo pronto
```

---

## 🔍 TROUBLESHOOTING

### Sentry não está enviando erros
**Solução:**
```bash
# Verificar SENTRY_DSN em .env
echo $SENTRY_DSN  # Deve mostrar o valor

# Tente fazer um teste manual:
npm run dev
# Em outro terminal, force um erro:
curl -X GET http://localhost:3001/invalid-endpoint
# Deve aparecer no Sentry dashboard em 30 segundos
```

### Email não está sendo enviado
**Solução:**
```bash
# 1. Verificar SMTP_USER e SMTP_PASS estão corretos
# 2. Se SendGrid, verificar se domínio foi verificado
# 3. Se Gmail, verificar se 2FA está ativo e app password é válido
# 4. Testar conexão:
node -e "
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  auth: { user: 'seu@email.com', pass: 'sua-senha' }
});
t.verify((e, ok) => console.log(e || 'OK'));
"
```

### Railway não reconhece variáveis
**Solução:**
```bash
# 1. Recarregue a página do Railway
# 2. Clique "Redeploy" no projeto
# 3. Aguarde 2-3 minutos para o deploy completar
# 4. Verifique com: GET https://seu-railway-app/health
```

### Meta/WhatsApp tokens incorretos
**Solução:**
```bash
# 1. Ir para https://developers.facebook.com
# 2. Seu App → WhatsApp → API Credentials
# 3. Verificar tokens estão corretos:
#    - WHATSAPP_API_TOKEN (começa com EAAS)
#    - WHATSAPP_BUSINESS_ACCOUNT_ID (números)
#    - WHATSAPP_PHONE_NUMBER_ID (números)
# 4. Copiar novamente se necessário
```

---

## 📝 RESUMO RÁPIDO

**5 passos em 30 minutos:**

1. **Sentry** → https://sentry.io (10 min)
   - Criar conta, projeto, copiar DSN

2. **Email** → SendGrid ou Gmail (10 min)
   - API key ou App password

3. **Secrets** → Terminal (5 min)
   - Gerar 5 novos tokens com Node.js

4. **.env** → Texto editor (5 min)
   - Adicionar todas as variáveis

5. **Railway** → Web (5 min)
   - Adicionar variáveis e redeploy

**Total:** 30-45 minutos → **Pronto para staging!**

---

**Próximo passo após isso:** Deployment em Railway + testes

Quer que eu guie o próximo passo também? 🚀
