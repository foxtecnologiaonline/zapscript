import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';

/**
 * LGPD/GDPR Compliance Routes
 * Endpoints para exportação e deleção de dados do usuário
 * Lei Geral de Proteção de Dados (LGPD) - Lei 13.709/2018
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const TERMS_OF_SERVICE = {
  version:       '2.0',
  effectiveFrom: '2025-06-01T00:00:00.000Z',
  content:       'Termos de Serviço do ZapScript — versão vigente. Texto completo em https://www.zapscript.me/termos.',
};

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

        const exportedAt = new Date();
        const expiresAt  = new Date(exportedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

        const exportData = {
          exportedAt:   exportedAt.toISOString(),
          expiresAt:    expiresAt.toISOString(),
          exportFormat: 'JSON',
          LGPD: {
            law: 'Lei Geral de Proteção de Dados (Lei 13.709/2018)',
            right: 'Direito de acesso (Art. 18)',
            description:
              'Você solicitou cópia dos seus dados pessoais armazenados',
          },
          user,
          transcriptions,
          whatsappNumbers: numbers,
          subscriptions,
          auditLog: auditLogs,
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

  // ── POST /privacy/meta-deletion ──────────────────────────
  // Chamado pelo Next.js quando chega callback da Meta (server-to-server).
  // Requer header Authorization: Bearer INTERNAL_API_SECRET
  app.post<{ Body: { user_id: string; request_id: string; confirmation_code: string } }>(
    '/meta-deletion',
    async (req: any, reply) => {
      // Verificar segredo interno
      const authHeader = req.headers.authorization as string | undefined;
      const internalSecret = process.env.INTERNAL_API_SECRET;
      if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { user_id, request_id, confirmation_code } = req.body;
      if (!user_id || !request_id || !confirmation_code) {
        return reply.code(400).send({ error: 'user_id, request_id e confirmation_code são obrigatórios.' });
      }

      // Gravar no AuditLog para rastreabilidade/conformidade
      await prisma.auditLog.create({
        data: {
          action:      'META_DATA_DELETION_REQUEST',
          adminId:     'meta-platform',
          metadata:    {
            metaUserId:       user_id,
            metaRequestId:    request_id,
            confirmationCode: confirmation_code,
            receivedAt:       new Date().toISOString(),
            status:           'pending',
          },
        },
      });

      app.log.info({ user_id, request_id, confirmation_code }, '[Privacy] Meta deletion request registrada');
      return reply.code(200).send({ ok: true });
    }
  );

  // ── GET /privacy/meta-deletion-status/:code ───────────────
  // Consultado pelo Next.js para retornar status real ao visitante
  app.get<{ Params: { code: string } }>(
    '/meta-deletion-status/:code',
    async (req: any, reply) => {
      const { code } = req.params;
      if (!code || code.length < 10) {
        return reply.code(400).send({ error: 'Código inválido.' });
      }

      // Buscar no AuditLog pela confirmationCode armazenada no metadata
      const logs = await prisma.auditLog.findMany({
        where: {
          action:  'META_DATA_DELETION_REQUEST',
          adminId: 'meta-platform',
        },
        orderBy: { timestamp: 'desc' },
        take: 500,
      });

      const entry = logs.find((l: any) => (l.metadata as any)?.confirmationCode === code);
      if (!entry) {
        return reply.code(404).send({ error: 'Código de confirmação não encontrado.' });
      }

      const meta = entry.metadata as any;
      return {
        status:                 meta.status || 'pending',
        confirmationCode:       code,
        requestedAt:            entry.timestamp.toISOString(),
        expectedCompletionDate: new Date(entry.timestamp.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
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

  // ── DELETE /privacy/account ────────────────────────────────
  // Soft delete + anonimização (LGPD Art. 18 — direito à eliminação)
  // Mantém registros com obrigação legal de retenção (ex: notas fiscais),
  // mas anonimiza dados pessoais. Retenção de 30 dias antes de purga definitiva.
  app.delete('/account', { ...auth }, async (req: any, reply) => {
    const userId = req.user.sub;
    const now = new Date();

    try {
      await prisma.$transaction(async (tx: any) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            name:            'Usuário deletado',
            email:           `deleted_${userId.slice(0, 8)}@deleted.local`,
            document:        null,
            phone:           null,
            deletedAt:       now,
            pseudonymizedAt: now,
          },
        });
        await tx.transcription.updateMany({
          where: { userId },
          data:  { originalText: '[ANONIMIZADO]' },
        });
        await tx.supportTicket.updateMany({
          where: { userId },
          data:  { description: '[ANONIMIZADO]' },
        });
        await tx.auditLog.create({
          data: {
            action:       'user.deleted',
            targetUserId: userId,
            adminId:      'system',
            metadata:     { reason: 'LGPD Art. 18 — solicitação do titular', dataRetention: '30 days' },
          },
        });
      });

      try {
        await supabase.auth.admin.deleteUser(userId);
      } catch (err) {
        app.log.error({ err, userId }, 'Erro ao remover usuário do Supabase Auth');
      }

      return reply.code(202).send({ status: 'deletion_scheduled', dataRetention: '30 days' });
    } catch (error) {
      app.log.error({ error, userId }, 'Erro ao processar exclusão de conta');
      return reply.code(500).send({ error: 'Erro ao processar solicitação de exclusão' });
    }
  });

  // ── POST /privacy/accept-terms ─────────────────────────────
  // Registro de consentimento (Termos + Política de Privacidade)
  app.post<{ Body: { policyVersion?: string; termsVersion?: string } }>(
    '/accept-terms',
    { ...auth },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { policyVersion, termsVersion } = req.body || {};
      const now = new Date();

      await prisma.user.update({
        where: { id: userId },
        data:  { privacyPolicyAcceptedAt: now, termsAcceptedAt: now },
      });
      await prisma.auditLog.create({
        data: {
          action:       'user.terms_accepted',
          targetUserId: userId,
          adminId:      'system',
          changes:      { policyVersion, termsVersion },
        },
      });

      return reply.code(200).send({ accepted: true, acceptedAt: now.toISOString() });
    }
  );

  // ── GET /privacy/legal/privacy-policy ──────────────────────
  // Documento público e versionado (sem autenticação)
  app.get<{ Querystring: { version?: string } }>(
    '/legal/privacy-policy',
    async (req: any, reply) => {
      const { version } = req.query;
      const where = version ? { version } : {};
      const policy = await prisma.privacyPolicy.findFirst({ where, orderBy: { createdAt: 'desc' } });

      if (!policy) {
        return reply.code(404).send({ error: 'Nenhuma política de privacidade cadastrada.' });
      }

      return {
        version:       policy.version,
        content:       policy.content,
        effectiveFrom: policy.createdAt.toISOString(),
      };
    }
  );

  // ── GET /privacy/legal/terms-of-service ────────────────────
  // Documento público (sem autenticação) — conteúdo estático, mesma versão do site
  app.get('/legal/terms-of-service', async () => {
    return TERMS_OF_SERVICE;
  });
}
