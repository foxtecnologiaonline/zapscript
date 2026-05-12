import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

// ── Z-API helper ──────────────────────────────────────────────
function zapiUrl(path: string): string {
  const id    = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  if (!id || !token) throw new Error('ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurados');
  return `https://api.z-api.io/instances/${id}/token/${token}${path}`;
}

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
  app.patch<{ Params: { id: string }; Body: { displayName?: string } }>(
    '/:id',
    auth,
    async (req: any, reply) => {
      const { id } = req.params;
      const { displayName } = req.body;

      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId: req.user.sub } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

      const trimmed = displayName?.trim();
      if (!trimmed) return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      if (trimmed.length > 50) return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });

      return prisma.whatsappNumber.update({ where: { id }, data: { displayName: trimmed } });
    }
  );

  // ── POST /numbers/:id/connect — Inicia conexão Z-API (QR Code) ──
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (!process.env.ZAPI_INSTANCE_ID || !process.env.ZAPI_TOKEN) {
      return reply.code(503).send({ error: 'Z-API não configurada no servidor.' });
    }

    // Vincular instância Z-API a este número e marcar como conectando
    await prisma.whatsappNumber.update({
      where: { id },
      data:  { zapiInstanceId: process.env.ZAPI_INSTANCE_ID, status: 'connecting' },
    });

    return { ok: true, message: 'Pronto para escanear o QR Code.' };
  });

  // ── GET /numbers/:id/qr — Retorna QR Code da Z-API como base64 ──
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    try {
      // Z-API retorna imagem PNG diretamente
      const res = await fetch(zapiUrl('/qr-code/image'));
      if (!res.ok) {
        // Se já está conectado, Z-API retorna 4xx — verificar status
        return reply.code(204).send(); // sem QR = já conectado
      }
      const buf    = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      return { qr: `data:image/png;base64,${base64}` };
    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao buscar QR');
      return reply.code(502).send({ error: 'Erro ao obter QR Code da Z-API.' });
    }
  });

  // ── GET /numbers/:id/zapi-status — Verifica se Z-API está conectada ──
  app.get<{ Params: { id: string } }>('/:id/zapi-status', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    try {
      const res  = await fetch(zapiUrl('/status'));
      const data = await res.json() as any;

      const connected = data?.connected === true;

      // Sincronizar status no banco se mudou
      if (connected && number.status !== 'connected') {
        await prisma.whatsappNumber.update({
          where: { id },
          data:  { status: 'connected', connectedAt: new Date() },
        });
      } else if (!connected && number.status === 'connected') {
        await prisma.whatsappNumber.update({
          where: { id },
          data:  { status: 'disconnected' },
        });
      }

      return { connected, phone: data?.phone || number.phoneNumber };
    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao verificar status');
      return { connected: false };
    }
  });

  // ── POST /numbers/:id/disconnect ──────────────────────
  app.post<{ Params: { id: string } }>('/:id/disconnect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    // Desconectar da Z-API se vinculado
    if (number.zapiInstanceId && process.env.ZAPI_TOKEN) {
      try {
        await fetch(zapiUrl('/disconnect'), { method: 'DELETE' });
      } catch (err: any) {
        app.log.warn({ err: err.message }, '[Z-API] Erro ao desconectar instância');
      }
    }

    await prisma.whatsappNumber.update({
      where: { id },
      data:  { status: 'disconnected', zapiInstanceId: null },
    });
    return { status: 'disconnected' };
  });

  // ── DELETE /numbers/:id ───────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    try {
      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      await prisma.whatsappNumber.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err: any) {
      app.log.error({ err: err.message, id, userId }, '[Numbers] Erro ao deletar número');
      return reply.code(500).send({ error: err.message || 'Erro ao deletar número.' });
    }
  });
}
