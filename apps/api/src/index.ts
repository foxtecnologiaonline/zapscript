import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { reconnectAllSessions } from './services/whatsapp';
import { redis } from './services/queue';

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

const httpServer = createServer(app.server);

// CORS: aceitar apenas a origin configurada; em dev fallback para localhost
const allowedOrigin = process.env.APP_URL
  || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : false);

export const io = new SocketServer(httpServer, {
  cors: { origin: allowedOrigin, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  socket.on('join', ({ userId }: { userId: string }) => {
    socket.join(`user:${userId}`);
  });
});

app.register(cors, { origin: allowedOrigin, credentials: true });
app.register(jwt, { secret: process.env.JWT_SECRET! });
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

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

app.get('/health', async (_, reply) => {
  try {
    await redis.ping();
    return {
      status: 'ok',
      ts:     new Date().toISOString(),
      app:    process.env.APP_NAME || 'ZapScript',
      env:    process.env.NODE_ENV,
    };
  } catch {
    return reply.code(503).send({ status: 'error', reason: 'Redis unreachable' });
  }
});

async function start() {
  try {
    await app.ready();
    httpServer.listen(
      { port: Number(process.env.PORT) || 3001, host: '0.0.0.0' },
      (err) => {
        if (err) { app.log.error(err); process.exit(1); }
        app.log.info(`🚀 ZapScript API rodando na porta ${process.env.PORT || 3001}`);
        reconnectAllSessions().then(() => {
          app.log.info('📱 Sessões WhatsApp reconectadas');
        }).catch((e) => app.log.error(e, 'Erro ao reconectar sessões'));
      }
    );
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
