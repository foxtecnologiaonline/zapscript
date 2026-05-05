# ✅ CHECKLIST — Render + Zoho Mail Setup

**Configuração Atual:**
- API: Render
- Email: Zoho Mail
- Banco: Supabase (presumido)
- Cache: Upstash (presumido)

**Tempo Total:** 30-45 minutos  
**Status:** Pronto para começar

---

## 📋 ETAPA 1: SENTRY (10 minutos)

```
[ ] 1.1: Abrir https://sentry.io
    └─ Esperado: Página de login/signup

[ ] 1.2: Sign Up (ou fazer login)
    └─ Email: ativacao@zapscript.me (ou seu)
    └─ Verificar email

[ ] 1.3: Create Project
    └─ Platform: Node.js
    └─ Name: ZapScript API
    └─ Team: Default Team

[ ] 1.4: Copiar DSN
    └─ Formato: https://[KEY]@sentry.io/[PROJECT_ID]
    
    SENTRY_DSN=_______________________________

[ ] 1.5: Salvar projeto
    └─ Settings (opcional)
    └─ Environment: production

✅ SENTRY CONCLUÍDO!
```

---

## 📧 ETAPA 2: ZOHO MAIL (15 minutos)

```
[ ] 2.1: Abrir https://mail.zoho.com
    └─ Fazer login (ou criar conta em zoho.com)
    └─ Acessar ativacao@zapscript.me (ou seu email)

[ ] 2.2: Verificar SMTP Access
    └─ Settings (⚙️)
    └─ Procurar "IMAP/POP/SMTP Access"
    └─ Ativar: ✓ Allow IMAP/POP/SMTP

[ ] 2.3: Se pedir, gerar Application Password
    └─ Settings → Security → Application Passwords
    └─ App: "Mail"
    └─ Gerar senha de 16 caracteres
    └─ SALVE ISSO! ⬇️
    
    SMTP_PASS=abcd efgh ijkl mnop

[ ] 2.4: Notar as credenciais padrão Zoho
    
    SMTP_HOST=smtp.zoho.com
    SMTP_PORT=465 (com SECURE=true) ou 587 (sem)
    SMTP_USER=ativacao@zapscript.me
    SMTP_PASS=<sua-senha-ou-app-password>
    SMTP_SECURE=true (para porta 465)
    SMTP_FROM=ZapScript <ativacao@zapscript.me>
    SUPPORT_EMAIL=suporte@zapscript.me

✅ ZOHO MAIL CONFIGURADO!
```

---

## 🔑 ETAPA 3: ROTEAR SECRETS (10 minutos)

Abra Prompt de Comando Windows:

```
[ ] 3.1: Abrir cmd.exe
    └─ Windows → "cmd"
    └─ cd "C:\FOX tecnologIA\ZapScript"

[ ] 3.2: Gerar JWT_SECRET
    └─ Cole:
    node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
    
    JWT_SECRET=_________________________________________

[ ] 3.3: Gerar ENCRYPTION_KEY
    └─ Cole:
    node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
    
    ENCRYPTION_KEY=_____________________________________

[ ] 3.4: Gerar INTERNAL_TOKEN
    └─ Cole:
    node -e "console.log('INTERNAL_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    
    INTERNAL_TOKEN=_____________________________________

[ ] 3.5: Gerar MONITOR_TOKEN
    └─ Cole:
    node -e "console.log('MONITOR_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    
    MONITOR_TOKEN=______________________________________

[ ] 3.6: Gerar ADMIN_TOKEN
    └─ Cole:
    node -e "console.log('ADMIN_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    
    ADMIN_TOKEN=________________________________________

[ ] 3.7: Gerar ASAAS_WEBHOOK_TOKEN
    └─ Cole:
    node -e "console.log('ASAAS_WEBHOOK_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    
    ASAAS_WEBHOOK_TOKEN=________________________________

[ ] 3.8: Gerar WHATSAPP_WEBHOOK_TOKEN
    └─ Cole:
    node -e "console.log('WHATSAPP_WEBHOOK_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    
    WHATSAPP_WEBHOOK_TOKEN=_____________________________

✅ TODOS OS 7 SECRETS GERADOS!
```

---

## 📝 ETAPA 4: ATUALIZAR .env LOCAL (5 minutos)

```
[ ] 4.1: Abrir arquivo .env
    └─ C:\FOX tecnologIA\ZapScript\.env
    └─ Se não existir: copie .env.example → .env

[ ] 4.2: Adicionar SENTRY
    SENTRY_DSN=<cole aqui o DSN>

[ ] 4.3: Adicionar ZOHO MAIL
    SMTP_HOST=smtp.zoho.com
    SMTP_PORT=465
    SMTP_USER=ativacao@zapscript.me
    SMTP_PASS=<sua-senha-zoho>
    SMTP_SECURE=true

[ ] 4.4: Adicionar comum
    SMTP_FROM=ZapScript <ativacao@zapscript.me>
    SUPPORT_EMAIL=suporte@zapscript.me

[ ] 4.5: Adicionar Secrets
    JWT_SECRET=<cole aqui>
    ENCRYPTION_KEY=<cole aqui>
    INTERNAL_TOKEN=<cole aqui>
    MONITOR_TOKEN=<cole aqui>
    ADMIN_TOKEN=<cole aqui>
    ASAAS_WEBHOOK_TOKEN=<cole aqui>
    WHATSAPP_WEBHOOK_TOKEN=<cole aqui>

[ ] 4.6: Verificar variáveis existentes
    └─ Manter:
    DATABASE_URL=<seu-supabase>
    REDIS_URL=<seu-upstash>
    WHATSAPP_API_TOKEN=<seu-meta>
    WHATSAPP_BUSINESS_ACCOUNT_ID=<seu-meta>
    WHATSAPP_PHONE_NUMBER_ID=<seu-meta>
    ASAAS_API_KEY=<seu-asaas>
    APP_URL=<seu-zapscript>
    (e outras variáveis do .env.example)

[ ] 4.7: Salvar arquivo
    └─ Ctrl+S
    └─ NÃO fazer commit (.env em .gitignore)

✅ .env ATUALIZADO!
```

---

## 🧪 ETAPA 5: TESTES RÁPIDOS (5 minutos)

### Teste 1: Sentry

```
[ ] 5.1: Iniciar servidor local
    └─ Terminal PowerShell:
    cd "C:\FOX tecnologIA\ZapScript"
    npm run dev
    
    └─ Esperado: "🚀 ZapScript API rodando na porta 3001"

[ ] 5.2: Testar Health Check
    └─ Terminal novo:
    curl http://localhost:3001/health
    
    └─ Esperado:
    {
      "status": "ok",
      "checks": {
        "redis": "ok",
        "database": "ok"
      }
    }

✅ SENTRY TESTADO!
```

### Teste 2: Zoho Mail

```
[ ] 5.3: Testar SMTP Zoho
    └─ Terminal novo:
    cd "C:\FOX tecnologIA\ZapScript"
    
    node -e "
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: 'ativacao@zapscript.me',
    pass: process.env.SMTP_PASS
  }
});
t.verify((e, ok) => {
  if (e) console.error('ERRO:', e.message);
  if (ok) console.log('✅ ZOHO CONECTADO!');
});
"
    
    └─ Esperado: "✅ ZOHO CONECTADO!"
    └─ Se erro: verificar SMTP_PASS está correto

✅ ZOHO TESTADO!
```

---

## 🚀 ETAPA 6: CONFIGURAR RENDER (5 minutos)

```
[ ] 6.1: Abrir Render Dashboard
    └─ https://render.com/dashboard
    └─ Fazer login
    └─ Selecionar seu Web Service (API)

[ ] 6.2: Ir para "Environment"
    └─ Aba "Environment" (não "Settings")
    └─ Clicar "+ Add Environment Variable"

[ ] 6.3: Adicionar Variáveis (uma por uma)
    
    [ ] SENTRY_DSN = <seu-sentry>
    [ ] SMTP_HOST = smtp.zoho.com
    [ ] SMTP_PORT = 465
    [ ] SMTP_USER = ativacao@zapscript.me
    [ ] SMTP_PASS = <sua-senha-zoho>
    [ ] SMTP_SECURE = true
    [ ] SMTP_FROM = ZapScript <ativacao@zapscript.me>
    [ ] SUPPORT_EMAIL = suporte@zapscript.me
    [ ] JWT_SECRET = <seu-secret>
    [ ] ENCRYPTION_KEY = <seu-secret>
    [ ] INTERNAL_TOKEN = <seu-secret>
    [ ] MONITOR_TOKEN = <seu-secret>
    [ ] ADMIN_TOKEN = <seu-secret>
    [ ] ASAAS_WEBHOOK_TOKEN = <seu-token>
    [ ] WHATSAPP_WEBHOOK_TOKEN = <seu-token>
    [ ] (Manter as demais variáveis: DATABASE_URL, REDIS_URL, etc)

    └─ IMPORTANTE: NÃO adicionar aspas nos valores!

[ ] 6.4: Salvar Changes
    └─ Clicar "Save Changes" ou equivalente
    └─ Render vai redeploy automaticamente
    └─ ⏳ Aguarde 2-3 minutos (pode verMais tempo na primeira vez)

[ ] 6.5: Verificar Health
    └─ Após deploy:
    curl https://seu-render-url.onrender.com/health
    
    └─ Esperado:
    {
      "status": "ok",
      "checks": {
        "redis": "ok",
        "database": "ok"
      }
    }

✅ RENDER CONFIGURADO!
```

---

## 📊 VERIFICAÇÃO FINAL

```
CHECKLIST COMPLETO:

SENTRY:
☐ Conta criada
☐ Projeto criado
☐ DSN configurado

ZOHO MAIL:
☐ SMTP ativado
☐ Credenciais obtidas
☐ SMTP_SECURE=true (ou false se port 587)

SECRETS:
☐ 7 secrets gerados
☐ .env local atualizado
☐ NÃO commitado

RENDER:
☐ Variáveis adicionadas
☐ Deploy completado (2-3 min)
☐ Health check OK

META/WHATSAPP:
☐ Status verificado em developers.facebook.com
☐ (Se não aprovado, aguarde email)

🎉 TUDO PRONTO! 🎉
```

---

## 🚨 PRECISA DE AJUDA?

### Erro: Zoho SMTP refused connection
```
[ ] Verificar se SMTP_USER está correto
[ ] Ativar "IMAP/POP/SMTP Access" em Zoho
[ ] Se tiver 2FA, usar "Application Password" (não senha normal)
[ ] Tentar porta 587 (sem SMTP_SECURE=true)
[ ] Se erro persista, gerar nova Application Password
```

### Erro: Render deployment failed
```
[ ] Recarregar página
[ ] Clicar "Save Changes" novamente
[ ] Verificar se não há espaços em branco nos valores
[ ] Aguardar 3-5 minutos no primeiro deploy
```

### Erro: Health check 503 (degraded)
```
[ ] Verificar Redis está rodando (Upstash)
[ ] Verificar Database está acessível (Supabase)
[ ] Rodar migrations: npm run db:migrate:prod
```

---

## ⏱️ TEMPO POR ETAPA

```
1️⃣ Sentry .............. 10 min
2️⃣ Zoho Mail ........... 10 min
3️⃣ Secrets ............ 5 min
4️⃣ .env ............... 5 min
5️⃣ Testes ............ 5 min
6️⃣ Render ............ 5 min

TOTAL: 40 minutos ✅
```

---

## 🎯 Próximos Passos

Após completar tudo:

```
[ ] 1. Verificar health check em Render
[ ] 2. Rodar migrations: npm run db:migrate:prod
[ ] 3. Testar email: curl -X POST /support/test-email
[ ] 4. Verificar Sentry: forçar um erro e ver no dashboard
[ ] 5. Deploy para produção (quando tudo OK)
```

---

**Tudo pronto?** 🚀  

Comece pelo **SETUP_INTEGRACIONES_RENDER_ZOHO.md** — tem instruções super detalhadas!

Quer que eu guie o resto depois? 👍
