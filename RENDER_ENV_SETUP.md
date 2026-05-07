# 🚀 Configurar Variáveis de Ambiente no Render

**Problema:** Webhook da Meta não valida porque as variáveis não estão configuradas no Render.

**Solução:** Adicionar as 3 variáveis abaixo no dashboard do Render.

---

## 📋 As 3 Variáveis Necessárias

```
WHATSAPP_WEBHOOK_TOKEN = aa3480e9df795e73d192ebb67b341827
WHATSAPP_API_TOKEN = EAASUKgqB7vMBRYzrhDALpSjnZAjf95TafA8N0BvotZBdfrhICAh0zNb8GBfcZAvlaSSgwaJbXTVYqao5roAbVLZBVCDkz31QhgBkmpwNEuZCMvUSxIabpeucZAHekZCoHps8HXeGpCh76lUOzBiro8YfGuV7VtP2qfDrSVaEpKFi77KMIqy9zF3cbPWcWEpSrkgGZCBsiLUqVmZAsZAavaZAvYcvqHS5vVscmbT2dvApIZBZCT0FklAd9XL5OwGI3nsqJVsmYiZAb43cgNN9hoggp1LBUf1HtmPBlrl1Gn4LSLyAZDZD
WHATSAPP_PHONE_NUMBER_ID = 1081702351699278
```

---

## 🎯 Passo a Passo NO RENDER

### **1️⃣ Abra o Dashboard do Render**

Vá para: https://render.com

### **2️⃣ Clique no Serviço `zapscript`**

(A sua API Node.js/Fastify)

### **3️⃣ Procure por "Environment" ou "Variables"**

No menu lateral, deve ter uma seção tipo:
- **Environment** 
- **Environment Variables**
- **Settings**

### **4️⃣ Adicione as Variáveis**

Procure um botão **"+ Add Environment Variable"** ou **"+ New Variable"**

Para cada uma, faça:

#### **Variável 1: WHATSAPP_WEBHOOK_TOKEN**

```
Key:   WHATSAPP_WEBHOOK_TOKEN
Value: aa3480e9df795e73d192ebb67b341827
```

Clique em **Add** (ou similar)

#### **Variável 2: WHATSAPP_API_TOKEN**

```
Key:   WHATSAPP_API_TOKEN
Value: EAASUKgqB7vMBRYzrhDALpSjnZAjf95TafA8N0BvotZBdfrhICAh0zNb8GBfcZAvlaSSgwaJbXTVYqao5roAbVLZBVCDkz31QhgBkmpwNEuZCMvUSxIabpeucZAHekZCoHps8HXeGpCh76lUOzBiro8YfGuV7VtP2qfDrSVaEpKFi77KMIqy9zF3cbPWcWEpSrkgGZCBsiLUqVmZAsZAavaZAvYcvqHS5vVscmbT2dvApIZBZCT0FklAd9XL5OwGI3nsqJVsmYiZAb43cgNN9hoggp1LBUf1HtmPBlrl1Gn4LSLyAZDZD
```

Clique em **Add**

#### **Variável 3: WHATSAPP_PHONE_NUMBER_ID**

```
Key:   WHATSAPP_PHONE_NUMBER_ID
Value: 1081702351699278
```

Clique em **Add**

### **5️⃣ Deploy**

Procure um botão:
- **"Save"**
- **"Deploy"**
- **"Redeploy"**

Clique nele!

### **6️⃣ Aguarde Deploy**

Você verá:
```
Deploying...
Building...
Live ✅
```

Quando disser **"Live"**, está pronto!

---

## ✅ Verificar se Funcionou

Quando o Render estiver **Live**:

1. Volte à Meta for Developers
2. Em **Webhook**, clique em **"Verificar e salvar"**
3. Deve aparecer: **✅ Webhook verificado com sucesso!**

---

## 🆘 Se Ainda Não Funcionar

### **Debug no Render**

Clique em **Logs** e procure por:

```
[WhatsApp Webhook GET] Validação bem-sucedida
```

Se vir isso ✅, webhook funciona!

Se vir:
```
❌ Token inválido
```

Significa que o token no Render é diferente do que Meta está mandando.

### **Solução: Gerar Novo Token**

Se quiser, execute no terminal:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Copie o token gerado e:
1. Atualize em **Render** → `WHATSAPP_WEBHOOK_TOKEN`
2. Atualize em **Meta** → **Verificar token**
3. Clique em **"Verificar e salvar"**

---

## 📞 Variáveis Resumidas

| Variável | Valor | Origem |
|----------|-------|--------|
| `WHATSAPP_WEBHOOK_TOKEN` | `aa3480e9df795e73d192ebb67b341827` | Você define (Meta mostra) |
| `WHATSAPP_API_TOKEN` | `EAASUKgqB7...` | Meta for Developers |
| `WHATSAPP_PHONE_NUMBER_ID` | `1081702351699278` | Meta for Developers |

---

**Status Final:** Após salvar no Render e redeploy, webhook deve validar! ✅
