import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { transcriptionQueue } from '../services/queue';

export default async function transcriptionRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /transcriptions ───────────────────────────────
  app.get<{
    Querystring: { limit?: string; offset?: string; numberId?: string; search?: string }
  }>('/', auth, async (req: any) => {
    const userId   = req.user.sub;
    const limit    = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
    const offset   = Math.max(parseInt(req.query.offset || '0') || 0, 0);
    const numberId = req.query.numberId;
    const search   = req.query.search;

    const where: any = { userId };
    if (numberId) where.numberId = numberId;
    if (search)   where.originalText = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.transcription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
        include: { number: { select: { displayName: true, phoneNumber: true } } },
      }),
      prisma.transcription.count({ where }),
    ]);
    return { items, total, limit, offset };
  });

  // ── GET /transcriptions/:id ───────────────────────────
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const t = await prisma.transcription.findFirst({
      where:   { id: req.params.id, userId: req.user.sub },
      include: { number: true },
    });
    if (!t) return reply.code(404).send({ error: 'Não encontrado' });
    return t;
  });

  // ── DELETE /transcriptions/:id ────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const t = await prisma.transcription.findFirst({ where: { id: req.params.id, userId: req.user.sub } });
    if (!t) return reply.code(404).send({ error: 'Não encontrado' });
    await prisma.transcription.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // ── POST /transcriptions/upload — envio manual ────────
  app.post('/upload', auth, async (req: any, reply) => {
    const userId = req.user.sub;

    // Verificar saldo de minutos
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || balance.availableMinutes < 0.5) {
      return reply.code(402).send({ error: 'Saldo de minutos insuficiente. Faça upgrade do plano.' });
    }

    // Receber arquivo via multipart
    const data   = await req.file();
    if (!data) return reply.code(400).send({ error: 'Arquivo não recebido' });

    const buffer   = await data.toBuffer();
    const filename = data.filename || 'audio.ogg';
    const allowed  = ['.ogg','.mp3','.mp4','.m4a','.wav','.webm','.mpeg'];
    const ext      = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: `Formato não suportado. Use: ${allowed.join(', ')}` });
    }
    if (buffer.length > 50 * 1024 * 1024) {
      return reply.code(400).send({ error: 'Arquivo muito grande. Máximo: 50MB' });
    }

    // Buscar qualquer número do usuário (conectado ou não) para associar a transcrição
    const number = await prisma.whatsappNumber.findFirst({ where: { userId } });
    if (!number) {
      return reply.code(400).send({ error: 'Adicione ao menos um número WhatsApp no painel antes de enviar áudios manualmente.' });
    }

    // Enfileirar job de transcrição manual
    await transcriptionQueue.add('transcribe-manual', {
      userId,
      numberId:    number.id,
      audioBase64: buffer.toString('base64'),
      filename,
      source:      'manual',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    return reply.code(202).send({ queued: true, message: 'Áudio enfileirado. A transcrição chegará em instantes.' });
  });
}
