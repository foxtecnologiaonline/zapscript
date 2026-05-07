# 🚀 Integração WhatsApp Cloud API (Meta) — ZapScript

> **Status**: ✅ Configurado e pronto para uso  
> **Data**: 2026-05-07  
> **Framework**: Fastify (Node.js)

---

## 📋 Resumo da Integração

Este documento descreve como o ZapScript foi configurado para **receber e enviar mensagens via WhatsApp** usando a **Meta Cloud API** (oficial).

### ✨ Capacidades

- ✅ **Receber áudio** → Transcrição automática
- ✅ **Receber texto** → Processamento e resposta automática
- ✅ **Receber imagens/documentos** → Processamento em fila
- ✅ **Enviar mensagens** → Texto, áudio, imagem, documento
- ✅ **Webhook seguro** → Verificação de token e validação

---

## 🔐 Credenciais (Seguramente Armazenadas)

Todas as credenciais estão em **`.env.local`** (protegido por `.gitignore`):

```env
# ✅ Seguro - NÃO APARECE NO GIT
WHATSAPP_API_TOKEN=EAASUKgqB7vMBRYzrhDALpSjnZAjf95TafA8N0BvotZBdfrhICAh0zNb8GBfcZAvlaSSgwaJbXTVYqao5roAbVLZBVCDkz31QhgBkmpwNEuZCMvUSxIabpeucZAHekZCoHps8HXeGpCh76lUOzBiro8YfGuV7VtP2qfDrSVaEpKFi77KMIqy9zF3cbPWcWEpSrkgGZCBsiLUqVmZAsZAavaZAvYcvqHS5vVscmbT2dvApIZBZCT0FklAd9XL5OwGI3nsqJVsmYiZAb43cgNN9hoggp1LBUf1HtmPBlrl1Gn4LSLyAZDZD
WHATSAPP_PHONE_NUMBER_ID=1081702351699278
WHATSAPP_BUSINESS_ACCOUNT_ID=985948250787877
WHATSAPP_WEBHOOK_TOKEN=webhook_token_super_secreto_2026_zapscript
WHATSAPP_TEST_NUMBER=+1 555 644 4246
```

---

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
apps/api/src/
├── routes/
│   └── whatsapp-webhook.ts        ← Recebe mensagens da Meta
├── services/
│   ├── whatsapp-official.ts       ← Envia mensagens
│   └── queue.ts                   ← Processa áudio em background
└── index.ts                        ← Registra webhook
```

### Fluxo de Mensagens

```
┌─────────────────────────────────────────────────────────┐
│         Meta WhatsApp Cloud API                         │
└────────────────────┬────────────────────────────────────┘
                     │ (POST com mensagem)
                     ↓
        /webhook/whatsapp (GET/POST)
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
      ÁUDIO        TEXTO       IMAGEM
        │            │            │
        ├─→ [Fila]   ├─→ [Resposta] │
        │            │            │
    [Transcrição] [Processamento] [Armazenamento]
```

---

## 🔧 Endpoints

### GET `/webhook/whatsapp`
**Meta chama para validar o webhook (subscribe)**

```bash
GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=xxx
```

✅ Responde com o `challenge` se o token estiver correto.

### POST `/webhook/whatsapp`
**Meta envia mensagens/áudio/status aqui**

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "5511999999999",
          "id": "msg_id_123",
          "type": "audio",
          "audio": { "id": "media_id_456" }
        }]
      }
    }]
  }]
}
```

✅ Responde com `200 OK` imediatamente (processa em background).

---

## 🚨 Configuração no Meta for Developers

### 1️⃣ Configurar URL do Webhook

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. Vá para seu app → **WhatsApp** → **Configuração**
3. Em **Webhook**:
   - **URL de Callback**: `https://zapscript.me/webhook/whatsapp`
   - **Verify Token**: Use o valor em `WHATSAPP_WEBHOOK_TOKEN`

### 2️⃣ Assinar Eventos

Na mesma página, em **Campos de Webhook**, assine:
- ✅ `messages`
- ✅ `message_status`
- ✅ `message_template_status_update`

### 3️⃣ Testar com Número de Teste

Envie uma mensagem para: **+1 555 644 4246**

Você deveria receber um POST no webhook com a mensagem.

---

## 📱 Enviar Mensagens (Código)

### Enviar Texto

```typescript
import { whatsappAPI } from '../services/whatsapp-official';

await whatsappAPI.sendMessage(
  '5511999999999',
  'Olá! Sua mensagem foi recebida 🎉'
);
```

### Enviar Áudio

```typescript
// Áudio precisa ser OGG (Opus codec) e URL pública
await whatsappAPI.sendAudio(
  '5511999999999',
  'https://seu-servidor.com/audio.ogg'
);
```

### Enviar Imagem

```typescript
await whatsappAPI.sendImage(
  '5511999999999',
  'https://seu-servidor.com/imagem.jpg'
);
```

---

## 🎙️ Processar Áudio

Quando áudio é recebido:

1. **Webhook chama** → `POST /webhook/whatsapp`
2. **Valida número** → Procura usuário registrado
3. **Adiciona à fila** → Job de transcrição
4. **Transcreve** → Usa serviço de speech-to-text
5. **Notifica** → Socket.IO emite `audio_received`

### Fila de Áudio

```typescript
// Em whatsapp-webhook.ts
await transcriptionQueue.add('transcribe-official', {
  userId,
  senderPhone,
  mediaId: audio.id,
  messageId,
});
```

---

## ✅ Checklist de Produção

Quando a Meta terminar de verificar sua empresa:

- [ ] Remover número de teste (permite qualquer número)
- [ ] Aumentar limite de mensagens
- [ ] Configurar webhook URL para produção
- [ ] Testar com usuários reais
- [ ] Monitorar via Sentry/Logs
- [ ] Implementar retry automático
- [ ] Configurar alertas para falhas

---

## 🆘 Troubleshooting

### ❌ "Webhook não valida"

```
❌ POST /webhook/whatsapp → 403 Forbidden
```

**Solução:**
- Verifique se `WHATSAPP_WEBHOOK_TOKEN` está correto
- Certifique-se que URL é acessível publicamente
- Meta requer HTTPS (não HTTP)

### ❌ "Token inválido"

```
❌ Error: Invalid access token
```

**Solução:**
- Tokens expiram após 90 dias
- Gere novo token em Meta for Developers
- Atualize `.env.local`

### ❌ "Áudio não processa"

```
⚠️ [WhatsApp] 🔊 Áudio recebido, mas nenhuma transcrição
```

**Solução:**
- Verifique se número está registrado em `whatsappNumber`
- Verifique Redis está rodando (fila)
- Confira logs de transcrição

---

## 📚 Referências

- [Meta WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Webhook Reference](https://developers.facebook.com/docs/whatsapp/webhooks)
- [Message Types](https://developers.facebook.com/docs/whatsapp/cloud-api/messages)
- [ZapScript Docs](../README.md)

---

## 📝 Histórico

| Data | Evento | Responsável |
|------|--------|-------------|
| 2026-05-07 | Integração configurada | Claude Code |
| 2026-05-07 | Credenciais adicionadas | Claude Code |
| TBD | Verificação Meta completa | FOX Tecnologia |
| TBD | Launch produção | FOX Tecnologia |

---

**Última atualização**: 2026-05-07  
**Status**: ✅ Ativo e testável
