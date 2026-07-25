import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

/**
 * Histórico/auditoria do Comando de Voz Universal — transparência LGPD: o usuário
 * pode ver toda ação que a IA tomou sozinha em seu nome a partir de self-notes.
 * Sem requireModule: o comando de voz não é um módulo próprio, é um recurso
 * transversal que só age quando o módulo alvo (CRM/Atende) já está ativo.
 */
export default async function voiceCommandsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /voice-commands ───────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>('/', auth, async (req: any) => {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 100);

    return prisma.voiceCommand.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select: {
        id: true, intent: true, status: true, rawText: true,
        resultSummary: true, confidence: true, createdAt: true,
      },
    });
  });
}
