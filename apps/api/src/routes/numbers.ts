import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
// NOTA: Baileys foi descontinuado em favor da Meta Cloud API (webhook-based)
// As funções abaixo não são mais usadas:
// import { createWASession, disconnectWASession, getPendingQR, getPendingPairingCode, requestWAPairingCode } from '../services/whatsapp';

export default async function numberRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /numbers ──────────────────────────────────────
  app.get('/', auth, async (req: any) => {
    return prisma.whatsappNumber.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'asc' },
    });
  });

  // ── POST /numbers ─────────────────────────────────────
  app.post<{ Body: { displayName: string; phoneNumber?: string } }>('/', auth, async (req: any, reply) => {
    const { displayName, phoneNumber } = req.body;
    const userId = req.user.sub;

    // Check plan limit
    const sub = await prisma.subscription.findUnique({
      where:   { userId },
      include: { plan: true },
    });
    const count = await prisma.whatsappNumber.count({ where: { userId } });

    if (count >= sub!.plan.maxNumbers) {
      return reply.code(403).send({
        error: `Limite de ${sub!.plan.maxNumbers} número(s) atingido. Faça upgrade do plano.`,
      });
    }

    // Sanitize optional phone: digits only, or leave as 'pending'
    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : undefined;

    const number = await prisma.whatsappNumber.create({
      data: {
        userId,
        displayName,
        ...(cleanPhone ? { phoneNumber: cleanPhone } : {}),
      },
    });

    return reply.code(201).send(number);
  });

  // ── PATCH /numbers/:id ───────────────────────────────
  app.patch<{ Params: { id: string }; Body: { displayName?: string; phoneNumber?: string } }>(
    '/:id',
    auth,
    async (req: any, reply) => {
      const { id } = req.params;
      const { displayName, phoneNumber } = req.body;

      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId: req.user.sub } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

      const data: Record<string, string> = {};
      if (displayName?.trim())  data.displayName = displayName.trim();
      if (phoneNumber)          data.phoneNumber  = phoneNumber.replace(/\D/g, '');

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      }

      return prisma.whatsappNumber.update({ where: { id }, data });
    }
  );

  // ── POST /numbers/:id/connect — DESCONTINUADO (era Baileys QR Code) ──────────
  // Agora usando Meta Cloud API com webhook
  // A conexão é feita via webhooks — configure em: https://developers.facebook.com
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (_, reply) => {
    return reply.code(410).send({
      error: 'Método descontinuado',
      message: 'QR Code connection foi substituído pela Meta Cloud API',
      instructions: 'Configure o webhook no dashboard Meta: https://developers.facebook.com',
      docs: 'Ver ENV.md para instruções de setup',
    });
  });

  // ── POST /numbers/:id/connect-pairing — DESCONTINUADO (era Baileys pairing code) ──
  // Agora usando Meta Cloud API com webhook
  app.post<{
    Params: { id: string };
    Body: { phoneNumber: string };
  }>('/:id/connect-pairing', auth, async (_, reply) => {
    return reply.code(410).send({
      error: 'Método descontinuado',
      message: 'Pairing code connection foi substituído pela Meta Cloud API',
      instructions: 'Configure o webhook no dashboard Meta: https://developers.facebook.com',
      docs: 'Ver ENV.md para instruções de setup',
    });
  });

  // ── GET /numbers/:id/qr — DESCONTINUADO (era Baileys) ───────
  // Agora usando Meta Cloud API com webhook
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (_, reply) => {
    return reply.code(410).send({
      error: 'Método descontinuado',
      message: 'QR Code retrieval foi substituído pela Meta Cloud API',
      instructions: 'Configure o webhook no dashboard Meta: https://developers.facebook.com',
    });
  });

  // ── GET /numbers/:id/pairing-code — DESCONTINUADO (era Baileys) ──
  // Agora usando Meta Cloud API com webhook
  app.get<{ Params: { id: string } }>('/:id/pairing-code', auth, async (_, reply) => {
    return reply.code(410).send({
      error: 'Método descontinuado',
      message: 'Pairing code retrieval foi substituído pela Meta Cloud API',
      instructions: 'Configure o webhook no dashboard Meta: https://developers.facebook.com',
    });
  });

  // ── POST /numbers/:id/disconnect ──────────────────────
  app.post<{ Params: { id: string } }>('/:id/disconnect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    // Com Meta Cloud API, não precisa desconectar sessão Baileys
    await prisma.whatsappNumber.update({
      where: { id },
      data:  { status: 'disconnected', sessionEncrypted: null },
    });
    return { status: 'disconnected' };
  });

  // ── DELETE /numbers/:id ───────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    // Com Meta Cloud API, não precisa desconectar sessão Baileys
    await prisma.whatsappNumber.delete({ where: { id } });
    return reply.code(204).send();
  });
}
