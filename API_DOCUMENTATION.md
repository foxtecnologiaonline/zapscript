# 📚 ZapScript API — Complete Documentation

**Versão:** 1.0.0  
**Data:** 2026-05-04  
**Base URL:** `https://zapscript-api.railway.app`

---

## 🔐 Authentication

### JWT Token Format
```
Header: Authorization: Bearer <jwt_token>
```

### Token Claims
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234567890
}
```

Token lifetime: **30 days**

---

## 📦 API Endpoints

### 1️⃣ AUTH — Authentication

#### `POST /auth/register`
**Public** — Create new account
```json
Request:
{
  "email": "user@example.com",
  "password": "secure-password",
  "name": "John Doe"
}

Response (200):
{
  "id": "uuid",
  "email": "user@example.com",
  "token": "eyJhbGc...",
  "expiresIn": 2592000
}

Errors:
- 400: Invalid email format
- 409: Email already registered
```

#### `POST /auth/login`
**Public** — Sign in
```json
Request:
{
  "email": "user@example.com",
  "password": "password"
}

Response (200):
{
  "id": "uuid",
  "email": "user@example.com",
  "token": "eyJhbGc...",
  "expiresIn": 2592000
}

Errors:
- 400: Invalid credentials
- 401: Email or password incorrect
```

#### `POST /auth/refresh-token`
**Authenticated** — Refresh JWT
```json
Request:
{
  "token": "eyJhbGc..."
}

Response (200):
{
  "token": "eyJhbGc...",
  "expiresIn": 2592000
}

Errors:
- 401: Token invalid or expired
```

---

### 2️⃣ NUMBERS — WhatsApp Numbers Management

#### `GET /numbers`
**Authenticated** — List all connected WhatsApp numbers
```json
Response (200):
[
  {
    "id": "uuid",
    "userId": "uuid",
    "phoneNumber": "+5511999999999",
    "status": "connected",
    "connectedAt": "2026-05-04T10:00:00Z",
    "disconnectedAt": null
  }
]

Headers:
- X-Total-Count: 5
```

#### `POST /numbers`
**Authenticated** — Create new number entry
```json
Request:
{
  "phoneNumber": "+5511999999999"
}

Response (201):
{
  "id": "uuid",
  "phoneNumber": "+5511999999999",
  "status": "pending",
  "createdAt": "2026-05-04T10:00:00Z"
}

Errors:
- 400: Invalid phone number format
- 409: Number already registered
```

#### `DELETE /numbers/:id`
**Authenticated** — Disconnect WhatsApp number
```json
Response (200):
{
  "success": true,
  "message": "Número desconectado"
}

Errors:
- 404: Number not found
- 403: Not authorized
```

---

### 3️⃣ TRANSCRIPTIONS — Audio Transcription

#### `GET /transcriptions`
**Authenticated** — List transcriptions
```json
Query Parameters:
- page: number (default: 1)
- limit: number (default: 20, max: 100)
- numberId: uuid (optional filter)
- status: "completed|processing|failed" (optional)

Response (200):
{
  "items": [
    {
      "id": "uuid",
      "text": "Olá, como você está?",
      "status": "completed",
      "minutesUsed": 0.5,
      "createdAt": "2026-05-04T10:00:00Z",
      "number": {
        "phoneNumber": "+5511999999999"
      }
    }
  ],
  "total": 100,
  "page": 1,
  "pages": 5
}
```

#### `POST /transcriptions`
**Authenticated** — Create new transcription
```json
Request:
{
  "audioBase64": "SUQzBAA...",
  "numberId": "uuid",
  "language": "pt-BR"
}

Response (201):
{
  "id": "uuid",
  "text": "Olá, como você está?",
  "status": "completed",
  "minutesUsed": 1.5,
  "summary": "Saudação de boas-vindas",
  "createdAt": "2026-05-04T10:00:00Z"
}

Errors:
- 400: Invalid audio format
- 402: Insufficient minute balance
- 413: Audio file too large (max 25MB)
```

#### `GET /transcriptions/:id`
**Authenticated** — Get transcription details
```json
Response (200):
{
  "id": "uuid",
  "text": "Olá, como você está?",
  "audioUrl": "https://cdn.zapscript.me/audio-uuid.ogg",
  "status": "completed",
  "minutesUsed": 1.5,
  "summary": "...",
  "createdAt": "2026-05-04T10:00:00Z",
  "number": {
    "id": "uuid",
    "phoneNumber": "+5511999999999"
  }
}
```

---

### 4️⃣ BILLING — Payment & Subscriptions

#### `POST /billing/checkout`
**Authenticated** — Create payment checkout
```json
Request:
{
  "planName": "pro"
}

Response (200):
{
  "invoiceUrl": "https://checkout.asaas.com/...",
  "asaasPaymentId": "pay_123456",
  "amount": 29.90,
  "dueDate": "2026-05-15",
  "minutesGranted": 1000
}

Plans:
- free: R$ 0/mês, 100 min
- pro: R$ 29.90/mês, 1000 min
- ultra: R$ 59.90/mês, 5000 min
```

#### `GET /billing/subscription`
**Authenticated** — Current subscription status
```json
Response (200):
{
  "id": "uuid",
  "plan": {
    "name": "pro",
    "minutesPerMonth": 1000,
    "price": 29.90
  },
  "status": "active",
  "currentPeriodStart": "2026-05-04T00:00:00Z",
  "currentPeriodEnd": "2026-06-04T00:00:00Z",
  "minutesAvailable": 750,
  "minutesUsed": 250,
  "nextBillingDate": "2026-06-04",
  "paymentMethod": "credit_card",
  "lastPaymentStatus": "confirmed"
}
```

#### `POST /billing/cancel`
**Authenticated** — Cancel subscription
```json
Response (200):
{
  "success": true,
  "message": "Assinatura cancelada",
  "effectiveDate": "2026-06-04"
}
```

#### `GET /billing/invoices`
**Authenticated** — List invoices
```json
Response (200):
{
  "items": [
    {
      "id": "uuid",
      "amount": 29.90,
      "status": "paid",
      "dueDate": "2026-05-15",
      "paidAt": "2026-05-10T15:30:00Z",
      "invoiceUrl": "https://asaas.com/invoice/..."
    }
  ],
  "total": 5
}
```

---

### 5️⃣ DASHBOARD — User Dashboard

#### `GET /dashboard/stats`
**Authenticated** — Dashboard statistics
```json
Response (200):
{
  "totalMinutesAvailable": 1000,
  "totalMinutesUsed": 250,
  "minuteBalance": 750,
  "activeNumbers": 2,
  "totalTranscriptions": 48,
  "transcriptionsThisMonth": 12,
  "transcriptionsThisWeek": 3,
  "alertStatus": "ok",
  "lastTranscription": "2026-05-04T10:00:00Z"
}
```

#### `GET /dashboard/usage`
**Authenticated** — Detailed usage chart
```json
Response (200):
{
  "daily": [
    {
      "date": "2026-05-01",
      "minutesUsed": 45,
      "transcriptions": 3
    }
  ],
  "weekly": [...],
  "monthly": [...]
}
```

---

### 6️⃣ PRIVACY — GDPR/LGPD Compliance

#### `GET /privacy/export`
**Authenticated** — Export all user data
```json
Response (200):
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2026-01-01T00:00:00Z"
  },
  "transcriptions": [
    {
      "id": "uuid",
      "text": "...",
      "createdAt": "2026-05-04T10:00:00Z"
    }
  ],
  "numbers": [
    {
      "id": "uuid",
      "phoneNumber": "+5511999999999",
      "connectedAt": "2026-04-01T00:00:00Z"
    }
  ],
  "auditLog": [
    {
      "action": "LOGIN",
      "timestamp": "2026-05-04T09:00:00Z",
      "ipAddress": "192.168.1.1"
    }
  ],
  "exportedAt": "2026-05-04T10:30:00Z"
}
```

#### `DELETE /privacy/delete`
**Authenticated** — Delete all user data (irreversible)
```json
Response (200):
{
  "success": true,
  "message": "Todos os seus dados foram deletados",
  "deletedAt": "2026-05-04T10:30:00Z"
}
```

---

### 7️⃣ WEBHOOKS — External Services

#### `POST /webhook/whatsapp`
**Internal** — Meta Cloud API webhook (inbound messages)
```json
Headers:
- Authorization: Bearer {WHATSAPP_API_TOKEN}

Body (Meta format):
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "5511999999999",
          "text": { "body": "Olá" },
          "media": { ... }
        }]
      }
    }]
  }]
}

Response (200):
{
  "success": true
}
```

#### `POST /billing/webhook`
**Internal** — Asaas payment webhook
```json
Headers:
- asaas-webhook-token: {ASAAS_WEBHOOK_TOKEN}
- x-asaas-signature: HMAC-SHA256

Body:
{
  "event": "PAYMENT_CONFIRMED",
  "payment": {
    "id": "pay_123456",
    "status": "RECEIVED",
    "amount": 29.90,
    "subscription": {
      "externalReference": "user_id|pro"
    }
  }
}

Response (200):
{
  "success": true
}
```

---

### 8️⃣ HEALTH & MONITORING

#### `GET /health`
**Public** — API health status
```json
Response (200):
{
  "status": "ok",
  "ts": "2026-05-04T10:30:00Z",
  "app": "ZapScript",
  "env": "production",
  "checks": {
    "redis": "ok",
    "database": "ok"
  },
  "uptime": 86400
}

Response (503 — degraded):
{
  "status": "degraded",
  "checks": {
    "redis": "error",
    "database": "ok"
  }
}
```

#### `GET /monitor`
**Requires MONITOR_TOKEN** — Detailed monitoring
```json
Response (200):
{
  "uptime": 86400,
  "memory": {
    "heapUsed": "150MB",
    "heapTotal": "200MB"
  },
  "requests": {
    "total": 10000,
    "errors": 15,
    "avgLatency": "45ms"
  }
}
```

---

## ⚡ Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Global (authenticated) | 100 req | 1 minute |
| Login | 5 attempts | 15 minutes |
| Webhooks | 1000 req | 1 minute |

**Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

**Error (429):**
```json
{
  "error": "Too many requests",
  "retryAfter": 60
}
```

---

## 🔴 Error Handling

### Standard Error Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

### Common Errors
| Code | Status | Meaning |
|------|--------|---------|
| INVALID_REQUEST | 400 | Validation failed |
| UNAUTHORIZED | 401 | Token invalid/expired |
| FORBIDDEN | 403 | No permission |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| TOO_MANY_REQUESTS | 429 | Rate limit exceeded |
| INSUFFICIENT_BALANCE | 402 | Not enough minutes |
| INTERNAL_ERROR | 500 | Server error |

---

## 📊 Data Models

### User
```json
{
  "id": "string (uuid)",
  "email": "string",
  "name": "string",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Transcription
```json
{
  "id": "uuid",
  "userId": "uuid",
  "numberId": "uuid",
  "text": "string",
  "summary": "string",
  "status": "completed|processing|failed",
  "language": "pt-BR|en-US",
  "minutesUsed": "number",
  "createdAt": "ISO8601"
}
```

### Plan
```json
{
  "id": "uuid",
  "name": "free|pro|ultra",
  "minutesPerMonth": "number",
  "price": "number",
  "features": ["string"]
}
```

### Subscription
```json
{
  "id": "uuid",
  "userId": "uuid",
  "planId": "uuid",
  "status": "active|past_due|canceled|trial",
  "currentPeriodStart": "ISO8601",
  "currentPeriodEnd": "ISO8601",
  "asaasSubscriptionId": "string"
}
```

---

## 🧪 Testing with cURL

### Register User
```bash
curl -X POST https://zapscript-api.railway.app/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123",
    "name": "Test User"
  }'
```

### Login
```bash
TOKEN=$(curl -s -X POST https://zapscript-api.railway.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123"}' \
  | jq -r '.token')

echo "Token: $TOKEN"
```

### Create Transcription
```bash
curl -X POST https://zapscript-api.railway.app/transcriptions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "audioBase64": "SUQzBAA...",
    "numberId": "550e8400-e29b-41d4-a716-446655440000",
    "language": "pt-BR"
  }'
```

### Get Dashboard Stats
```bash
curl -X GET https://zapscript-api.railway.app/dashboard/stats \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📖 Additional Resources

- **OpenAPI/Swagger:** `/documentation`
- **Health Check:** `/health`
- **GitHub:** https://github.com/foxtecnologiaonline/zapscript
- **Support:** suporte@zapscript.me

---

**Última atualização:** 2026-05-04  
**Mantido por:** ZapScript Team
