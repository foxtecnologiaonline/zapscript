import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { Server as SocketServer } from 'socket.io';
// Baileys foi descontinuado - agora usando Meta Cloud API
// import { reconnectAllSessions, getPendingQR } from './services/whatsapp';
import { redis } from './services/queue';
import { prisma } from './lib/prisma';

const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
});

// Preserve raw body for webhook verification
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    try {
      (req as any).rawBody = body;
      done(null, JSON.parse(body.toString()));
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

io.on('connection', (socket) => {
  socket.on('join', ({ userId }: { userId: string }) => {
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

app.register(cors, { origin: allowedOrigin, credentials: true });
app.register(jwt, { secret: process.env.JWT_SECRET! });
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

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
app.register(import('./routes/admin'),          { prefix: '/admin' });

// ── WhatsApp Webhook (Meta Cloud API) ──────────────────────
if (process.env.WHATSAPP_API_TOKEN) {
  app.register(import('./routes/whatsapp-webhook'), { prefix: '/webhook/whatsapp' });
  app.log.info('✅ WhatsApp Cloud API webhook registrado');
} else {
  app.log.warn('⚠️ WHATSAPP_API_TOKEN não configurado - webhook desabilitado');
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

async function start() {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });
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
