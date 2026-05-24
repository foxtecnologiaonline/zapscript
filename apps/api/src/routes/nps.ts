import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function npsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // POST /nps/submit — envia resposta NPS do usuário
  // Limitado a 1 resposta por usuário a cada 90 dias
  app.post<{ Body: { score: number; comment?: string } }>(
    '/submit',
    { ...auth, schema: { body: { type: 'object' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { score, comment } = req.body;

      if (typeof score !== 'number' || score < 0 || score > 10 || !Number.isInteger(score)) {
        return reply.code(400).send({ error: 'Score deve ser inteiro entre 0 e 10.' });
      }
      if (comment && typeof comment !== 'string') {
        return reply.code(400).send({ error: 'Comment deve ser string.' });
      }
      const trimmedComment = comment ? comment.trim().slice(0, 500) : null;

      // Verifica se já respondeu nos últimos 90 dias
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const existing = await (prisma as any).npsResponse.findFirst({
        where: { userId, createdAt: { gte: since } },
      });
      if (existing) {
        return reply.code(429).send({ error: 'Você já respondeu ao NPS recentemente. Obrigado!' });
      }

      const response = await (prisma as any).npsResponse.create({
        data: { userId, score, comment: trimmedComment },
      });

      return reply.code(201).send({ ok: true, id: response.id });
    }
  );

  // GET /nps/status — verifica se o usuário já respondeu (para saber se mostra o modal)
  app.get('/status', auth, async (req: any) => {
    const userId = req.user.sub;

    // Conta transcrições do usuário (NPS dispara após a 5ª)
    const txCount = await prisma.transcription.count({ where: { userId } });

    // Verifica última resposta
    const since  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recent = await (prisma as any).npsResponse.findFirst({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true },
    });

    return {
      shouldShow:         txCount >= 5 && !recent,
      transcriptionCount: txCount,
      lastResponseAt:     recent?.createdAt ?? null,
    };
  });
}
