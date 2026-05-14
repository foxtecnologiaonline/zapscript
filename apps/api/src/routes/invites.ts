import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function invitesRoutes(app: FastifyInstance) {

  // GET /invites/validate/:code — valida código de convite publicamente (sem auth)
  app.get<{ Params: { code: string } }>(
    '/validate/:code',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { code } = req.params;
      if (!code || code.length > 64) {
        return reply.code(400).send({ valid: false, error: 'Código inválido.' });
      }

      const invite = await prisma.testerInvite.findUnique({
        where: { code },
        select: { id: true, name: true, code: true, usedAt: true },
      });

      if (!invite) {
        return { valid: false, error: 'Código de convite não encontrado.' };
      }

      if (invite.usedAt) {
        return { valid: false, error: 'Este convite já foi utilizado.' };
      }

      return { valid: true, invite: { name: invite.name, code: invite.code } };
    }
  );
}
