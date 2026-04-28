import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { createWASession, disconnectWASession, getPendingQR } from '../services/whatsapp';

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
  app.post<{ Body: { displayName: string } }>('/', auth, async (req: any, reply) => {
    const { displayName } = req.body;
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

    const number = await prisma.whatsappNumber.create({
      data: { userId, displayName },
    });

    return reply.code(201).send(number);
  });

  // ── PATCH /numbers/:id ───────────────────────────────
  app.patch<{ Params: { id: string }; Body: { displayName: string } }>('/:id', auth, async (req: any, reply) => {
    const { id } = req.params;
    const { displayName } = req.body;

    if (!displayName?.trim()) {
      return reply.code(400).send({ error: 'displayName é obrigatório.' });
    }

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId: req.user.sub } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

    return prisma.whatsappNumber.update({
      where: { id },
      data:  { displayName: displayName.trim() },
    });
  });

  // ── POST /numbers/:id/connect ─────────────────────────
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    // Verify ownership
    const number = await prisma.whatsappNumber.findFirst({
      where: { id, userId },
    });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    await createWASession(id, userId);
    return { status: 'connecting', message: 'QR Code será enviado via WebSocket' };
  });

  // ── GET /numbers/:id/qr ───────────────────────────────
  // REST fallback: returns the cached raw QR string so the frontend can
  // poll for it if the Socket.IO event was missed.
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const pending = getPendingQR(userId);
    if (!pending || pending.numberId !== id) {
      return reply.code(404).send({ qr: null, message: 'Nenhum QR pendente' });
    }
    return { qr: pending.qr };
  });

  // ── POST /numbers/:id/disconnect ──────────────────────
  app.post<{ Params: { id: string } }>('/:id/disconnect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    await disconnectWASession(id);
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

    await disconnectWASession(id).catch(() => {});
    await prisma.whatsappNumber.delete({ where: { id } });
    return reply.code(204).send();
  });
}
