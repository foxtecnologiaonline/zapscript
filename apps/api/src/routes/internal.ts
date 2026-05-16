import { FastifyInstance } from 'fastify';
import { whatsappAPI } from '../services/whatsapp-official';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import { io } from '../index';

function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Rotas internas usadas pelo Worker e Monitor.
 * Autenticadas por INTERNAL_TOKEN (não JWT de usuário).
 */
export default async function internalRoutes(app: FastifyInstance) {

  const verifyToken = async (req: any, reply: any) => {
    const token = req.headers['x-internal-token'] as string | undefined;
    if (!safeCompare(token, process.env.INTERNAL_TOKEN)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };

  // POST /internal/send — Worker envia mensagem WhatsApp via Meta Cloud API
  app.post<{ Body: { numberId?: string; phone: string; text: string } }>(
    '/send',
    { preHandler: [verifyToken], config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { phone, text } = req.body;
      if (!phone || !text) {
        return reply.code(400).send({ error: 'phone e text são obrigatórios' });
      }

      try {
        const messageId = await whatsappAPI.sendMessage(phone, text);
        return { sent: true, messageId };
      } catch (err: any) {
        app.log.error({ err: err.message }, '[Internal] Erro ao enviar mensagem via Meta API');
        return reply.code(502).send({ error: `Erro ao enviar: ${err.message}` });
      }
    }
  );

  // GET /internal/status — Worker verifica se API está acessível
  app.get('/status', { preHandler: [verifyToken] }, async () => {
    const [users, connected, transcriptions] = await Promise.all([
      prisma.user.count(),
      prisma.whatsappNumber.count({ where: { status: 'connected' } }),
      prisma.transcription.count(),
    ]);
    return { ok: true, users, connected, transcriptions };
  });

  // POST /internal/log-error — Worker e Monitor registram erros
  app.post<{ Body: { service: string; message: string; stack?: string; context?: any } }>(
    '/log-error',
    { preHandler: [verifyToken] },
    async (req) => {
      const { service, message, stack, context } = req.body;
      await prisma.systemError.create({ data: { service, message, stack, context } });
      return { logged: true };
    }
  );

  // POST /internal/emit — Worker emite evento Socket.IO para o frontend
  // Permite notificar o dashboard em tempo real quando uma transcrição é concluída.
  app.post<{ Body: { userId: string; event: string; data?: any } }>(
    '/emit',
    { preHandler: [verifyToken], config: { rateLimit: { max: 500, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { userId, event, data } = req.body;
      if (!userId || !event) {
        return reply.code(400).send({ error: 'userId e event são obrigatórios' });
      }
      // Emite para a sala do usuário — apenas o socket autenticado desse usuário recebe
      io.to(`user:${userId}`).emit(event, data ?? {});
      return { emitted: true, room: `user:${userId}`, event };
    }
  );
}
