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
import { redis } from './services/queue';
import { prisma } from './lib/prisma';
import { syncAllZapiConfigs } from './services/zapi-sync';

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
});

// Ignorar ECONNRESET no servidor HTTP (clientes que fecham conexão — comportamento normal)
app.server.on('error', (err: any) => {
  if (err.code === 'ECONNRESET') return;
  app.log.error(err, 'Server error');
});

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

// CORS origin: use APP_URL in production, localhost in dev
const allowedOrigin = process.env.APP_URL
  || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : false);

// Attach Socket.IO to Fastify's underlying http.Server
export const io = new SocketServer(app.server, {
  cors:       { origin: allowedOrigin, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],  // aceita polling e ws
  pingTimeout:  60000,   // 60s antes de considerar desconectado
  pingInterval: 25000,   // heartbeat a cada 25s (evita timeout do Render)
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
});

app.register(cors, {
  origin: allowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
});
app.register(jwt, { secret: process.env.JWT_SECRET! });

// Rate limit com store em memória (não depende de Redis)
// Se Redis estiver indisponível, o rate limit continua funcionando
app.register(rateLimit, {
  max:        100,
  timeWindow: '1 minute',
  // Sem redis store — usa memória local para não travar quando Redis falha
  // store: undefined,  ← padrão in-memory
  addHeaders: {
    'x-ratelimit-limit':     true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset':     true,
    'retry-after':           true,
  },
  errorResponseBuilder: (_req, context) => ({
    error:      'Muitas requisições. Tente novamente em breve.',
    retryAfter: context.after,
  }),
});
app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// ── Swagger/OpenAPI Documentation — somente em desenvolvimento ─────────────
if (process.env.NODE_ENV !== 'production') {
  app.register(swagger, {
    swagger: {
      info: {
        title: 'ZapScript API',
        description: 'API de transcrição automática de áudios do WhatsApp',
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
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

app.decorate('authenticate', async function (req: any, reply: any) {
  try { await req.jwtVerify(); }
  catch { reply.code(401).send({ error: 'Unauthorized' }); }
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
app.register(import('./routes/privacy'),        { prefix: '/privacy' });

// ── WhatsApp Webhook (Meta Cloud API) ──────────────────────
// Registrar sempre — webhook precisa responder para validação mesmo sem token configurado
app.register(import('./routes/whatsapp-webhook'), { prefix: '/webhook/whatsapp' });

// ── WhatsApp Webhook (Twilio BSP) ───────────────────────────
// Alternativa BSP para testes sem aprovação Meta
app.register(import('./routes/twilio-webhook'), { prefix: '/webhook/twilio' });

// ── WhatsApp Webhook (Z-API — dispositivo adicional) ────────
// Intercepta todos os áudios recebidos no número conectado
app.register(import('./routes/zapi-webhook'), { prefix: '/webhook/zapi' });
if (process.env.WHATSAPP_API_TOKEN) {
  app.log.info('✅ WhatsApp Cloud API webhook registrado com token');
} else {
  app.log.warn('⚠️ WHATSAPP_API_TOKEN não configurado - envio desabilitado, recebimento ativo');
}

app.get('/health', async (_, reply) => {
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

  const payload = {
    status: healthy ? 'ok' : 'degraded',
    ts:     new Date().toISOString(),
    app:    process.env.APP_NAME || 'ZapScript',
    env:    process.env.NODE_ENV,
    checks,
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
    // Remove unique constraint em zapiInstanceId — múltiplos usuários compartilham a mesma instância Z-API
    `DROP INDEX IF EXISTS "WhatsappNumber_zapiInstanceId_key"`,
  ];
  for (const sql of migrations) {
    await prisma.$executeRawUnsafe(sql).catch((e: any) =>
      app.log.warn(`[AutoMigration] ${e.message}`)
    );
  }
  app.log.info('[AutoMigration] ✅ Colunas Z-API verificadas');
}

async function start() {
  try {
    await runAutoMigrations();
    await app.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });

    // ── Sync automático Z-API — aplica webhooks/auto-read em todos números conectados ──
    // Roda em background para não atrasar o startup. Detecta mudanças de instância
    // (ex: Trial → Pago) sem precisar que usuários reconectem.
    syncAllZapiConfigs(app.log).catch(err =>
      app.log.error({ err: err.message }, '[Z-API Sync] Erro no sync de startup')
    );
    app.log.info(`🚀 ZapScript API rodando na porta ${process.env.PORT || 3001}`);

    // ✅ Usando WhatsApp Cloud API (Meta) em vez de Baileys
    // Baileys foi descontinuado; usando API oficial agora
    if (process.env.WHATSAPP_API_TOKEN) {
      app.log.info('✅ Usando WhatsApp Cloud API (Meta) oficial');
      // Não precisa reconectar sessões - webhook recebe mensagens automaticamente
    } else {
      app.log.warn('⚠️ WHATSAPP_API_TOKEN não configurado');
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
