# 🚀 LISTA DE LANÇAMENTO — ZapScript.me
**Data:** 2026-05-04  
**Status:** 🟡 Parcialmente pronto  
**Repositório:** https://github.com/foxtecnologiaonline/zapscript.git

---

## 📋 CHECKLIST EXECUTIVO

### ✅ JÁ PRONTO (Não fazer nada)
- [x] Domínio: zapscript.me (SSL ativo)
- [x] API: Railway (deploy pronto)
- [x] Worker: Railway (BullMQ pronto)
- [x] Frontend: Vercel (Next.js pronto)
- [x] Database: Supabase (Prisma migrations prontas)
- [x] Cache: Upstash Redis (BullMQ integrado)
- [x] Transcrição: OpenAI Whisper (integrado)
- [x] Resumos: Anthropic Claude (integrado)
- [x] Pagamentos: Asaas (webhooks prontos)
- [x] CNPJ FOX: Criado

---

## 🔴 BLOQUEADORES CRÍTICOS (Fazer HOJE)

### 1️⃣ .env EXPOSTO NO GIT — RISCO LGPD/SEGURANÇA
**Prioridade:** 🔴 CRÍTICO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER AGORA

#### ✅ O que fazer:
```bash
# 1. Verificar credenciais expostas
cd "C:\FOX tecnologIA\ZapScript"
git log --all --source --pretty=format:"%h %s" | grep -i env

# 2. Remover .env do git
git rm --cached .env

# 3. Verificar que foi removido do histórico
git log --follow -- .env  # Deve estar vazio agora

# 4. Commit
git commit -m "security: remove .env with exposed credentials"

# 5. ROTEAR IMEDIATAMENTE todos os secrets:
#    - DATABASE_URL (Supabase)
#    - SUPABASE_SERVICE_KEY
#    - REDIS_URL (Upstash)
#    - OPENAI_API_KEY
#    - ANTHROPIC_API_KEY
#    - WHATSAPP_API_TOKEN
#    - ASAAS_API_KEY
#    - JWT_SECRET
#    - ENCRYPTION_KEY

# 6. Criar novo .env.production.example (sem valores)
# 7. Push
git push origin master
```

**Checklist:**
- [ ] .env removido do git
- [ ] Todos os secrets rodados em Supabase, OpenAI, Anthropic, Upstash, Meta, Asaas
- [ ] Novos secrets salvo em .env local (não commitado)
- [ ] Commit + push feito

---

### 2️⃣ REMOVER CÓDIGO BAILEYS LEGADO
**Prioridade:** 🔴 CRÍTICO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER AGORA

#### Arquivos a deletar/editar:
```bash
# 1. Listar referências a Baileys
grep -r "baileys\|Baileys" apps/ --include="*.ts" --include="*.json"

# 2. Deletar arquivo inteiro (não mais usado)
rm apps/api/src/services/whatsapp.ts

# 3. Editar apps/worker/src/index.ts
#    REMOVER linha 5: import { downloadMediaMessage } from '@whiskeysockets/baileys';
#    MANTER: import { downloadAudioFromMeta } from './services/whatsapp-official';

# 4. Verificar se há mais referências
grep -r "baileys" apps/ --include="*.ts"

# 5. Remover do package.json (se estiver lá)
npm uninstall @whiskeysockets/baileys

# 6. Commit
git add -A
git commit -m "refactor: remove legacy Baileys code (migrated to Meta API)"
git push origin master
```

**Checklist:**
- [ ] `whatsapp.ts` deletado
- [ ] imports de Baileys removidos de `worker/src/index.ts`
- [ ] `@whiskeysockets/baileys` removido de package.json
- [ ] Sem mais referências a Baileys no código
- [ ] Commit + push feito

---

### 3️⃣ ADICIONAR SECURITY HEADERS (Helmet)
**Prioridade:** 🔴 CRÍTICO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER AGORA

#### Arquivo: `apps/api/src/index.ts`

```typescript
// No início, após imports:
import helmet from '@fastify/helmet';

// Registrar Helmet (após app.register para plugins essenciais):
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});
```

#### Instalar:
```bash
cd apps/api
npm install @fastify/helmet
```

**Checklist:**
- [ ] `@fastify/helmet` instalado
- [ ] Helmet registrado em index.ts
- [ ] Testar localmente: `curl -I http://localhost:3001/health` (deve ter headers X-Content-Type-Options, etc)
- [ ] Commit + push feito

---

### 4️⃣ VALIDAÇÃO DE WEBHOOK ASAAS
**Prioridade:** 🔴 CRÍTICO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER AGORA

#### Arquivo: `apps/api/src/routes/billing.ts`

Adicionar validação de signature HMAC-SHA256:

```typescript
import crypto from 'crypto';

function verifyAsaasSignature(body: string, signature: string | undefined): boolean {
  if (!signature || !process.env.ASAAS_WEBHOOK_TOKEN) {
    return false;
  }
  const hash = crypto
    .createHmac('sha256', process.env.ASAAS_WEBHOOK_TOKEN)
    .update(body)
    .digest('hex');
  return hash === signature;
}

// Na rota POST /billing/webhook:
app.post('/billing/webhook', async (req, reply) => {
  const signature = req.headers['x-asaas-signature'] as string;
  
  // Validar assinatura
  if (!verifyAsaasSignature(req.rawBody || JSON.stringify(req.body), signature)) {
    app.log.warn('[Asaas] Webhook com signature inválida rejeitado');
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  // ... rest do código
});
```

**Checklist:**
- [ ] Função `verifyAsaasSignature` adicionada
- [ ] Validação feita antes de processar webhook
- [ ] Teste: enviar webhook falso (deve rejeitar com 401)
- [ ] Commit + push feito

---

### 5️⃣ INTEGRAR SENTRY PARA ERROR TRACKING
**Prioridade:** 🔴 CRÍTICO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER AGORA

#### Instalar:
```bash
cd apps/api
npm install @sentry/node @sentry/tracing
```

#### Arquivo: `apps/api/src/index.ts` (no topo)

```typescript
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';

// Inicializar Sentry (ANTES de criar app Fastify)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Tracing.Integrations.CacheIntegration(),
    ],
  });
}

// Hook global para erros não-capturados
process.on('unhandledRejection', (reason, promise) => {
  app.log.error({ reason, promise }, 'Unhandled Rejection');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason);
  }
});

process.on('uncaughtException', (error) => {
  app.log.error(error, 'Uncaught Exception');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
  }
  process.exit(1);
});
```

#### Adicionar ao .env.example:
```
SENTRY_DSN=https://your-key@sentry.io/project-id
```

#### Obter DSN:
1. Ir para https://sentry.io (criar conta free)
2. Criar novo projeto (Node.js)
3. Copiar DSN
4. Salvar em .env local (não commitado)

**Checklist:**
- [ ] `@sentry/node` instalado
- [ ] Sentry inicializado em index.ts
- [ ] SENTRY_DSN em .env.example
- [ ] Teste: lançar um erro intencional, verificar em Sentry dashboard
- [ ] Commit + push feito

---

## 🟡 ALTO IMPACTO (Fazer esta semana)

### 6️⃣ ATIVAR TYPESCRIPT STRICT MODE
**Prioridade:** 🟡 ALTO  
**Tempo:** 2-3 horas  
**Status:** ❌ FAZER

#### Arquivo: `tsconfig.json` (raiz)

```json
{
  "compilerOptions": {
    "strict": true,                    // Ativar tudo
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

#### Ação:
```bash
# 1. Ativar strict mode
# (editar tsconfig.json acima)

# 2. Encontrar todos os erros
cd "C:\FOX tecnologIA\ZapScript"
npx tsc --noEmit 2>&1 | head -50

# 3. Resolver cada um:
#    - Remover `as any`
#    - Adicionar tipos corretos
#    - Fix untyped catch clauses: catch (error: unknown)
#    - etc

# 4. Verificar que não há mais erros
npx tsc --noEmit

# 5. Commit
git add tsconfig.json apps/
git commit -m "refactor: enable TypeScript strict mode"
git push origin master
```

**Checklist:**
- [ ] tsconfig.json atualizado com `"strict": true`
- [ ] `npx tsc --noEmit` roda sem erros
- [ ] ESLint passa (`npm run lint`)
- [ ] Build local funciona (`npm run build`)
- [ ] Commit + push feito

---

### 7️⃣ SUBSTITUIR CONSOLE.LOG POR LOGGER ESTRUTURADO
**Prioridade:** 🟡 ALTO  
**Tempo:** 1-2 horas  
**Status:** ❌ FAZER

#### Padrão (em `apps/api/src/index.ts`, Fastify já tem logger):

```typescript
// ❌ REMOVER:
console.log('Algo aconteceu');
console.error('Erro:', error);

// ✅ USAR:
app.log.info('Algo aconteceu');
app.log.error({ error }, 'Erro');
app.log.warn({ userId }, 'Aviso');
app.log.debug({ data }, 'Debug info');
```

#### Arquivo para auditar: `apps/api/src/routes/*.ts`

```bash
# Encontrar todos os console.log
grep -n "console\." apps/api/src -r --include="*.ts" | wc -l

# Substituir (cuidado: revisar cada um)
# Padrão: console.log("text") → app.log.info("text")
# Padrão: console.error("text", err) → app.log.error({ err }, "text")
```

**Checklist:**
- [ ] Todas as linhas `console.log`, `console.warn`, `console.error` auditadas
- [ ] Substituídas por `app.log.*` ou `logger.*` apropriadas
- [ ] Teste local: `npm run dev` não mostra console.log direto na saída
- [ ] Commit + push feito

---

### 8️⃣ MELHORAR HEALTH CHECK
**Prioridade:** 🟡 ALTO  
**Tempo:** < 1 hora  
**Status:** ❌ FAZER

#### Arquivo: `apps/api/src/routes/health.ts` (ou dentro de `index.ts`)

```typescript
app.get('/health', async (req, reply) => {
  try {
    // Verificar Redis
    const redisOk = await redis.ping().then(() => true).catch(() => false);
    
    // Verificar Database
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    
    const status = redisOk && dbOk ? 'ok' : 'degraded';
    const code = redisOk && dbOk ? 200 : 503;
    
    return reply.code(code).send({
      status,
      timestamp: new Date().toISOString(),
      checks: {
        redis: redisOk ? 'ok' : 'failed',
        database: dbOk ? 'ok' : 'failed',
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    app.log.error({ error }, 'Health check failed');
    return reply.code(500).send({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
```

**Checklist:**
- [ ] Health check testa Redis + Database
- [ ] Teste local: `curl http://localhost:3001/health` retorna JSON completo
- [ ] Teste em Railway: verificar endpoint de health
- [ ] Commit + push feito

---

## 🟢 DOCUMENTAÇÃO (Próxima semana)

### 9️⃣ SWAGGER/OPENAPI DOCUMENTATION
**Prioridade:** 🟢 MÉDIO  
**Tempo:** 2-3 horas  
**Status:** ❌ FAZER

#### Instalar:
```bash
cd apps/api
npm install @fastify/swagger @fastify/swagger-ui
```

#### Em `apps/api/src/index.ts`:
```typescript
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';

await app.register(fastifySwagger, {
  swagger: {
    info: {
      title: 'ZapScript API',
      description: 'API de transcrição automática WhatsApp',
      version: '1.0.0',
    },
    host: 'zapscript-api.railway.app',
    basePath: '/api',
    schemes: ['https'],
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
      },
    },
  },
});

await app.register(fastifySwaggerUI, {
  routePrefix: '/docs',
});
```

#### Documentar cada rota:
```typescript
app.post<{ Body: CreateTranscriptionRequest }>(
  '/transcriptions',
  {
    schema: {
      description: 'Criar nova transcrição de áudio',
      tags: ['Transcriptions'],
      body: {
        type: 'object',
        required: ['audioBase64', 'numberId'],
        properties: {
          audioBase64: { type: 'string', description: 'Áudio em Base64' },
          numberId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          description: 'Transcrição criada com sucesso',
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  },
  async (req, reply) => {
    // ... handler
  }
);
```

**Checklist:**
- [ ] `@fastify/swagger` instalado
- [ ] Swagger inicializado em index.ts
- [ ] Todas as rotas têm schema documentado
- [ ] Acessível em http://localhost:3001/docs
- [ ] Commit + push feito

---

### 🔟 LGPD ENDPOINTS
**Prioridade:** 🟢 MÉDIO  
**Tempo:** 2-3 horas  
**Status:** ❌ FAZER

#### Criar arquivo: `apps/api/src/routes/gdpr.ts`

```typescript
import { FastifyInstance } from 'fastify';

export async function gdprRoutes(app: FastifyInstance) {
  // GET /api/gdpr/export — exportar dados do usuário
  app.get('/gdpr/export', async (req, reply) => {
    const userId = req.user.sub; // JWT claim
    
    const [user, transcriptions, numbers, auditLogs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.transcription.findMany({ where: { userId } }),
      prisma.number.findMany({ where: { userId } }),
      prisma.auditLog.findMany({ where: { targetUserId: userId } }),
    ]);
    
    return reply.send({
      user,
      transcriptions,
      numbers,
      auditLogs,
      exportedAt: new Date().toISOString(),
    });
  });

  // DELETE /api/gdpr/delete — deletar todos os dados do usuário
  app.delete('/gdpr/delete', async (req, reply) => {
    const userId = req.user.sub;
    
    // Transação atômica: deletar tudo ou nada
    await prisma.$transaction([
      prisma.transcription.deleteMany({ where: { userId } }),
      prisma.number.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.auditLog.create({
        data: {
          action: 'USER_DELETED',
          targetUserId: userId,
          adminId: null,
          details: { reason: 'LGPD request' },
        },
      }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    
    return reply.send({ message: 'Dados deletados com sucesso' });
  });
}
```

#### Registrar em `index.ts`:
```typescript
import { gdprRoutes } from './routes/gdpr';

app.register(gdprRoutes, { prefix: '/api/gdpr' });
```

**Checklist:**
- [ ] Arquivo `gdpr.ts` criado
- [ ] Endpoints `/api/gdpr/export` e `/api/gdpr/delete` funcionando
- [ ] Auditoria registrada em AuditLog
- [ ] Teste: fazer export e delete, verificar no banco
- [ ] Commit + push feito

---

## 📝 CONFIGURAÇÕES NECESSÁRIAS

### Email Transacional
**Arquivo:** `.env` (não commitado)

```
# Opção 1: Gmail (gratuito)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ativação@zapscript.me
SMTP_PASS=[gerar em myaccount.google.com/apppasswords]
SUPPORT_EMAIL=ativação@zapscript.me

# Opção 2: SendGrid
SENDGRID_API_KEY=SG.xxxxx
SUPPORT_EMAIL=ativação@zapscript.me
```

**Próxima ação:** Escolher provider e configurar

---

### Asaas API
**Arquivo:** `.env` (não commitado)

```
ASAAS_API_KEY=$aact_test_xxxxx  # Trocar para $aact_live_xxxxx em prod
ASAAS_WEBHOOK_TOKEN=gere_um_token_aleatorio_aqui
```

**Próxima ação:** Copiar do dashboard Asaas

---

### Meta/WhatsApp
**Arquivo:** `.env` (não commitado)

```
WHATSAPP_API_TOKEN=EAAS...
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_WEBHOOK_TOKEN=gere_um_token_aleatorio_aqui
```

**Status:** ⏳ Em verificação Meta (aguardar aprovação)

---

## ✅ CHECKLIST FINAL PRÉ-PRODUÇÃO

### Código
- [ ] .env removido do git
- [ ] Todos os secrets rodados
- [ ] TypeScript strict mode ativado
- [ ] Nenhum console.log em produção
- [ ] Helmet + security headers
- [ ] Sentry integrado
- [ ] Health check completo
- [ ] Webhook signature validation
- [ ] ESLint sem warnings (`npm run lint`)
- [ ] Build funciona (`npm run build`)

### Deploy
- [ ] Railway API environment variables atualizadas
- [ ] Railway Worker environment variables atualizadas
- [ ] Vercel environment variables atualizadas
- [ ] Supabase migrations rodadas (`npm run db:migrate:prod`)
- [ ] Database backups testados

### Documentação
- [ ] Swagger/OpenAPI pronto
- [ ] LGPD endpoints prontos
- [ ] README atualizado
- [ ] .env.example atualizado
- [ ] Runbook de deployment escrito
- [ ] Troubleshooting guide escrito

### Conformidade
- [ ] Política de Privacidade publicada
- [ ] Termos de Serviço publicados
- [ ] CNPJ em fatura funcionando
- [ ] Email transacional funcionando

---

## 🎯 SEQUÊNCIA DE EXECUÇÃO RECOMENDADA

```
HOJE (2026-05-04):
1. Remover .env, rotear secrets        ← 30 min
2. Remover Baileys legado             ← 20 min
3. Adicionar Helmet                    ← 15 min
4. Webhook Asaas signature             ← 20 min
5. Sentry integration                  ← 20 min
   → Total: ~2 horas, pronto para staging

AMANHÃ (2026-05-05):
6. TypeScript strict mode              ← 2 horas
7. Substituir console.log              ← 1 hora
8. Health check melhorado              ← 30 min
   → Total: ~3.5 horas

PRÓXIMA SEMANA:
9. Swagger documentation               ← 2 horas
10. LGPD endpoints                     ← 2 horas
11. Email transacional                 ← 1 hora
    → Total: ~5 horas
```

---

## 🔄 SYNC PARA GITHUB

Após cada seção concluída:

```bash
cd "C:\FOX tecnologIA\ZapScript"

# 1. Verificar status
git status

# 2. Adicionar mudanças
git add -A

# 3. Commit com mensagem descritiva
git commit -m "task: [section number] — [description]"
# Exemplo: git commit -m "security: add helmet and webhook signature validation"

# 4. Push para GitHub
git push origin master

# 5. Verificar no GitHub
# https://github.com/foxtecnologiaonline/zapscript
```

---

**Última atualização:** 2026-05-04  
**Responsável:** ZapScript Team  
**Próximo review:** 2026-05-05
