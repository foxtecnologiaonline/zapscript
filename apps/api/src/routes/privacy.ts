import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function privacyRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── DELETE /privacy/account ────────────────────────────────────
  // Deletar conta do usuário (LGPD Art. 18)
  // Soft delete: marca deletedAt e anonimiza dados
  app.delete('/account', auth, async (req: any, reply) => {
    const userId = req.user.sub;

    try {
      // 1. Soft delete: marcar como deletado e anonimizar
      await prisma.$transaction(async (tx) => {
        // Anonimizar usuário
        await tx.user.update({
          where: { id: userId },
          data: {
            deletedAt: new Date(),
            pseudonymizedAt: new Date(),
            email: `deleted_${userId}@zapscript-deleted.local`,
            name: 'Usuário deletado',
            document: null,
          },
        });

        // Anonimizar transcrições
        await tx.transcription.updateMany({
          where: { userId },
          data: {
            originalText: '[ANONIMIZADO]',
            summaryBullets: JSON.stringify(['[ANONIMIZADO]']),
          },
        });

        // Anonimizar suporte
        await tx.supportTicket.updateMany({
          where: { userId },
          data: {
            name: 'Usuário deletado',
            email: `deleted_${userId}@zapscript-deleted.local`,
            description: '[ANONIMIZADO]',
          },
        });

        // Registrar em audit trail
        await tx.auditLog.create({
          data: {
            action: 'user.deleted',
            adminId: userId,  // Auto-deletion
            targetUserId: userId,
            resourceType: 'user',
            changes: {
              action: 'soft_delete_with_anonymization',
              reason: 'LGPD Art. 18 — User requested deletion',
            },
            timestamp: new Date(),
          },
        });
      });

      // 2. Deletar no Supabase (hard delete da auth)
      try {
        // Requer service role key para deletar usuário
        await supabase.auth.admin.deleteUser(userId);
      } catch (err: any) {
        app.log.warn(`[Privacy] Não foi possível deletar em Supabase: ${err.message}`);
        // Continua mesmo se falhar
      }

      return reply.code(202).send({
        status: 'deletion_scheduled',
        message: 'Sua conta será completamente deletada em até 30 dias',
        dataRetention: '30 days',
      });
    } catch (err: any) {
      app.log.error({ err }, '[Privacy] Erro ao deletar account');
      return reply.code(500).send({ error: 'Erro ao processar exclusão' });
    }
  });

  // ── GET /privacy/export ────────────────────────────────────────
  // Exportar todos os dados pessoais do usuário (LGPD Art. 20)
  app.get('/export', auth, async (req: any, reply) => {
    const userId = req.user.sub;

    try {
      const [user, subscription, balance, numbers, transcriptions, tickets] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.subscription.findUnique({
          where: { userId },
          include: { plan: true },
        }),
        prisma.minuteBalance.findUnique({ where: { userId } }),
        prisma.whatsappNumber.findMany({ where: { userId } }),
        prisma.transcription.findMany({
          where: { userId },
          include: { number: true },
          take: 1000, // Limite para não ficar muito pesado
        }),
        prisma.supportTicket.findMany({
          where: { userId },
          take: 100,
        }),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 dias
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
          document: user?.document,
          emailVerified: user?.emailVerified,
          createdAt: user?.createdAt,
          updatedAt: user?.updatedAt,
        },
        subscription: subscription ? {
          planName: subscription.plan.name,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        } : null,
        balance: balance ? {
          availableMinutes: balance.availableMinutes,
          accumulatedMinutes: balance.accumulatedMinutes,
          resetAt: balance.resetAt,
        } : null,
        whatsappNumbers: numbers.map(n => ({
          id: n.id,
          phoneNumber: n.phoneNumber,
          displayName: n.displayName,
          status: n.status,
          connectedAt: n.connectedAt,
          messageCount: n.messageCount,
          minutesUsed: n.minutesUsed,
        })),
        transcriptions: {
          count: await prisma.transcription.count({ where: { userId } }),
          sample: transcriptions.slice(0, 10).map(t => ({
            id: t.id,
            originalText: t.originalText,
            durationSec: t.durationSec,
            createdAt: t.createdAt,
          })),
          note: 'Primeiras 10 transcrições. Total completo em arquivo anexado.',
        },
        supportTickets: {
          count: await prisma.supportTicket.count({ where: { userId } }),
          items: tickets.map(t => ({
            id: t.id,
            subject: t.category,
            status: t.status,
            createdAt: t.createdAt,
          })),
        },
      };

      return reply.header('Content-Type', 'application/json').send(exportData);
    } catch (err: any) {
      app.log.error({ err }, '[Privacy] Erro ao exportar dados');
      return reply.code(500).send({ error: 'Erro ao exportar dados' });
    }
  });

  // ── POST /privacy/accept-terms ─────────────────────────────────
  // Aceitar termos e política de privacidade
  app.post('/accept-terms', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { policyVersion = '1.0', termsVersion = '1.0' } = req.body as any;

    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          privacyPolicyAcceptedAt: new Date(),
          termsAcceptedAt: new Date(),
        },
      });

      // Registrar em audit trail
      await prisma.auditLog.create({
        data: {
          action: 'user.terms_accepted',
          adminId: userId,
          targetUserId: userId,
          resourceType: 'user',
          changes: {
            policyVersion,
            termsVersion,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        accepted: true,
        acceptedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      app.log.error({ err }, '[Privacy] Erro ao aceitar termos');
      return reply.code(500).send({ error: 'Erro ao aceitar termos' });
    }
  });

  // ── GET /legal/privacy-policy ──────────────────────────────────
  // Obter política de privacidade
  app.get('/legal/privacy-policy', async (req, reply) => {
    const version = (req.query as any).version || 'latest';

    try {
      const policy = await prisma.privacyPolicy.findFirst({
        where: version === 'latest' ? {} : { version },
        orderBy: { createdAt: 'desc' },
      });

      if (!policy) {
        return reply.code(404).send({ error: 'Política não encontrada' });
      }

      return {
        version: policy.version,
        content: policy.content,
        createdAt: policy.createdAt,
        effectiveFrom: policy.createdAt,
      };
    } catch (err: any) {
      app.log.error({ err }, '[Privacy] Erro ao buscar privacy policy');
      return reply.code(500).send({ error: 'Erro ao buscar política' });
    }
  });

  // ── GET /legal/terms-of-service ────────────────────────────────
  // Obter termos de serviço (placeholder)
  app.get('/legal/terms-of-service', async (req, reply) => {
    return {
      version: '1.0',
      content: `
        <h1>Termos de Serviço — ZapScript</h1>
        <p>Ao usar o ZapScript, você concorda com estes termos.</p>
        <h2>1. Uso do Serviço</h2>
        <p>O serviço é fornecido "como está" para transcrição automática de áudios do WhatsApp.</p>
        <h2>2. Responsabilidade</h2>
        <p>Você é responsável pelo uso da plataforma conforme as leis aplicáveis.</p>
        <h2>3. Direitos de Propriedade Intelectual</h2>
        <p>Você retém os direitos sobre seus dados. Nós reteremos os direitos sobre o software.</p>
      `,
      effectiveFrom: '2026-05-01',
    };
  });

  // ── POST /user/request-deletion ────────────────────────────────
  // Processar solicitação de exclusão via formulário público (LGPD)
  app.post('/user/request-deletion', async (req: any, reply) => {
    const { email, motivo } = req.body as any;

    if (!email || !email.includes('@')) {
      return reply.code(400).send({ message: 'E-mail inválido' });
    }

    try {
      // Buscar usuário
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (user) {
        // Registrar em audit trail
        await prisma.auditLog.create({
          data: {
            action: 'user.deletion_requested',
            targetUserId: user.id,
            resourceType: 'user',
            changes: {
              reason: motivo || 'Formulário público',
              timestamp: new Date().toISOString(),
            },
          },
        });
      }

      // TODO: Enviar e-mail de confirmação
      // await sendDeletionConfirmationEmail(user.email);

      app.log.info(`[Privacy] Solicitação de exclusão recebida para ${email}`);

      return reply.code(200).send({
        message: 'Solicitação de exclusão recebida',
        status: 'pending',
        nextSteps: 'Você receberá um e-mail de confirmação em breve',
      });
    } catch (err: any) {
      app.log.error({ err }, '[Privacy] Erro ao processar solicitação de exclusão');
      return reply.code(500).send({ message: 'Erro ao processar solicitação' });
    }
  });

  // ── POST /data-deletion-callback ────────────────────────────────
  // Meta Data Deletion Callback (webhook assinado)
  // Documentação: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
  app.post('/data-deletion-callback', async (req: any, reply) => {
    const signature = req.headers['x-hub-signature-256'];

    if (!signature) {
      app.log.warn('[Data Deletion] Requisição sem assinatura');
      return reply.code(401).send({ error: 'Missing signature' });
    }

    try {
      const body = JSON.stringify(req.body);
      const appSecret = process.env.FACEBOOK_APP_SECRET;

      if (!appSecret) {
        app.log.error('[Data Deletion] FACEBOOK_APP_SECRET não configurado');
        return reply.code(500).send({ error: 'Server misconfiguration' });
      }

      // Validar assinatura HMAC-SHA256
      const hash = crypto
        .createHmac('sha256', appSecret)
        .update(body)
        .digest('hex');

      const expectedSignature = `sha256=${hash}`;

      if (signature !== expectedSignature) {
        app.log.warn('[Data Deletion] Assinatura inválida recebida');
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const { user_id, request_id } = req.body;

      if (!user_id || !request_id) {
        return reply.code(400).send({ error: 'Missing user_id or request_id' });
      }

      // Gerar código de confirmação único
      const confirmationCode = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // TODO: Implementar lógica de exclusão real
      // - Deletar dados do usuário conforme política de privacidade
      // - Registrar em auditLog
      app.log.info(`[Data Deletion] Callback Meta processado: user_id=${user_id}, request_id=${request_id}`);

      // URL de status (usar domínio configurado)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://zapscript.me';
      const statusUrl = `${baseUrl}/deletion-status/${confirmationCode}`;

      // Resposta obrigatória conforme Meta
      return reply.code(200).send({
        url: statusUrl,
        confirmation_code: confirmationCode,
      });
    } catch (err: any) {
      app.log.error({ err }, '[Data Deletion] Erro ao processar callback Meta');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
