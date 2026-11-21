# ✅ CHECKLIST INTERATIVO — Setup de Integrações

**Tempo Total:** 30-45 minutos  
**Status Atual:** Pronto para começar  
**Progresso:** 0/5 etapas

---

## 📋 ETAPA 1: SENTRY (10 minutos)

```
[ ] Passo 1.1: Abrir https://sentry.io
    └─ Esperado: Página de login/registro

[ ] Passo 1.2: Sign Up (ou Login se já tem conta)
    └─ Email: ativacao@zapscript.me (ou seu email)
    └─ Verificar email

[ ] Passo 1.3: Dashboard → "Create Project"
    └─ Platform: Node.js
    └─ Name: ZapScript API
    └─ Team: Default Team

[ ] Passo 1.4: Copiar DSN
    └─ Formato: https://[KEY]@sentry.io/[PROJECT_ID]
    └─ Cole em notas de texto
    └─ SALVE ISSO! ⬇️
    
    SENTRY_DSN=_______________________________
    
[ ] Passo 1.5: Salvar projeto
    └─ Settings → Environment: production (opcional)
    └─ Ativar Performance Monitoring (opcional)

✅ SENTRY CONCLUÍDO!
```

---

## 📧 ETAPA 2: EMAIL PROVIDER (15 minutos)

### Escolha: SendGrid (Recomendado) ou Gmail

#### 🟢 OPÇÃO A: SendGrid (Produção)

```
[ ] Passo 2A.1: Abrir https://sendgrid.com
    └─ Esperado: Página de login/registro

[ ] Passo 2A.2: Sign Up Free
    └─ Email: seu@email.com (qualquer email)
    └─ Verificar email
    └─ Fazer login

[ ] Passo 2A.3: Obter API Key
    └─ Menu → Settings → API Keys
    └─ "+ Create API Key"
    └─ Name: "ZapScript Production"
    └─ Permissions: ✓ Mail Send (apenas)
    └─ Click "Create & Copy"
    └─ SALVE ISSO! ⬇️
    
    SENDGRID_API_KEY=SG._________________________
    
[ ] Passo 2A.4: Verificar Domínio (IMPORTANTE!)
    └─ Menu → Settings → Sender Authentication
    └─ "Authenticate Your Domain"
    └─ Domain: zapscript.me
    └─ Next → Skip Advanced
    └─ SendGrid gera 3 registros (CNAME)
    └─ Vá para seu DNS (Namecheap/Cloudflare)
    └─ Adicione os 3 registros CNAME
    └─ Volte e clique "Verify"
    └─ ⏳ Pode levar 24h (continue mesmo se não verificar)

✅ SENDGRID CONFIGURADO!
```

#### 🟡 OPÇÃO B: Gmail (Desenvolvimento)

```
[ ] Passo 2B.1: Ativar 2FA no Gmail
    └─ https://myaccount.google.com/security
    └─ "Verificação em 2 etapas"
    └─ Seguir instruções (usar celular)

[ ] Passo 2B.2: Gerar App Password
    └─ https://myaccount.google.com/apppasswords
    └─ App: Mail
    └─ Device: Windows Computer
    └─ "Generate"
    └─ Google mostra: abcd efgh ijkl mnop
    └─ COPIE EXATAMENTE! ⬇️
    
    SMTP_PASS=abcd efgh ijkl mnop
    
✅ GMAIL CONFIGURADO!
```

### Comum para ambos:

```
[ ] Passo 2.C: Salvar em notas
    
    SMTP_FROM=ZapScript <noreply@zapscript.me>
    SUPPORT_EMAIL=suporte@zapscript.me
    
    Escolha uma opção:
    Opção A: SENDGRID_API_KEY=SG.xxx
    Opção B: SMTP_HOST=smtp.gmail.com
            SMTP_PORT=587
            SMTP_USER=ativacao@zapscript.me
            SMTP_PASS=abcd efgh ijkl mnop
```

---

## 🔑 ETAPA 3: ROTEAR SECRETS (10 minutos)

Abra terminal Windows:

```
[ ] Passo 3.1: Abrir Prompt de Comando (cmd.exe)
    └─ Windows → "cmd"
    └─ cd "C:\FOX tecnologIA\ZapScript"

[ ] Passo 3.2: Gerar JWT_SECRET
    └─ Cole no prompt:
    node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
    └─ COPIE a saída (começa com JWT_SECRET=)
    └─ SALVE! ⬇️
    
    JWT_SECRET=_________________________________________
    
[ ] Passo 3.3: Gerar ENCRYPTION_KEY
    └─ Cole no prompt:
    node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
    └─ COPIE e SALVE! ⬇️
    
    ENCRYPTION_KEY=_____________________________________

[ ] Passo 3.4: Gerar INTERNAL_TOKEN
    └─ Cole no prompt:
    node -e "console.log('INTERNAL_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    └─ COPIE e SALVE! ⬇️
    
    INTERNAL_TOKEN=_____________________________________

[ ] Passo 3.5: Gerar MONITOR_TOKEN
    └─ Cole no prompt:
    node -e "console.log('MONITOR_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    └─ COPIE e SALVE! ⬇️
    
    MONITOR_TOKEN=______________________________________

[ ] Passo 3.6: Gerar ADMIN_TOKEN
    └─ Cole no prompt:
    node -e "console.log('ADMIN_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
    └─ COPIE e SALVE! ⬇️
    
    ADMIN_TOKEN=________________________________________

✅ TODOS OS SECRETS GERADOS!
```

---

## 📝 ETAPA 4: ATUALIZAR .env LOCAL (5 minutos)

```
[ ] Passo 4.1: Abrir arquivo .env
    └─ C:\FOX tecnologIA\ZapScript\.env
    └─ Se não existir: copie .env.example para .env

[ ] Passo 4.2: Adicionar SENTRY
    └─ Procure ou adicione:
    SENTRY_DSN=<cole aqui o DSN do Sentry>

[ ] Passo 4.3: Adicionar EMAIL
    └─ Se SendGrid:
    SENDGRID_API_KEY=SG.xxx
    
    └─ Se Gmail:
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=ativacao@zapscript.me
    SMTP_PASS=abcd efgh ijkl mnop

[ ] Passo 4.4: Adicionar comum
    SMTP_FROM=ZapScript <noreply@zapscript.me>
    SUPPORT_EMAIL=suporte@zapscript.me

[ ] Passo 4.5: Adicionar Secrets
    JWT_SECRET=<cole aqui>
    ENCRYPTION_KEY=<cole aqui>
    INTERNAL_TOKEN=<cole aqui>
    MONITOR_TOKEN=<cole aqui>
    ADMIN_TOKEN=<cole aqui>

[ ] Passo 4.6: Salvar arquivo
    └─ Ctrl+S
    └─ NÃO fazer commit (já está em .gitignore)

✅ .env ATUALIZADO!
```

---

## 🧪 ETAPA 5: TESTES RÁPIDOS (5 minutos)

### Teste 1: Sentry

```
[ ] Passo 5.1: Iniciar servidor local
    └─ Terminal (PowerShell):
    cd "C:\FOX tecnologIA\ZapScript"
    npm run dev
    
    └─ Esperado: "🚀 ZapScript API rodando na porta 3001"

[ ] Passo 5.2: Testar Health Check
    └─ Novo terminal:
    curl http://localhost:3001/health
    
    └─ Esperado:
    {
      "status": "ok",
      "checks": {
        "redis": "ok",
        "database": "ok"
      }
    }

[ ] Passo 5.3: Verificar Sentry Dashboard
    └─ Abrir https://sentry.io
    └─ Seu projeto
    └─ Procure por erros (pode levar 30s)
    └─ Se nenhum erro, é normal (tudo OK)

✅ SENTRY TESTADO!
```

### Teste 2: Email

```
[ ] Passo 5.4: Testar SMTP Connection
    └─ Terminal novo:
    cd "C:\FOX tecnologIA\ZapScript"
    
    node -e "
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});
t.verify((e, ok) => {
  if (e) console.error('ERRO:', e.message);
  if (ok) console.log('✅ EMAIL CONECTADO!');
});
"
    
    └─ Esperado: "✅ EMAIL CONECTADO!"
    └─ Se erro: verificar SMTP_USER e SMTP_PASS estão corretos

✅ EMAIL TESTADO!
```

---

## 🚀 ETAPA 6: CONFIGURAR RAILWAY (5 minutos)

```
[ ] Passo 6.1: Abrir Railway
    └─ https://railway.app/dashboard
    └─ Fazer login
    └─ Selecionar projeto "zapscript" (ou similar)

[ ] Passo 6.2: Ir para "Variables"
    └─ Aba "Variables" (não "Secrets")
    └─ Clicar "+ Add Variable"

[ ] Passo 6.3: Adicionar Variáveis (uma por uma)
    └─ Clique "+ Add Variable"
    └─ Key: SENTRY_DSN
    └─ Value: <cole do Sentry>
    └─ Repeat para cada:
       - SENDGRID_API_KEY (ou SMTP_HOST, SMTP_PORT, etc)
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
       - WHATSAPP_BUSINESS_ACCOUNT_ID
       - WHATSAPP_PHONE_NUMBER_ID
       - WHATSAPP_WEBHOOK_TOKEN

[ ] Passo 6.4: Salvar e Deploy
    └─ Clicar "Save" (ou similar)
    └─ Railway vai redeploy automaticamente
    └─ ⏳ Aguarde 2-3 minutos

[ ] Passo 6.5: Verificar Health
    └─ Após deploy:
    curl https://seu-railway-url/health
    
    └─ Esperado: JSON com status ok

✅ RAILWAY CONFIGURADO!
```

---

## 📊 VERIFICAÇÃO FINAL

```
CHECKLIST COMPLETO:

SENTRY:
✅ Conta criada
✅ Projeto criado
✅ DSN configurado

EMAIL:
✅ Provider escolhido (SendGrid ou Gmail)
✅ API key ou app password obtido
✅ SMTP testado localmente

SECRETS:
✅ 5 secrets gerados
✅ .env local atualizado
✅ NÃO commitado

RAILWAY:
✅ Variáveis adicionadas
✅ Deploy completado
✅ Health check OK

META/WHATSAPP:
✅ Status verificado no developers.facebook.com
✅ (Se não aprovado, aguarde email)

🎉 TUDO PRONTO! 🎉
```

---

## 🚨 PRECISA DE AJUDA?

Se algo der erro, verifique:

```
ERRO: SMTP connection failed
└─ Verificar SMTP_USER e SMTP_PASS estão corretos
└─ Se Gmail: verificar 2FA está ativado
└─ Se SendGrid: verificar API key é válido

ERRO: Sentry DSN inválido
└─ Copiar novamente de https://sentry.io
└─ Formato deve ser: https://[KEY]@sentry.io/[ID]

ERRO: Health check 503 (degraded)
└─ Verificar Redis está rodando
└─ Verificar Database está acessível
└─ Rodar: npm run db:migrate:prod

ERRO: Railway deployment falhou
└─ Verificar se variáveis foram salvas corretamente
└─ Não adicionar aspas nas variáveis
└─ Clicar "Redeploy" manualmente
```

---

## ⏱️ TEMPO ESTIMADO

```
1️⃣ Sentry ............. 10 min
2️⃣ Email .............. 15 min
3️⃣ Secrets ............ 10 min
4️⃣ .env ............... 5 min
5️⃣ Testes ............ 5 min
6️⃣ Railway ............ 5 min

TOTAL: 30-50 minutos ✅
```

---

**Próximo passo após completar isso:** Testes em staging + migration

Quer começar agora? 🚀
