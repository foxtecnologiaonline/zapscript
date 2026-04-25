import { FastifyInstance } from 'fastify';
import { getSession } from '../services/whatsapp';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';

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

  // POST /internal/send — Worker envia mensagem WhatsApp
  app.post<{ Body: { numberId: string; jid: string; text: string } }>(
    '/send',
    { preHandler: [verifyToken] },
    async (req, reply) => {
      const { numberId, jid, text } = req.body;
      if (!numberId || !jid || !text) {
        return reply.code(400).send({ error: 'numberId, jid e text são obrigatórios' });
      }
      const sock = getSession(numberId);
      if (!sock) {
        return reply.code(404).send({ error: `Sessão ${numberId} não encontrada` });
      }
      await sock.sendMessage(jid, { text });
      return { sent: true };
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
    async (req, reply) => {
      const { service, message, stack, context } = req.body;
      await prisma.systemError.create({ data: { service, message, stack, context } });
      return { logged: true };
    }
  );
}
