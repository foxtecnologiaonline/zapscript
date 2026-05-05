# 📧 Email Transacional — Setup Guide

## Visão Geral
Emails transacionais são enviados automaticamente em eventos como:
- Confirmação de email
- Reset de senha
- Notificações de pagamento
- Alertas de limite de minutos

---

## 🔧 Opção 1: Gmail (Recomendado para Desenvolvimento)

### Setup

1. **Habilitar 2FA na conta Gmail**
   - Ir para https://myaccount.google.com/security
   - Ativar "Verificação em 2 etapas"

2. **Gerar App Password**
   - Ir para https://myaccount.google.com/apppasswords
   - Selecionar: App = "Mail" | Device = "Windows Computer"
   - Google gerará uma senha de 16 caracteres

3. **Adicionar ao `.env`**
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=ativacao@zapscript.me
   SMTP_PASS=<16-char app password>
   SMTP_FROM=ZapScript <ativacao@zapscript.me>
   SUPPORT_EMAIL=suporte@zapscript.me
   ```

4. **Testar Conexão**
   ```bash
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
     console.log(err ? 'Erro: ' + err : 'SMTP OK ✓');
   });
   "
   ```

### Limitações
- Máximo 500 emails/dia (free tier)
- Bom para desenvolvimento e pequenos volumes

---

## 🔧 Opção 2: SendGrid (Recomendado para Produção)

### Setup

1. **Criar Conta**
   - Ir para https://sendgrid.com
   - Registrar e verificar email

2. **Obter API Key**
   - Ir para "Settings → API Keys"
   - Criar nova API Key com permissão "Mail Send"

3. **Verificar Sender Domain** (importante!)
   - "Settings → Sender Authentication → Domain Authentication"
   - Adicionar domínio: `zapscript.me`
   - Seguir instruções de DNS (CNAME records)
   - Pode levar 24h para propagar

4. **Adicionar ao `.env`**
   ```
   SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SMTP_FROM=ZapScript <noreply@zapscript.me>
   SUPPORT_EMAIL=suporte@zapscript.me
   ```

5. **Usar via NodeMailer ou Direct API**
   ```typescript
   // Via Nodemailer + SendGrid
   import nodemailer from 'nodemailer';
   import sgTransport from 'nodemailer-sendgrid-transport';

   const transporter = nodemailer.createTransport(
     sgTransport({
       auth: {
         api_key: process.env.SENDGRID_API_KEY,
       },
     })
   );

   await transporter.sendMail({
     from: 'noreply@zapscript.me',
     to: user.email,
     subject: 'Confirmação de Email',
     html: '<h1>Bem-vindo!</h1>',
   });
   ```

### Vantagens
- 100 emails/dia grátis
- Excelente deliverability
- Webhooks para status de entrega
- $9.95/mês para volumes maiores

---

## 🔧 Opção 3: Resend (Alternativa Moderna)

### Setup

1. **Criar Conta**
   - Ir para https://resend.com
   - Registrar

2. **Obter API Key**
   - Dashboard → API Keys
   - Copiar chave

3. **Configurar Domínio**
   - Adicionar `noreply@zapscript.me`
   - Seguir verificação DKIM/SPF

4. **Usar SDK**
   ```typescript
   import { Resend } from 'resend';

   const resend = new Resend(process.env.RESEND_API_KEY);

   await resend.emails.send({
     from: 'noreply@zapscript.me',
     to: user.email,
     subject: 'Confirmação de Email',
     html: '<h1>Bem-vindo!</h1>',
   });
   ```

---

## 📧 Implementar Email Service

### Arquivo: `apps/api/src/services/email.ts`

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string
) {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'ZapScript <noreply@zapscript.me>',
      to,
      subject,
      text: text || html.replace(/<[^>]*>/g, ''),
      html,
    });

    console.log('Email enviado:', info.messageId);
    return info;
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    throw error;
  }
}
```

---

## 📮 Templates de Email

### 1. Confirmação de Email
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .btn { background: #007bff; color: white; padding: 10px 20px; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bem-vindo ao ZapScript! 👋</h1>
    <p>Obrigado por se registrar. Clique no botão abaixo para confirmar seu email:</p>
    <a href="https://zapscript.me/verify?token={{TOKEN}}" class="btn">
      Confirmar Email
    </a>
    <p>Ou copie este link:</p>
    <p>{{VERIFICATION_URL}}</p>
    <hr>
    <p style="color: #666; font-size: 12px;">
      Não solicitou este email? Ignore esta mensagem.
    </p>
  </div>
</body>
</html>
```

### 2. Reset de Senha
```html
<!DOCTYPE html>
<html>
<body>
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>Resetar Senha</h1>
    <p>Recebemos um pedido para resetar sua senha. Clique no botão abaixo:</p>
    <a href="https://zapscript.me/reset-password?token={{RESET_TOKEN}}"
       style="background: #007bff; color: white; padding: 10px 20px; 
              border-radius: 5px; text-decoration: none; display: inline-block;">
      Resetar Senha
    </a>
    <p>Link expira em 1 hora.</p>
    <p style="color: #999; font-size: 12px;">
      Não solicitou isso? Ignore este email. Sua senha está segura.
    </p>
  </div>
</body>
</html>
```

### 3. Notificação de Pagamento
```html
<!DOCTYPE html>
<html>
<body>
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>Pagamento Confirmado ✓</h1>
    <p>Seu pagamento foi processado com sucesso!</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr style="background: #f5f5f5;">
        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Plano</strong></td>
        <td style="padding: 10px; border: 1px solid #ddd;">{{PLAN_NAME}}</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Valor</strong></td>
        <td style="padding: 10px; border: 1px solid #ddd;">R$ {{AMOUNT}}</td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Minutos</strong></td>
        <td style="padding: 10px; border: 1px solid #ddd;">{{MINUTES}} min/mês</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Período</strong></td>
        <td style="padding: 10px; border: 1px solid #ddd;">{{PERIOD_START}} até {{PERIOD_END}}</td>
      </tr>
    </table>
    <p><a href="https://zapscript.me/dashboard">Ver minha assinatura</a></p>
  </div>
</body>
</html>
```

### 4. Alerta de Minutos Acabando
```html
<!DOCTYPE html>
<html>
<body>
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>⚠️ Seus minutos estão acabando</h1>
    <p>Você usou {{USED}}% dos seus {{TOTAL}} minutos mensais.</p>
    <p>Saldo restante: {{REMAINING}} minutos</p>
    <a href="https://zapscript.me/upgrade" 
       style="background: #ff9800; color: white; padding: 10px 20px; 
              border-radius: 5px; text-decoration: none; display: inline-block;">
      Fazer Upgrade
    </a>
    <p style="color: #999; font-size: 12px;">
      Sem ação, seu acesso será limitado quando os minutos terminarem.
    </p>
  </div>
</body>
</html>
```

---

## 🧪 Testes

### Enviar email de teste
```bash
curl -X POST http://localhost:3001/support/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "seu@email.com"}'
```

### Verificar logs
```bash
# Railway
railway logs --follow

# Local
npm run dev  # Veja os logs no terminal
```

---

## ✅ Checklist

- [ ] Escolher provider (Gmail, SendGrid, Resend)
- [ ] Configurar API keys em `.env`
- [ ] Instalar dependências: `npm install nodemailer`
- [ ] Implementar `services/email.ts`
- [ ] Criar templates de email
- [ ] Integrar em rotas de auth (register, forgot-password)
- [ ] Testar envio de email
- [ ] Configurar em Railway/Vercel via variáveis de ambiente
- [ ] Verificar deliverability (SPF, DKIM, DMARC)

---

## 📊 Recomendação Final

**Para Desenvolvimento:** Gmail (gratuito, fácil)  
**Para Produção:** SendGrid (confiável, escalável)  
**Para Volume Alto:** AWS SES (mais barato, requer configuração)

---

**Última atualização:** 2026-05-04
