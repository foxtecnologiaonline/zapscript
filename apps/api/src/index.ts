import 'dotenv/config';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import helmet from '@fastify/helmet';
// @ts-ignore - socket.io has built-in types but TypeScript doesn't find them
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from './services/queue';
import { pubClient, subClient } from './lib/redisAdapter';
import { registerSecurityShield } from './lib/security-shield';
import { prisma } from './lib/prisma';
import { syncAllEvolutionConfigs } from './services/evolution-sync';
import { startHeartbeat }         from './services/evolution-heartbeat';
import { startHealthMonitor }     from './services/health-monitor';
import { startLifecycleEmails }   from './services/lifecycle-emails';

// ── Inicializar Sentry ────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
  disableRequestLogging: false,
  ignoreTrailingSlash: true,
  // M9: Trust proxy (Nginx/Vercel) para rate limiting usar IP real do cliente via X-Forwarded-For
  // Sem isso, todos os requests aparecem como vindos do IP do proxy (mesmo IP → rate limit ineficaz)
  trustProxy: true,
});

// Ignorar ECONNRESET no servidor HTTP (clientes que fecham conexão — comportamento normal)
app.server.on('error', (err: any) => {
  if (err.code === 'ECONNRESET') return;
  app.log.error(err, 'Server error');
});

// Escudo cibernético: bloqueia paths de sondagem e bane IPs abusivos (fail2ban-lite).
// Registrado o mais cedo possível — antes de CORS/parsing/rotas.
registerSecurityShield(app);

// Preserve raw body for webhook verification (JSON)
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const str = body.toString().trim();
      done(null, str ? JSON.parse(str) : {});
    } catch (err: any) {
      done(err);
    }
  }
);

// Parser para webhooks Twilio (application/x-www-form-urlencoded)
app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'buffer' },
  (_req, body, done) => {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(body.toString()));
      done(null, parsed);
    } catch (err: any) {
      done(err);
    }
  }
);

// CORS origins: aceitar APP_URL + variante www/sem-www automaticamente
// Ex: APP_URL=https://www.zapscript.me → permite também https://zapscript.me
function buildAllowedOrigins(): string | string[] | false {
  const base = process.env.APP_URL;
  if (!base) return process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : false;

  const origins = new Set<string>([base.replace(/\/$/, '')]);

  // Adicionar variante com/sem www automaticamente
  if (base.includes('://www.')) {
    origins.add(base.replace('://www.', '://').replace(/\/$/, ''));
  } else if (!base.includes('://www.')) {
    origins.add(base.replace('://', '://www.').replace(/\/$/, ''));
  }

  // EXTRA_ORIGINS permite adicionar origens adicionais via env (separadas por vírgula)
  if (process.env.EXTRA_ORIGINS) {
    process.env.EXTRA_ORIGINS.split(',').forEach(o => origins.add(o.trim()));
  }

  // Em dev, incluir localhost
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
  }

  const list = [...origins];
  return list.length === 1 ? list[0] : list;
}

const allowedOrigins = buildAllowedOrigins();

// Attach Socket.IO to Fastify's underlying http.Server
export const io = new SocketServer(app.server, {
  cors:       { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],  // aceita polling e ws
  pingTimeout:  60000,   // 60s antes de considerar desconectado
  pingInterval: 25000,   // heartbeat a cada 25s (evita timeout do Render)
});

// Redis adapter — permite escalar para múltiplos pods sem perder eventos Socket.IO
Promise.all([pubClient.connect(), subClient.connect()])
  .then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    app.log.info('[Socket.IO] Redis adapter configurado ✅');
  })
  .catch((err) => {
    app.log.warn({ err: err?.message }, '[Socket.IO] Redis adapter falhou — rodando sem adapter (single-pod)');
  });

// ── Socket.IO Authentication Middleware ────────────────────────────
// Valida JWT antes de permitir qualquer operação
io.use((socket: Socket, next: (err?: Error) => void) => {
  const token = socket.handshake.auth.token
    || socket.handshake.headers['x-access-token'] as string;

  if (!token) {
    return next(new Error('[Socket.IO] No token provided'));
  }

  try {
    // Verifica JWT usando a chave secreta da API
    const decoded = app.jwt.verify(token) as any;
    socket.data.userId = decoded.sub;
    socket.data.email = decoded.email;
    app.log.info(`[Socket.IO] User ${decoded.sub} autenticado`);
    next();
  } catch (err: any) {
    app.log.warn(`[Socket.IO] Auth failed: ${err.message}`);
    next(new Error('[Socket.IO] Invalid token'));
  }
});

io.on('connection', (socket: Socket) => {
  socket.on('join', ({ userId }: { userId: string }) => {
    // Valida que userId do socket = userId solicitado
    if (userId !== socket.data.userId) {
      app.log.warn(`[Socket.IO] Tentativa de acesso não autorizado: user ${socket.data.userId} → ${userId}`);
      socket.disconnect();
      return;
    }

    if (!userId || typeof userId !== 'string' || userId.length > 64) {
      socket.disconnect();
      return;
    }

    socket.join(`user:${userId}`);
    app.log.info(`[Socket.IO] user:${userId} entrou na sala`);
    // Note: WhatsApp messages now come via webhooks (Meta Cloud API)
    // Socket.IO emits 'audio_received', 'text_received', etc. when messages arrive
  });

  // Sala de notificações do painel de suporte — só para admins autenticados
  socket.on('join:suporte', async () => {
    const uid = socket.data.userId;
    if (!uid) return;
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { isAdmin: true } }).catch(() => null);
    if (!u?.isAdmin) { app.log.warn(`[Socket.IO] join:suporte negado para ${uid}`); return; }
    socket.join('admin:suporte');
    app.log.info(`[Socket.IO] admin ${uid} entrou em admin:suporte`);
  });
});

app.register(cors, {
  origin: allowedOrigins,
  // Sem credentials: auth é 100% Bearer token (localStorage), nunca cookie —
  // manter credentials:true só ampliaria a superfície de CSRF sem necessidade.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      styleSrc:      ["'self'"],        // M8: removido unsafe-inline
      imgSrc:        ["'self'", 'data:', 'https:'],
      frameAncestors: ["'none'"],       // M8: CSP frame-ancestors redundante com X-Frame-Options mas correto
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
});
app.register(jwt, { secret: process.env.JWT_SECRET! });

// Rate limit global — webhooks são excluídos (Z-API pode enviar rajadas em instâncias com muitos números)
// O cast para `as any` é necessário pois 'skip' está nos tipos do @fastify/rate-limit v10
// mas ainda não foi exportado na definição TypeScript da versão instalada.
app.register(rateLimit, {
  max:        150,   // aumentado para 500 usuários simultâneos
  timeWindow: '1 minute',
  // Store compartilhado no Redis: os limites sobrevivem a restart/deploy e
  // ficam corretos mesmo escalando para múltiplas instâncias (antes era em
  // memória — cada instância tinha sua própria contagem, diluindo o limite real).
  redis,
  skip: (req: any) =>
    req.url.startsWith('/webhook/') ||
    req.url === '/health',
  addHeaders: {
    'x-ratelimit-limit':     true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset':     true,
    'retry-after':           true,
  },
  errorResponseBuilder: (_req: any, context: any) => ({
    error:      'Muitas requisições. Tente novamente em breve.',
    retryAfter: context.after,
  }),
} as any);
// 15MB: teto global para as rotas que consomem multipart (/support/ticket limita a
// 10MB no app; /atende/setup/* limita a 15MB áudio / 8MB imagem no ai-input.ts). O
// teto antigo (200MB) era resquício da demo de upload de áudio removida e só
// ampliava a superfície de DoS por upload.
app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });

// ── Swagger/OpenAPI Documentation — somente em desenvolvimento ─────────────
if (process.env.NODE_ENV !== 'production') {
  app.register(swagger, {
    swagger: {
      info: {
        title: 'ZapScript API',
        description: 'API de conversão automática de áudios do WhatsApp',
        version: '1.0.0',
        contact: {
          name: 'ZapScript Support',
          email: 'suporte@zapscript.me',
        },
      },
      host: process.env.APP_URL?.replace(/https?:\/\//, '').split(':')[0] || 'localhost:3001',
      schemes: ['https', 'http'],
      consumes: ['application/json'],
      produces: ['application/json'],
      securityDefinitions: {
        bearerAuth: {
          type: 'apiKey',
          name: 'authorization',
          in: 'header',
          description: 'Bearer token JWT',
        },
      },
    },
  });

  app.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: { deepLinking: false },
  });
}

// ── Security Headers ──────────────────────────────────────────
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  // '0' é a guidance moderna (MDN/OWASP): o filtro legado do XSS-Auditor foi
  // removido dos browsers e podia até introduzir vulnerabilidades; a proteção
  // real já vem da CSP restritiva abaixo.
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

app.decorate('authenticate', async function (req: any, reply: any) {
  // Verificar JWT
  try { await req.jwtVerify(); }
  catch { return reply.code(401).send({ error: 'Unauthorized' }); }

  // C4: Rejeitar usuários com soft-delete (deletedAt !== null)
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { deletedAt: true } });
    if (!u || u.deletedAt !== null) {
      return reply.code(401).send({ error: 'Conta desativada.' });
    }
  } catch {
    // DB indisponível: fail-open para não bloquear usuários legítimos
    app.log.warn({ userId: req.user.sub }, '[Auth] Falha ao verificar deletedAt — prosseguindo');
  }
});

// ── Routes ────────────────────────────────────────────────────
app.register(import('./routes/auth'),           { prefix: '/auth' });
app.register(import('./routes/numbers'),        { prefix: '/numbers' });
app.register(import('./routes/transcriptions'), { prefix: '/transcriptions' });
app.register(import('./routes/billing'),        { prefix: '/billing' });
app.register(import('./routes/dashboard'),      { prefix: '/dashboard' });
app.register(import('./routes/monitor'),        { prefix: '/monitor' });
app.register(import('./routes/internal'),       { prefix: '/internal' });
app.register(import('./routes/support'),        { prefix: '/support' });
app.register(import('./routes/admin'),          { prefix: '/sys/g5r8t2' });
app.register(import('./routes/admin-master'),   { prefix: '/sys/g5r8t2/master' });
app.register(import('./routes/suporte-admin'),  { prefix: '/sys/g5r8t2/suporte' });
app.register(import('./routes/invites'),         { prefix: '/invites' });
app.register(import('./routes/privacy'),         { prefix: '/privacy' });
app.register(import('./routes/webhook-config'),  { prefix: '/webhook-config' });
app.register(import('./routes/nps'),             { prefix: '/nps' });
app.register(import('./routes/meta-embedded'),   { prefix: '/meta' });
app.register(import('./routes/affiliates'),      { prefix: '/affiliates' });
app.register(import('./routes/entitlements'),    { prefix: '/modules' });
app.register(import('./routes/modules/campanhas'), { prefix: '/modules/campanhas' });
app.register(import('./routes/modules/crm'),     { prefix: '/crm' });
app.register(import('./routes/atende'),          { prefix: '/atende' });
app.register(import('./routes/modules/vendas'),  { prefix: '/modules/vendas' });
app.register(import('./routes/modules/crm'),     { prefix: '/crm' });
app.register(import('./routes/cobranca'),        { prefix: '/cobranca' });
app.register(import('./routes/legendas'),        { prefix: '/legendas' });
app.register(import('./routes/modules/campanhas'), { prefix: '/modules/campanhas' });
// Plano Empresas — multi-seat MVP
app.register(import('./routes/teams'),           { prefix: '/teams' });
// Demo de upload no site removido — vira app/site separado. Rota desativada.
app.register(import('./routes/analytics'),       { prefix: '/analytics' });

// ── Demo pública (lead magnet) — 1 áudio grátis sem cadastro ─────────
app.register(import('./routes/demo'),            { prefix: '/demo' });

// ── WhatsApp Webhook (Meta Cloud API) ──────────────────────
// Registrar sempre — webhook precisa responder para validação mesmo sem token configurado
app.register(import('./routes/whatsapp-webhook'), { prefix: '/webhook/whatsapp' });

// ── WhatsApp Webhook (Twilio BSP) ───────────────────────────
// Alternativa BSP para testes sem aprovação Meta
app.register(import('./routes/twilio-webhook'), { prefix: '/webhook/twilio' });

// ── WhatsApp Webhook (Evolution API — dispositivo adicional) ────────────────
// Cada usuário tem instância dedicada — sem compartilhamento entre usuários
app.register(import('./routes/evolution-webhook'), { prefix: '/webhook/evolution' });

// ── Agente de Suporte — WhatsApp Business (Meta Cloud API) ──────────────────
// Número de atendimento ao cliente; mensagens → fila de aprovação no painel
app.register(import('./routes/suporte-whatsapp'), { prefix: '/webhook/suporte/whatsapp' });
if (process.env.WHATSAPP_API_TOKEN) {
  app.log.info('✅ WhatsApp Cloud API webhook registrado com token');
} else {
  app.log.info('ℹ️ WHATSAPP_API_TOKEN não configurado — usando Evolution API (esperado)');
}

app.get('/health', async (req, reply) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Redis check
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    healthy = false;
  }

  // DB check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
    healthy = false;
  }

  // Em produção, detalhes internos só com token de monitor
  const monitorToken = process.env.MONITOR_TOKEN;
  const reqToken     = (req.headers['x-monitor-token'] as string | undefined);
  const isAuthorized = !monitorToken || (reqToken && reqToken === monitorToken);

  const payload = {
    status: healthy ? 'ok' : 'degraded',
    ts:     new Date().toISOString(),
    ...(isAuthorized ? {
      app:    process.env.APP_NAME || 'ZapScript',
      env:    process.env.NODE_ENV,
      checks,
    } : {}),
  };

  return healthy ? payload : reply.code(503).send(payload);
});

// ── Error Handlers ────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  const err = reason as any;
  if (err?.code === 'ECONNRESET') return; // conexão fechada pelo cliente, normal
  app.log.error({ reason, promise }, 'Unhandled Rejection');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason);
  }
});

process.on('uncaughtException', (error) => {
  if ((error as any).code === 'ECONNRESET') return; // conexão fechada pelo cliente, normal
  app.log.error(error, 'Uncaught Exception');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
  }
  process.exit(1);
});

async function runAutoMigrations() {
  // Garante que colunas novas existam mesmo sem rodar prisma migrate manualmente
  const migrations = [
    `ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "zapiInstanceId" TEXT`,
    `ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "zapiToken" TEXT`,
    // Remove unique constraint — zapiInstanceId agora armazena nome de instância Evolution (único por número, não forçado no DB)
    `DROP INDEX IF EXISTS "WhatsappNumber_zapiInstanceId_key"`,
    // ── Migração Z-API → Evolution API ──────────────────────────────────────────
    // Números com zapiInstanceId em formato Z-API (ex: UUID hexadecimal, não começa com 'zs-')
    // estão inválidos para Evolution API. Reset forçado → usuário reconecta e ganha instância dedicada.
    `UPDATE "WhatsappNumber"
       SET "zapiInstanceId" = NULL, "zapiToken" = NULL, "status" = 'disconnected'
       WHERE "zapiInstanceId" IS NOT NULL
         AND "zapiInstanceId" NOT LIKE 'zs-%'`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isTester" BOOLEAN DEFAULT false`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "testerSince" TIMESTAMP(3)`,
    `CREATE TABLE IF NOT EXISTS "TesterInvite" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "usedAt" TIMESTAMP(3),
      "usedBy" TEXT,
      CONSTRAINT "TesterInvite_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "TesterInvite_code_key" UNIQUE ("code")
    )`,
    `CREATE INDEX IF NOT EXISTS "TesterInvite_code_idx" ON "TesterInvite"("code")`,
    // Conversões sobrevivem à remoção do número (SET NULL em vez de CASCADE)
    `ALTER TABLE "Transcription" ALTER COLUMN "numberId" DROP NOT NULL`,
    `ALTER TABLE "Transcription" DROP CONSTRAINT IF EXISTS "Transcription_numberId_fkey"`,
    `ALTER TABLE "Transcription" ADD CONSTRAINT "Transcription_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    // UsageLogs sobrevivem à exclusão da conversão (minutos continuam contados)
    `ALTER TABLE "UsageLog" ALTER COLUMN "transcriptionId" DROP NOT NULL`,
    `ALTER TABLE "UsageLog" DROP CONSTRAINT IF EXISTS "UsageLog_transcriptionId_fkey"`,
    `ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "Transcription"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    // C2: Criptografia CPF/CNPJ — adiciona blind index documentHash e remove unique de document
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentHash" TEXT`,
    `DROP INDEX IF EXISTS "User_document_key"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_documentHash_key" ON "User"("documentHash")`,
    // Marketing: atribuição de origem (UTM) + idempotência de e-mails de ciclo de vida
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmSource" TEXT`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lifecycleEmailsSent" TEXT[] DEFAULT '{}'`,
    // Agente de Suporte (migração 20260616_support_agent): auto-cura o schema no
    // boot mesmo se o startCommand de produção não rodar `prisma migrate deploy`.
    `CREATE TABLE IF NOT EXISTS "SupportAtendimento" (
      "id"                TEXT NOT NULL,
      "canal"             TEXT NOT NULL,
      "status"            TEXT NOT NULL DEFAULT 'pending_approval',
      "categoria"         TEXT,
      "prioridade"        TEXT,
      "sentimento"        TEXT,
      "confiancaResposta" INTEGER,
      "requerEscalacao"   BOOLEAN NOT NULL DEFAULT false,
      "topicos"           TEXT[] DEFAULT ARRAY[]::TEXT[],
      "clienteNome"       TEXT,
      "clienteEmail"      TEXT,
      "clienteWhatsapp"   TEXT,
      "clienteUserId"     TEXT,
      "mensagemOriginal"  TEXT NOT NULL,
      "rascunhoAgente"    TEXT,
      "respostaFinal"     TEXT,
      "editadoPeloAdmin"  BOOLEAN NOT NULL DEFAULT false,
      "instrucaoRevisao"  TEXT,
      "threadId"          TEXT,
      "canalExternoId"    TEXT,
      "contextoUsado"     TEXT,
      "sugestaoFaq"       TEXT,
      "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "aprovadoEm"        TIMESTAMP(3),
      "enviadoEm"         TIMESTAMP(3),
      "resolvidoEm"       TIMESTAMP(3),
      CONSTRAINT "SupportAtendimento_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "SupportAtendimento_status_prioridade_idx" ON "SupportAtendimento"("status", "prioridade")`,
    `CREATE INDEX IF NOT EXISTS "SupportAtendimento_canal_criadoEm_idx" ON "SupportAtendimento"("canal", "criadoEm")`,
    `CREATE INDEX IF NOT EXISTS "SupportAtendimento_threadId_idx" ON "SupportAtendimento"("threadId")`,
    `CREATE INDEX IF NOT EXISTS "SupportAtendimento_canalExternoId_idx" ON "SupportAtendimento"("canalExternoId")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportAtendimento_clienteUserId_fkey') THEN
        ALTER TABLE "SupportAtendimento"
          ADD CONSTRAINT "SupportAtendimento_clienteUserId_fkey"
          FOREIGN KEY ("clienteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
      "id"                  TEXT NOT NULL,
      "titulo"              TEXT NOT NULL,
      "conteudo"            TEXT NOT NULL,
      "categoria"           TEXT,
      "tags"                TEXT[] DEFAULT ARRAY[]::TEXT[],
      "canalOrigem"         TEXT,
      "atendimentoOrigemId" TEXT,
      "aprovadoPorAdmin"    BOOLEAN NOT NULL DEFAULT true,
      "vezesUtilizado"      INTEGER NOT NULL DEFAULT 0,
      "utilidadeMedia"      DOUBLE PRECISION NOT NULL DEFAULT 0,
      "criadoEm"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizadoEm"        TIMESTAMP(3) NOT NULL,
      CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "KnowledgeBase_categoria_idx" ON "KnowledgeBase"("categoria")`,
    `CREATE TABLE IF NOT EXISTS "FaqSuggestion" (
      "id"                  TEXT NOT NULL,
      "tituloSugerido"      TEXT NOT NULL,
      "conteudoSugerido"    TEXT NOT NULL,
      "categoria"           TEXT,
      "atendimentoOrigemId" TEXT,
      "status"              TEXT NOT NULL DEFAULT 'pending',
      "criadoEm"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "revisadoEm"          TIMESTAMP(3),
      CONSTRAINT "FaqSuggestion_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "FaqSuggestion_status_idx" ON "FaqSuggestion"("status")`,
    // ── Módulo Cobrança (2026-07-13): auto-cura o schema no boot, mesmo padrão acima ──
    `CREATE TABLE IF NOT EXISTS "CobrancaCliente" (
      "id"        TEXT NOT NULL,
      "userId"    TEXT NOT NULL,
      "nome"      TEXT NOT NULL,
      "telefone"  TEXT NOT NULL,
      "documento" TEXT,
      "email"     TEXT,
      "notas"     TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "deletedAt" TIMESTAMP(3),
      CONSTRAINT "CobrancaCliente_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "CobrancaCliente_userId_deletedAt_idx" ON "CobrancaCliente"("userId", "deletedAt")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CobrancaCliente_userId_fkey') THEN
        ALTER TABLE "CobrancaCliente"
          ADD CONSTRAINT "CobrancaCliente_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "CobrancaCobranca" (
      "id"         TEXT NOT NULL,
      "userId"     TEXT NOT NULL,
      "clienteId"  TEXT NOT NULL,
      "descricao"  TEXT NOT NULL,
      "valor"      DOUBLE PRECISION NOT NULL,
      "vencimento" TIMESTAMP(3) NOT NULL,
      "status"     TEXT NOT NULL DEFAULT 'pendente',
      "pagoEm"     TIMESTAMP(3),
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMP(3) NOT NULL,
      "deletedAt"  TIMESTAMP(3),
      CONSTRAINT "CobrancaCobranca_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "CobrancaCobranca_userId_status_vencimento_idx" ON "CobrancaCobranca"("userId", "status", "vencimento")`,
    `CREATE INDEX IF NOT EXISTS "CobrancaCobranca_clienteId_idx" ON "CobrancaCobranca"("clienteId")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CobrancaCobranca_userId_fkey') THEN
        ALTER TABLE "CobrancaCobranca"
          ADD CONSTRAINT "CobrancaCobranca_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CobrancaCobranca_clienteId_fkey') THEN
        ALTER TABLE "CobrancaCobranca"
          ADD CONSTRAINT "CobrancaCobranca_clienteId_fkey"
          FOREIGN KEY ("clienteId") REFERENCES "CobrancaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "CobrancaEnvio" (
      "id"         TEXT NOT NULL,
      "cobrancaId" TEXT NOT NULL,
      "tipo"       TEXT NOT NULL,
      "enviadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "sucesso"    BOOLEAN NOT NULL DEFAULT true,
      "erro"       TEXT,
      CONSTRAINT "CobrancaEnvio_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "CobrancaEnvio_cobrancaId_tipo_idx" ON "CobrancaEnvio"("cobrancaId", "tipo")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CobrancaEnvio_cobrancaId_fkey') THEN
        ALTER TABLE "CobrancaEnvio"
          ADD CONSTRAINT "CobrancaEnvio_cobrancaId_fkey"
          FOREIGN KEY ("cobrancaId") REFERENCES "CobrancaCobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    // Módulo mantido oculto (status 'planned') até decisão explícita de lançamento —
    // ver packages/modules/catalog.ts. NÃO promover para 'beta' aqui sem confirmação.
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "Product" WHERE "key" = 'cobranca') THEN
        UPDATE "Product" SET "status" = 'planned', "priceMonthly" = 39, "priceYearly" = 374
          WHERE "key" = 'cobranca' AND "status" NOT IN ('beta', 'ga');
      ELSE
        INSERT INTO "Product" ("id","key","name","status","priceMonthly","priceYearly","dependsOn","createdAt","updatedAt")
        VALUES ('cobranca-product-seed', 'cobranca', 'ZapScript Cobrança', 'planned', 39, 374, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END IF;
    END $$`,
    // Módulo Legendas (migração 20260714_legenda_jobs): auto-cura o schema no
    // boot mesmo se o startCommand de produção não rodar `prisma migrate deploy`.
    `CREATE TABLE IF NOT EXISTS "LegendaJob" (
      "id"               TEXT NOT NULL,
      "userId"           TEXT NOT NULL,
      "status"           TEXT NOT NULL DEFAULT 'pending',
      "originalFilename" TEXT,
      "inputStorageKey"  TEXT NOT NULL,
      "inputSizeBytes"   INTEGER,
      "durationSec"      DOUBLE PRECISION,
      "language"         TEXT NOT NULL DEFAULT 'pt',
      "srtStorageKey"    TEXT,
      "vttStorageKey"    TEXT,
      "errorMessage"     TEXT,
      "deletedAt"        TIMESTAMP(3),
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMP(3) NOT NULL,
      CONSTRAINT "LegendaJob_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "LegendaJob_userId_createdAt_idx" ON "LegendaJob"("userId", "createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "LegendaJob_status_idx" ON "LegendaJob"("status")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegendaJob_userId_fkey') THEN
        ALTER TABLE "LegendaJob"
          ADD CONSTRAINT "LegendaJob_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    // Módulo lançado como MVP (status 'beta') em 2026-07-24 — ver packages/modules/catalog.ts.
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "Product" WHERE "key" = 'legenda') THEN
        UPDATE "Product" SET "status" = 'beta', "priceMonthly" = 37, "priceYearly" = 355
          WHERE "key" = 'legenda' AND "status" NOT IN ('beta', 'ga');
      ELSE
        INSERT INTO "Product" ("id","key","name","status","priceMonthly","priceYearly","dependsOn","createdAt","updatedAt")
        VALUES ('legenda-product-seed', 'legenda', 'ZapScript Legendas', 'beta', 37, 355, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END IF;
    END $$`,
    // Módulo Campanhas (migração 20260713_campanhas_tables): auto-cura o schema no
    // boot mesmo se o startCommand de produção não rodar `prisma migrate deploy`.
    `CREATE TABLE IF NOT EXISTS "Campanha" (
      "id"                 TEXT NOT NULL,
      "userId"             TEXT NOT NULL,
      "whatsappNumberId"   TEXT NOT NULL,
      "name"               TEXT NOT NULL,
      "status"             TEXT NOT NULL DEFAULT 'draft',
      "templateName"       TEXT NOT NULL,
      "templateLanguage"   TEXT NOT NULL DEFAULT 'pt_BR',
      "templateComponents" JSONB,
      "audienceCount"      INTEGER NOT NULL DEFAULT 0,
      "sentCount"          INTEGER NOT NULL DEFAULT 0,
      "scheduledAt"        TIMESTAMP(3),
      "startedAt"          TIMESTAMP(3),
      "completedAt"        TIMESTAMP(3),
      "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"          TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Campanha_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Campanha_userId_idx" ON "Campanha"("userId")`,
    `CREATE INDEX IF NOT EXISTS "Campanha_whatsappNumberId_idx" ON "Campanha"("whatsappNumberId")`,
    `CREATE INDEX IF NOT EXISTS "Campanha_status_idx" ON "Campanha"("status")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campanha_userId_fkey') THEN
        ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campanha_whatsappNumberId_fkey') THEN
        ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_whatsappNumberId_fkey" FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "CampanhaContato" (
      "id"           TEXT NOT NULL,
      "campanhaId"   TEXT NOT NULL,
      "phone"        TEXT NOT NULL,
      "name"         TEXT,
      "variables"    JSONB,
      "status"       TEXT NOT NULL DEFAULT 'pending',
      "wamid"        TEXT,
      "errorMessage" TEXT,
      "sentAt"       TIMESTAMP(3),
      "deliveredAt"  TIMESTAMP(3),
      "readAt"       TIMESTAMP(3),
      "failedAt"     TIMESTAMP(3),
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CampanhaContato_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "CampanhaContato_campanhaId_idx" ON "CampanhaContato"("campanhaId")`,
    `CREATE INDEX IF NOT EXISTS "CampanhaContato_campanhaId_status_idx" ON "CampanhaContato"("campanhaId", "status")`,
    `CREATE INDEX IF NOT EXISTS "CampanhaContato_wamid_idx" ON "CampanhaContato"("wamid")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampanhaContato_campanhaId_fkey') THEN
        ALTER TABLE "CampanhaContato" ADD CONSTRAINT "CampanhaContato_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "CampanhaOptOut" (
      "id"        TEXT NOT NULL,
      "userId"    TEXT NOT NULL,
      "phone"     TEXT NOT NULL,
      "reason"    TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CampanhaOptOut_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "CampanhaOptOut_userId_phone_key" ON "CampanhaOptOut"("userId", "phone")`,
    `CREATE INDEX IF NOT EXISTS "CampanhaOptOut_userId_idx" ON "CampanhaOptOut"("userId")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampanhaOptOut_userId_fkey') THEN
        ALTER TABLE "CampanhaOptOut" ADD CONSTRAINT "CampanhaOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    // Módulo mantido oculto (status 'planned') até decisão explícita de lançamento —
    // ver packages/modules/catalog.ts. NÃO promover para 'beta' aqui sem confirmação.
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "Product" WHERE "key" = 'campanhas') THEN
        UPDATE "Product" SET "status" = 'planned', "priceMonthly" = 67, "priceYearly" = 643
          WHERE "key" = 'campanhas' AND "status" NOT IN ('beta', 'ga');
      ELSE
        INSERT INTO "Product" ("id","key","name","status","priceMonthly","priceYearly","dependsOn","createdAt","updatedAt")
        VALUES ('campanhas-product-seed', 'campanhas', 'ZapScript Campanhas', 'planned', 67, 643, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END IF;
    END $$`,
    // ── Plano Empresas Multi-Seat (migração 20260722_team_multiseat) ──
    `CREATE TABLE IF NOT EXISTS "Team" (
      "id"        TEXT NOT NULL,
      "name"      TEXT NOT NULL,
      "slug"      TEXT NOT NULL,
      "ownerId"   TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Team_slug_key" ON "Team"("slug")`,
    `CREATE INDEX IF NOT EXISTS "Team_ownerId_idx" ON "Team"("ownerId")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Team_ownerId_fkey') THEN
        ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS "TeamMember" (
      "id"           TEXT NOT NULL,
      "teamId"       TEXT NOT NULL,
      "userId"       TEXT NOT NULL,
      "role"         TEXT NOT NULL DEFAULT 'member',
      "status"       TEXT NOT NULL DEFAULT 'active',
      "inviteCode"   TEXT,
      "invitedEmail" TEXT,
      "joinedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_userId_key" ON "TeamMember"("userId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_inviteCode_key" ON "TeamMember"("inviteCode")`,
    `CREATE INDEX IF NOT EXISTS "TeamMember_teamId_idx" ON "TeamMember"("teamId")`,
    `CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx" ON "TeamMember"("userId")`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamMember_teamId_fkey') THEN
        ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamMember_userId_fkey') THEN
        ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    // ── Tracking de cliques de afiliados (migração 20260722_public_number_flag parte 2) ──
    `CREATE TABLE IF NOT EXISTS "AffiliateClick" (
      "id"          TEXT NOT NULL,
      "affiliateId" TEXT NOT NULL,
      "ipHash"      TEXT,
      "userAgent"   TEXT,
      "referer"     TEXT,
      "converted"   BOOLEAN NOT NULL DEFAULT false,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "AffiliateClick_affiliateId_createdAt_idx" ON "AffiliateClick"("affiliateId", "createdAt" DESC)`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateClick_affiliateId_fkey') THEN
        ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    // ── Número público para demo/lead magnet (migração 20260722_public_number_flag) ──
    `ALTER TABLE "WhatsappNumber" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT false`,
    // ── Seed idempotente: número oficial do ZapScript (34 98843-4133) ────────────
    // Serve 4 papéis simultâneos:
    //   1. Comunicação e envio de campanhas/mensagens (admin)
    //   2. Número para Suporte oficial
    //   3. Conversão automática: todo áudio recebido → texto + resumo
    //   4. 1º áudio enviado ao usuário assim que ele conecta no ZapScript (onboarding)
    // userId = primeiro admin encontrado (fallback: cria placeholder se não existir).
    // isPublic = true → webhook processa áudios de desconhecidos como demo grátis.
    `DO $$
    DECLARE
      _admin_id TEXT;
      _exists   BOOLEAN;
    BEGIN
      SELECT "id" INTO _admin_id FROM "User" WHERE "isAdmin" = true AND "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1;
      IF _admin_id IS NULL THEN
        SELECT "id" INTO _admin_id FROM "User" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1;
      END IF;
      -- Se não houver nenhum usuário (DB vazio), usar placeholder (FK exige valor)
      IF _admin_id IS NULL THEN
        _admin_id := 'zapscript-oficial-placeholder';
      END IF;

      SELECT EXISTS(SELECT 1 FROM "WhatsappNumber" WHERE "phoneNumber" = '5534988434133' AND "isPublic" = true)
        INTO _exists;
      IF NOT _exists THEN
        INSERT INTO "WhatsappNumber" ("id", "userId", "phoneNumber", "displayName", "status", "isPublic", "privateMode", "provider", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, _admin_id, '5534988434133', 'ZapScript Oficial', 'disconnected', true, true, 'evolution', NOW(), NOW());
        RAISE NOTICE '[Seed] Numero oficial ZapScript (34 98843-4133) criado como isPublic=true';
      END IF;
    END $$`,
  ];
  for (const sql of migrations) {
    await prisma.$executeRawUnsafe(sql).catch((e: any) =>
      app.log.warn(`[AutoMigration] ${e.message}`)
    );
  }
  app.log.info('[AutoMigration] ✅ Schema verificado (Evolution API + Testers + CPF encrypt + Cobrança + Legendas + Campanhas + Teams + AffiliateClick + isPublic + privateMode default false)');

  // ── Migração: ALTER DEFAULT privateMode → false (2026-07-22) ──
  // Anteriormente o default era true (opt-out automático em pago).
  // Agora é false (opt-in manual). Só altera o DEFAULT — não faz backfill
  // (usuários existentes que já ativaram mantêm o flag ligado).
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WhatsappNumber" ALTER COLUMN "privateMode" SET DEFAULT false`
  ).catch((e: any) =>
    app.log.warn(`[AutoMigration] privateMode default: ${e.message}`)
  );
  app.log.info('[AutoMigration] ✅ privateMode default = false');
}

/**
 * C2: Migração de dados — criptografa CPF/CNPJ plaintext existentes no banco.
 * Idempotente: pula registros já criptografados (formato iv:tag:hex) ou sem CPF.
 * Roda automaticamente no startup — não requer acesso manual ao servidor.
 */
async function runDocumentEncryptionMigration() {
  try {
    const { encryptStr, documentHash } = await import('./services/encryption');

    // Buscar apenas usuários com document plaintext (documentHash null = ainda não migrado)
    const users = await prisma.user.findMany({
      where:  { document: { not: null }, documentHash: null },
      select: { id: true, document: true },
    });

    if (users.length === 0) {
      app.log.info('[DataMigration] ✅ CPF/CNPJ: nenhum registro plaintext pendente');
      return;
    }

    app.log.info(`[DataMigration] 🔐 Criptografando ${users.length} CPF/CNPJ...`);
    let ok = 0, fail = 0;

    for (const user of users) {
      try {
        const clean = user.document!.replace(/\D/g, '');
        const hash  = documentHash(clean);

        // Verificar conflito de hash antes de salvar (CPF duplicado no banco legado)
        const conflict = await prisma.user.findFirst({
          where: { documentHash: hash, NOT: { id: user.id } },
          select: { id: true },
        });
        if (conflict) {
          app.log.warn(`[DataMigration] CPF duplicado (${user.id} x ${conflict.id}) — pulando`);
          fail++;
          continue;
        }

        await prisma.user.update({
          where: { id: user.id },
          data:  { document: encryptStr(clean), documentHash: hash },
        });
        ok++;
      } catch (e: any) {
        app.log.warn(`[DataMigration] Erro em ${user.id}: ${e.message}`);
        fail++;
      }
    }

    app.log.info(`[DataMigration] ✅ CPF/CNPJ: ${ok} criptografados, ${fail} erros`);
  } catch (e: any) {
    // Não bloqueia o startup se a migração falhar
    app.log.warn(`[DataMigration] Falha na migração de CPF/CNPJ: ${e.message}`);
  }
}

async function start() {
  try {
    // ── C1: Validações de startup — fail-fast em produção ───────────────────
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.ASAAS_WEBHOOK_TOKEN) {
        app.log.error('[Startup] FATAL: ASAAS_WEBHOOK_TOKEN não configurado. Qualquer requisição pode ativar planos pagos. Configure no Render e redeploy.');
        process.exit(1);
      }
      if (!process.env.EVOLUTION_WEBHOOK_SECRET) {
        // A4: Não fatal (Evolution pode ser opcional), mas alertar claramente
        app.log.warn('[Startup] ⚠️  EVOLUTION_WEBHOOK_SECRET não configurado — webhook Evolution sem autenticação! Qualquer IP pode injetar conversões.');
      }
      if (!process.env.JWT_SECRET) {
        app.log.error('[Startup] FATAL: JWT_SECRET não configurado.');
        process.exit(1);
      }
      // H6: Variáveis críticas de autenticação interna
      if (!process.env.ADMIN_TOKEN) {
        app.log.error('[Startup] FATAL: ADMIN_TOKEN não configurado — painel administrativo inacessível.');
        process.exit(1);
      }
      if (!process.env.INTERNAL_TOKEN) {
        app.log.error('[Startup] FATAL: INTERNAL_TOKEN não configurado — worker não consegue comunicar com a API.');
        process.exit(1);
      }
      // H6: Encryption key
      if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
        app.log.error('[Startup] FATAL: ENCRYPTION_KEY inválida. Deve ter 64 caracteres hex.');
        process.exit(1);
      }
    }

    await runAutoMigrations();
    await runDocumentEncryptionMigration();
    await app.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });

    // ── Sync automático Evolution API — re-aplica webhooks e auto-reconecta ──
    // Roda em background. Sem o isolamento destrutivo do Z-API — cada instância
    // é naturalmente dedicada a um único usuário.
    syncAllEvolutionConfigs(app.log).catch(err =>
      app.log.error({ err: err.message }, '[Evolution Sync] Erro no sync de startup')
    );

    // ── Heartbeat Evolution — verifica a cada 5min / webhook sync a cada 1h ──
    startHeartbeat(app.log);

    // ── Health Monitor — verifica todos os serviços a cada 1h, alerta e sugere otimizações ──
    startHealthMonitor(app.log);

    // ── E-mails de ciclo de vida — ativação D1/D3 e upgrade por uso, 1x/dia ──
    startLifecycleEmails(app.log);

    app.log.info(`🚀 ZapScript API rodando na porta ${process.env.PORT || 3001}`);

    // ✅ Usando WhatsApp Cloud API (Meta) em vez de Baileys
    // Baileys foi descontinuado; usando API oficial agora
    if (process.env.WHATSAPP_API_TOKEN) {
      app.log.info('✅ Usando WhatsApp Cloud API (Meta) oficial');
      // Não precisa reconectar sessões - webhook recebe mensagens automaticamente
    } else {
      app.log.info('ℹ️ WHATSAPP_API_TOKEN não configurado — modo Evolution API');
    }

    // Comentado: reconexão de Baileys já não é necessária
    // reconnectAllSessions().then(() => {
    //   app.log.info('📱 Sessões WhatsApp reconectadas');
    // }).catch((e) => app.log.error({ err: e }, 'Erro ao reconectar sessões'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  app.log.info('Shutting down...');
  const forceExit = setTimeout(() => {
    app.log.error('Graceful shutdown timeout — forçando saída');
    process.exit(1);
  }, 30_000);
  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    clearTimeout(forceExit);
    process.exit(1);
  }
});

start();
