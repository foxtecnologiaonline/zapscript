import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { checkAdminTotp } from '../lib/totp';
import { mktfastQueue } from '../services/queue';
import { normalizePhone } from './modules/campanhas';

/**
 * MKT-Fast — motor genérico de "missão de divulgação" (ferramenta interna).
 * Ver MKTFAST_ESCOPO.md. Fase 0: canal 'whatsapp' apenas, alvo = lista
 * explícita de telefones informada na criação da missão — a conformidade da
 * lista (opt-in, consentimento) é responsabilidade de quem cria a missão.
 *
 * Sem entitlement/billing: acesso é só o mesmo adminAuth (ADMIN_TOKEN + TOTP)
 * usado em routes/admin.ts e routes/admin-master.ts.
 */

const SUPPORTED_CHANNELS = new Set(['whatsapp']);

function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const totp = await checkAdminTotp(token!, req.headers['x-admin-totp'] as string | undefined);
  if (totp !== 'ok') {
    return reply.code(401).send({
      error: totp === 'totp_required' ? 'Código 2FA necessário' : 'Código 2FA inválido',
      totpRequired: true,
    });
  }
};

interface MissionContent {
  text?: string;
  mediaUrl?: string;
  linkUrl?: string;
  targets?: string[];
}

/** Enfileira as execuções pendentes de uma missão já em 'running'. Chamado só
 *  por /:id/start — a contraparte agendada (mktfast-scheduler.ts, worker) tem
 *  sua própria cópia porque api e worker não compartilham código neste monorepo. */
async function enqueuePendingExecutions(missionId: string): Promise<number> {
  const pending = await prisma.missionExecution.findMany({
    where: { missionId, status: 'pending' },
    select: { id: true },
  });
  if (pending.length === 0) return 0;
  await mktfastQueue.addBulk(
    pending.map((e) => ({
      name: 'send',
      data: { missionId, executionId: e.id },
      opts: { jobId: `${missionId}:${e.id}` },
    })),
  );
  return pending.length;
}

export default async function mktfastAdminRoutes(app: FastifyInstance) {

  // POST /missions — cria a missão (draft, ou scheduled se scheduledAt vier preenchido)
  // e já materializa as MissionExecution (status=pending) a partir de content.targets.
  app.post<{
    Body: {
      title?: string;
      objective?: string;
      content?: MissionContent;
      channels?: string[];
      whatsappNumberId?: string;
      targetReach?: number;
      createdBy?: string;
      scheduledAt?: string;
    };
  }>('/missions', { preHandler: [adminAuth] }, async (req, reply) => {
    const { title, objective, content, whatsappNumberId, targetReach, createdBy, scheduledAt } = req.body || {};
    const channels = req.body?.channels?.length ? req.body.channels : ['whatsapp'];

    if (!title?.trim() || !objective?.trim() || !createdBy?.trim()) {
      return reply.code(400).send({ error: 'Informe title, objective e createdBy.' });
    }
    const unsupported = channels.filter((c) => !SUPPORTED_CHANNELS.has(c));
    if (unsupported.length > 0) {
      return reply.code(400).send({ error: `Canal(is) ainda sem adapter: ${unsupported.join(', ')}. Suportados hoje: ${[...SUPPORTED_CHANNELS].join(', ')}.` });
    }

    const rawTargets = content?.targets || [];
    const targets = [...new Set(rawTargets.map(normalizePhone).filter((p) => p.length >= 12))];
    if (channels.includes('whatsapp')) {
      if (!whatsappNumberId) {
        return reply.code(400).send({ error: 'whatsappNumberId é obrigatório quando o canal "whatsapp" está incluído.' });
      }
      if (targets.length === 0) {
        return reply.code(400).send({ error: 'content.targets deve ter ao menos 1 telefone válido.' });
      }
      const numero = await prisma.whatsappNumber.findUnique({ where: { id: whatsappNumberId } });
      if (!numero) return reply.code(404).send({ error: 'whatsappNumberId não encontrado.' });
      if (numero.status !== 'connected' || !numero.zapiInstanceId) {
        return reply.code(409).send({ error: 'O número informado não está conectado (Evolution).' });
      }
    }

    const scheduled = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduled && Number.isNaN(scheduled.getTime())) {
      return reply.code(400).send({ error: 'scheduledAt inválido.' });
    }

    const mission = await prisma.mission.create({
      data: {
        title: title.trim(),
        objective: objective.trim(),
        content: (content || {}) as any,
        channels,
        whatsappNumberId: whatsappNumberId || null,
        targetReach: targetReach ?? null,
        createdBy: createdBy.trim(),
        status: scheduled ? 'scheduled' : 'draft',
        scheduledAt: scheduled,
      },
    });

    if (channels.includes('whatsapp') && targets.length > 0) {
      await prisma.missionExecution.createMany({
        data: targets.map((phone) => ({ missionId: mission.id, channel: 'whatsapp', executor: 'bot', targetRef: phone })),
        skipDuplicates: true,
      });
    }

    return reply.code(201).send({ mission, targetsCreated: targets.length });
  });

  // GET /missions — lista com alcance agregado (soma de reachCount das execuções)
  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/missions',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const where  = req.query.status ? { status: req.query.status } : {};

      const [missions, total] = await Promise.all([
        prisma.mission.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
        prisma.mission.count({ where }),
      ]);

      const grouped = missions.length
        ? await prisma.missionExecution.groupBy({
            by: ['missionId', 'status'],
            where: { missionId: { in: missions.map((m) => m.id) } },
            _count: { _all: true },
            _sum: { reachCount: true },
          })
        : [];

      const byMission = new Map<string, { total: number; byStatus: Record<string, number>; reach: number }>();
      for (const g of grouped) {
        const entry = byMission.get(g.missionId) || { total: 0, byStatus: {}, reach: 0 };
        entry.total += g._count._all;
        entry.byStatus[g.status] = g._count._all;
        entry.reach += g._sum.reachCount || 0;
        byMission.set(g.missionId, entry);
      }

      return {
        missions: missions.map((m) => ({ ...m, progress: byMission.get(m.id) || { total: 0, byStatus: {}, reach: 0 } })),
        total, limit, offset,
      };
    },
  );

  // GET /missions/:id — detalhe + execuções (volume baixo, sem paginação)
  app.get<{ Params: { id: string } }>('/missions/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const mission = await prisma.mission.findUnique({
      where: { id: req.params.id },
      include: { executions: { orderBy: { createdAt: 'asc' } }, whatsappNumber: { select: { id: true, phoneNumber: true, status: true } } },
    });
    if (!mission) return reply.code(404).send({ error: 'Missão não encontrada.' });
    return mission;
  });

  // POST /missions/:id/schedule — agenda o disparo (o mktfast-scheduler do worker dispara sozinho no horário)
  app.post<{ Params: { id: string }; Body: { scheduledAt?: string } }>(
    '/missions/:id/schedule',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        return reply.code(400).send({ error: 'scheduledAt inválido.' });
      }
      const updated = await prisma.mission.updateMany({
        where: { id: req.params.id, status: 'draft' },
        data: { status: 'scheduled', scheduledAt },
      });
      if (updated.count === 0) return reply.code(409).send({ error: 'Só é possível agendar uma missão em status "draft".' });
      return { scheduled: true, scheduledAt };
    },
  );

  // POST /missions/:id/start — dispara agora (ignora scheduledAt, se houver)
  app.post<{ Params: { id: string } }>('/missions/:id/start', { preHandler: [adminAuth] }, async (req, reply) => {
    const mission = await prisma.mission.findUnique({ where: { id: req.params.id }, include: { whatsappNumber: true } });
    if (!mission) return reply.code(404).send({ error: 'Missão não encontrada.' });
    if (!['draft', 'scheduled'].includes(mission.status)) {
      return reply.code(409).send({ error: `Missão em status "${mission.status}" não pode ser iniciada.` });
    }
    if (mission.channels.includes('whatsapp')) {
      if (!mission.whatsappNumber || mission.whatsappNumber.status !== 'connected' || !mission.whatsappNumber.zapiInstanceId) {
        return reply.code(409).send({ error: 'Número WhatsApp da missão não está conectado.' });
      }
    }

    const claimed = await prisma.mission.updateMany({
      where: { id: mission.id, status: mission.status },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count === 0) return reply.code(409).send({ error: 'Missão já foi iniciada por outra requisição.' });

    const queued = await enqueuePendingExecutions(mission.id);
    if (queued === 0) {
      await prisma.mission.updateMany({ where: { id: mission.id, status: 'running' }, data: { status: 'completed', completedAt: new Date() } });
    }
    return { started: true, queued };
  });

  // POST /missions/:id/cancel
  app.post<{ Params: { id: string } }>('/missions/:id/cancel', { preHandler: [adminAuth] }, async (req, reply) => {
    const updated = await prisma.mission.updateMany({
      where: { id: req.params.id, status: { in: ['draft', 'scheduled', 'running'] } },
      data: { status: 'canceled', completedAt: new Date() },
    });
    if (updated.count === 0) return reply.code(409).send({ error: 'Missão não encontrada ou já finalizada.' });
    return { canceled: true };
  });
}
