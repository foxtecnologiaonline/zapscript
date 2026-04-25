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
 * Rota interna usada pelo Monitor Agent para enviar alertas via WhatsApp.
 * Protegida por MONITOR_TOKEN (não usa JWT de usuário).
 */
export default async function monitorRoutes(app: FastifyInstance) {

  const verifyToken = async (req: any, reply: any) => {
    const token = req.headers['x-monitor-token'] as string | undefined;
    if (!safeCompare(token, process.env.MONITOR_TOKEN)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };

  // ── POST /monitor/alert ───────────────────────────────────
  app.post<{
    Body: { phone: string; message: string }
  }>('/alert', { preHandler: [verifyToken] }, async (req, reply) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return reply.code(400).send({ error: 'phone e message são obrigatórios' });
    }

    // Pegar qualquer número conectado para enviar o alerta
    const number = await prisma.whatsappNumber.findFirst({
      where: { status: 'connected' },
    });

    if (!number) {
      return reply.code(503).send({ error: 'Nenhum número WhatsApp conectado para enviar alerta' });
    }

    const sock = getSession(number.id);
    if (!sock) {
      return reply.code(503).send({ error: 'Sessão WhatsApp não disponível' });
    }

    const jid = `${phone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });

    app.log.info(`📱 Alerta de monitor enviado para ${phone}`);
    return { sent: true, via: number.phoneNumber };
  });

  // ── GET /monitor/status ───────────────────────────────────
  app.get('/status', { preHandler: [verifyToken] }, async () => {
    const [users, numbers, transcriptions] = await Promise.all([
      prisma.user.count(),
      prisma.whatsappNumber.count({ where: { status: 'connected' } }),
      prisma.transcription.count(),
    ]);

    return {
      status: 'ok',
      ts: new Date().toISOString(),
      stats: { users, activeNumbers: numbers, totalTranscriptions: transcriptions },
    };
  });
}
