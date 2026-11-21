# 🔧 SETUP DE INTEGRAÇÕES — Render + Zoho Mail

**Configuração Real:** Render API + Zoho Mail  
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

**Copie esse valor completo**

### Passo 4: Salvar em Notas

```
SENTRY_DSN=https://[sua-key-aqui]@sentry.io/[seu-id]
```

✅ **Sentry pronto!**

---

## 2️⃣ ZOHO MAIL (Email Transacional) — 15 minutos

### Passo 1: Acessar Zoho Mail

1. Abrir https://mail.zoho.com
2. Fazer login com sua conta Zoho (se não tiver, criar em https://www.zoho.com)
3. Ir para ativacao@zapscript.me (ou seu email configurado)

### Passo 2: Obter Credenciais SMTP

**Opção A: Via Dashboard Zoho**

1. Zoho Mail → Seu email
2. Settings (⚙️ canto superior direito)
3. Procurar: "SMTP" ou "Mail Settings"
4. Ativar: "IMAP/POP/SMTP Access"
5. Gerar uma "Senha de App" (se pedido)

**Opção B: Usar Senhas Padrão**

Zoho usa:
```
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465 (SSL) ou 587 (TLS)
SMTP_USER=ativacao@zapscript.me (seu email)
SMTP_PASS=sua-senha-zoho (ou senha de app se gerou)
SMTP_SECURE=true (para porta 465)
```

### Passo 3: Verificar Acesso SMTP

Se não conseguir, dentro do Zoho:

1. Mail → Settings
2. Procurar "SMTP Access" ou "Account Access"
3. Ativar: "Allow SMTP/IMAP/POP Access"
4. Pode precisar gerar "Application Password"

### Passo 4: Salvar em Notas

```
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_USER=ativacao@zapscript.me
SMTP_PASS=<sua-senha-zoho>
SMTP_SECURE=true
SMTP_FROM=ZapScript <ativacao@zapscript.me>
SUPPORT_EMAIL=suporte@zapscript.me
```

✅ **Zoho Mail pronto!**

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

# ASAAS_WEBHOOK_TOKEN (novo)
node -e "console.log('ASAAS_WEBHOOK_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"

# WHATSAPP_WEBHOOK_TOKEN (novo)
node -e "console.log('WHATSAPP_WEBHOOK_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
```

### Salvar Todos os Secrets

Abra seu editor de texto e cole tudo:

```
# SENTRY
SENTRY_DSN=https://...@sentry.io/...

# ZOHO MAIL
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_USER=ativacao@zapscript.me
SMTP_PASS=sua-senha-zoho
SMTP_SECURE=true
SMTP_FROM=ZapScript <ativacao@zapscript.me>
SUPPORT_EMAIL=suporte@zapscript.me

# SECRETS GERADOS
JWT_SECRET=xxx...
ENCRYPTION_KEY=xxx...
INTERNAL_TOKEN=xxx...
MONITOR_TOKEN=xxx...
ADMIN_TOKEN=xxx...
ASAAS_WEBHOOK_TOKEN=xxx...
WHATSAPP_WEBHOOK_TOKEN=xxx...
```

---

## 4️⃣ CONFIGURAR .env LOCAL — 5 minutos

### Atualizar Arquivo .env

1. Abrir: `C:\FOX tecnologIA\ZapScript\.env`
   (Se não existir, criar: `cp .env.example .env`)

2. Encontrar e atualizar:

```bash
# Sentry
SENTRY_DSN=<COPIAR DE SENTRY>

# Zoho Mail
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_USER=ativacao@zapscript.me
SMTP_PASS=<sua-senha-zoho>
SMTP_SECURE=true
SMTP_FROM=ZapScript <ativacao@zapscript.me>
SUPPORT_EMAIL=suporte@zapscript.me

# Secrets
JWT_SECRET=<GERAR NOVO>
ENCRYPTION_KEY=<GERAR NOVO>
INTERNAL_TOKEN=<GERAR NOVO>
MONITOR_TOKEN=<GERAR NOVO>
ADMIN_TOKEN=<GERAR NOVO>
ASAAS_WEBHOOK_TOKEN=<GERAR NOVO>
WHATSAPP_WEBHOOK_TOKEN=<GERAR NOVO>

# Asaas (se ainda não tem)
ASAAS_API_KEY=$aact_test_...  # ou $aact_live_... em produção

# WhatsApp (Meta)
WHATSAPP_API_TOKEN=EAAS...
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789
WHATSAPP_PHONE_NUMBER_ID=123456789
```

### ✅ Salvar arquivo

Não committar esse arquivo (.env já está em .gitignore)

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

### Teste 2: Email (Zoho)

```bash
# Testar SMTP connection
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: 'ativacao@zapscript.me',
    pass: process.env.SMTP_PASS
  }
});

transporter.verify((err, success) => {
  if (err) console.error('ERRO:', err.message);
  if (success) console.log('✅ ZOHO MAIL CONECTADO!');
});
"
```

Deve retornar: `✅ ZOHO MAIL CONECTADO!`

---

## 6️⃣ CONFIGURAR RENDER — 5 minutos

### Passo 1: Acessar Render

1. Abrir https://render.com/dashboard
2. Fazer login
3. Selecionar seu "Web Service" (a API)

### Passo 2: Adicionar Variáveis de Ambiente

1. Na página do serviço → "Environment"
2. Clicar "Add Environment Variable"
3. Adicionar cada variável:

```
Key: SENTRY_DSN
Value: <seu-dsn>

Key: SMTP_HOST
Value: smtp.zoho.com

Key: SMTP_PORT
Value: 465

Key: SMTP_USER
Value: ativacao@zapscript.me

Key: SMTP_PASS
Value: <sua-senha-zoho>

Key: SMTP_SECURE
Value: true

Key: SMTP_FROM
Value: ZapScript <ativacao@zapscript.me>

Key: SUPPORT_EMAIL
Value: suporte@zapscript.me

Key: JWT_SECRET
Value: <seu-secret>

Key: ENCRYPTION_KEY
Value: <seu-secret>

Key: INTERNAL_TOKEN
Value: <seu-secret>

Key: MONITOR_TOKEN
Value: <seu-secret>

Key: ADMIN_TOKEN
Value: <seu-secret>

Key: ASAAS_WEBHOOK_TOKEN
Value: <seu-token>

Key: WHATSAPP_WEBHOOK_TOKEN
Value: <seu-token>

(+ ASAAS_API_KEY, WHATSAPP_API_TOKEN, etc)
```

### Passo 3: Deploy

1. Clicar "Save Changes" ou "Deploy"
2. Render vai redeploy automaticamente
3. ⏳ Aguarde 2-3 minutos

### Passo 4: Verificar Health

Após deploy:
```bash
curl https://seu-render-app-url.onrender.com/health

# Deve retornar:
{
  "status": "ok",
  "checks": {
    "redis": "ok",
    "database": "ok"
  }
}
```

✅ **Render configurado!**

---

## 7️⃣ VERIFICAR META/WHATSAPP — 5 minutos

1. Abrir https://developers.facebook.com
2. Seu App → WhatsApp
3. Procurar "App Review" ou "Submission"
4. Verificar status:
   - ✅ **Approved** = Pronto para usar
   - ⏳ **In Review** = Aguarde 5-7 dias
   - ❌ **Rejected** = Revise e reenvie

---

## ✅ CHECKLIST FINAL

```
SENTRY:
☐ Conta criada
☐ Projeto criado
☐ DSN copiado
☐ Salvo em notas

ZOHO MAIL:
☐ Acesso verificado
☐ SMTP ativado
☐ Credenciais obtidas
☐ Salvo em notas

SECRETS:
☐ 7 secrets gerados
☐ Salvos em notas

.env LOCAL:
☐ Arquivo .env atualizado
☐ Todos os secrets adicionados
☐ Arquivo não commitado

TESTES:
☐ Sentry testado (GET /health)
☐ Zoho Mail testado (SMTP connection)
☐ Health check OK

RENDER:
☐ Variáveis adicionadas em Render
☐ Deploy completado
☐ Health check em produção OK

META/WHATSAPP:
☐ Status verificado
```

---

## 🔍 TROUBLESHOOTING

### Zoho Mail: Conexão recusada
**Solução:**
```bash
# 1. Verificar credenciais estão corretas
# 2. Ativar "IMAP/POP/SMTP Access" em Zoho
# 3. Se usar 2FA, gerar "Application Password"
# 4. Tentar porta 587 em vez de 465 (sem SMTP_SECURE)
```

### Render: Variáveis não aparecem
**Solução:**
```bash
# 1. Recarregar a página
# 2. Clicar "Save Changes"
# 3. Render vai redeploy automaticamente
# 4. Aguardar 2-3 minutos
# 5. Verificar /health depois
```

### Sentry: Não está recebendo erros
**Solução:**
```bash
# 1. Verificar SENTRY_DSN em .env
# 2. Restartar servidor (npm run dev)
# 3. Forçar um erro: curl http://localhost:3001/invalid
# 4. Esperar 30 segundos
# 5. Verificar dashboard Sentry
```

---

## 📝 RESUMO RÁPIDO (30 minutos)

| Etapa | Tempo | O Quê |
|-------|-------|-------|
| 1. Sentry | 10 min | Sign up → Project → DSN |
| 2. Zoho | 10 min | Settings → SMTP → Credenciais |
| 3. Secrets | 5 min | node -e crypto → 7 tokens |
| 4. .env | 5 min | Colar valores no arquivo |
| 5. Render | 5 min | Environment → Add variables |

**Total: 35 minutos → Pronto para staging!**

---

## 🎯 Próximos Passos

Após completar:

1. **Testes locais** (5 min)
   ```bash
   npm run dev
   curl http://localhost:3001/health
   ```

2. **Testes em Render** (5 min)
   ```bash
   curl https://seu-render-app/health
   ```

3. **Rodar migrations** (2 min)
   ```bash
   npm run db:migrate:prod
   ```

4. **Deploy em Produção** (quando pronto)

---

**Próximo:** Checklist de verificação rápida + testes

Quer o checklist também? 🚀
