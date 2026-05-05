import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

/**
 * LGPD/GDPR Compliance Routes
 * Endpoints para exportação e deleção de dados do usuário
 * Lei Geral de Proteção de Dados (LGPD) - Lei 13.709/2018
 */

export default async function privacyRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /privacy/export ────────────────────────────────────
  // Exportar todos os dados do usuário em formato JSON
  // Cumprimento do direito de acesso (LGPD Art. 18)
  app.get(
    '/export',
    { ...auth },
    async (req: any, reply) => {
      const userId = req.user.sub;

      try {
        const [user, numbers, transcriptions, subscriptions, auditLogs] =
          await Promise.all([
            prisma.user.findUnique({
              where: { id: userId },
              select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                updatedAt: true,
              },
            }),
            prisma.whatsappNumber.findMany({
              where: { userId },
              select: {
                id: true,
                phoneNumber: true,
                status: true,
                connectedAt: true,
                lastMessageAt: true,
                createdAt: true,
              },
            }),
            prisma.transcription.findMany({
              where: { userId },
              select: {
                id: true,
                originalText: true,
                language: true,
                durationSec: true,
                confidenceScore: true,
                createdAt: true,
              },
              take: 1000,
            }),
            prisma.subscription.findMany({
              where: { userId },
              select: {
                id: true,
                plan: { select: { name: true, minutesPerMonth: true } },
                status: true,
                currentPeriodEnd: true,
                createdAt: true,
              },
            }),
            prisma.auditLog.findMany({
              where: { targetUserId: userId },
              select: {
                id: true,
                action: true,
                timestamp: true,
                metadata: true,
              },
              take: 500,
              orderBy: { timestamp: 'desc' },
            }),
          ]);

        if (!user) {
          return reply.code(404).send({ error: 'Usuário não encontrado' });
        }

        // Log de exportação
        await prisma.auditLog.create({
          data: {
            action: 'DATA_EXPORT_REQUESTED',
            targetUserId: userId,
            adminId: 'system',
            metadata: { exportedAt: new Date().toISOString() },
          },
        });

        const exportData = {
          exportedAt: new Date().toISOString(),
          exportFormat: 'JSON',
          LGPD: {
            law: 'Lei Geral de Proteção de Dados (Lei 13.709/2018)',
            right: 'Direito de acesso (Art. 18)',
            description:
              'Você solicitou cópia dos seus dados pessoais armazenados',
          },
          user,
          data: {
            numbers,
            transcriptions,
            subscriptions,
            auditLog: auditLogs,
          },
        };

        reply.header('Content-Disposition', 'attachment; filename="zapscript-data-export.json"');
        return exportData;
      } catch (error) {
        app.log.error({ error, userId }, 'Erro ao exportar dados');
        return reply
          .code(500)
          .send({ error: 'Erro ao exportar dados do usuário' });
      }
    }
  );

  // ── DELETE /privacy/delete ────────────────────────────────
  // Deletar TODOS os dados do usuário (IRREVERSÍVEL)
  // Cumprimento do direito ao esquecimento (LGPD Art. 17)
  app.delete(
    '/delete',
    { ...auth },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { confirmDeletion } = req.body as { confirmDeletion?: boolean };

      if (!confirmDeletion) {
        return reply.code(400).send({
          error: 'Confirmação de deleção obrigatória',
          message: 'Envie { "confirmDeletion": true } para confirmar',
        });
      }

      try {
        // Transação atômica
        await prisma.$transaction([
          prisma.transcription.deleteMany({ where: { userId } }),
          prisma.whatsappNumber.deleteMany({ where: { userId } }),
          prisma.minuteBalance.deleteMany({ where: { userId } }),
          prisma.subscription.deleteMany({ where: { userId } }),
          prisma.auditLog.create({
            data: {
              action: 'USER_DATA_DELETED_BY_REQUEST',
              targetUserId: userId,
              adminId: 'system',
              metadata: { deletedAt: new Date().toISOString(), reason: 'LGPD Art. 17' },
            },
          }),
          prisma.user.delete({ where: { id: userId } }),
        ]);

        app.log.info({ userId }, 'Usuário deletado (LGPD Art. 17)');
        return reply.code(200).send({
          success: true,
          message: 'Dados deletados conforme LGPD Art. 17',
          deletedAt: new Date().toISOString(),
        });
      } catch (error) {
        app.log.error({ error, userId }, 'Erro ao deletar');
        return reply.code(500).send({ error: 'Erro ao deletar dados' });
      }
    }
  );

  // ── GET /privacy/audit-log ────────────────────────────────
  app.get('/audit-log', { ...auth }, async (req: any, reply) => {
    const userId = req.user.sub;
    const { page = 1, limit = 50 } = req.query as { page?: number; limit?: number };

    try {
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { targetUserId: userId },
          select: { id: true, action: true, timestamp: true, metadata: true },
          orderBy: { timestamp: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where: { targetUserId: userId } }),
      ]);

      return {
        items: logs,
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      app.log.error({ error }, 'Erro ao buscar audit log');
      return reply.code(500).send({ error: 'Erro ao buscar histórico' });
    }
  });
}
