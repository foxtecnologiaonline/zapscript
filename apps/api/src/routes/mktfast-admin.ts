import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { checkAdminTotp } from '../lib/totp';
import { mktfastQueue } from '../services/queue';
import { normalizePhone } from './modules/campanhas';

/**
 * MKT-Fast — motor genérico de "missão de divulgação" (ferramenta interna).
 * Ver MKTFAST_ESCOPO.md.
 *
 * Fase 0: canal 'whatsapp' (bot) — alvo = lista explícita de telefones
 * informada na criação da missão; a conformidade da lista (opt-in,
 * consentimento) é responsabilidade de quem cria a missão.
 *
 * Fase 1: canal 'human_share' — convoca telefones da equipe interna via
 * WhatsApp (content.humanTargets); a execução some do "pendente" só quando
 * o humano manda prova (POST .../proof) e um admin aprova/rejeita (POST
 * .../approve|reject) — não há verificação automática ainda.
 *
 * Sem entitlement/billing: acesso é só o mesmo adminAuth (ADMIN_TOKEN + TOTP)
 * usado em routes/admin.ts e routes/admin-master.ts.
 */

const SUPPORTED_CHANNELS = new Set(['whatsapp', 'human_share']);

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
  targets?: string[];      // canal 'whatsapp' — telefones que recebem o conteúdo direto
  humanTargets?: string[]; // canal 'human_share' — telefones convocados (equipe interna)
  humanBriefing?: string;  // mensagem de convocação; cai pra `text` se ausente
}

/** Mesma checagem de conclusão do worker (modules/mktfast.ts) — duplicada de
 *  propósito porque api e worker não compartilham código neste monorepo.
 *  Precisa existir aqui também porque /approve e /reject (ações de admin,
 *  fora da fila) podem ser o que fecha a última execução pendente. */
async function maybeCompleteMission(missionId: string): Promise<void> {
  const pending = await prisma.missionExecution.count({
    where: { missionId, status: { in: ['pending', 'awaiting_proof', 'proof_submitted'] } },
  });
  if (pending > 0) return;
  await prisma.mission.updateMany({
    where: { id: missionId, status: 'running' },
    data: { status: 'completed', completedAt: new Date() },
  });
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

    const normalizeList = (list?: string[]) => [...new Set((list || []).map(normalizePhone).filter((p) => p.length >= 12))];
    const targets      = normalizeList(content?.targets);
    const humanTargets = normalizeList(content?.humanTargets);

    if (channels.includes('whatsapp') && targets.length === 0) {
      return reply.code(400).send({ error: 'content.targets deve ter ao menos 1 telefone válido quando o canal "whatsapp" está incluído.' });
    }
    if (channels.includes('human_share') && humanTargets.length === 0) {
      return reply.code(400).send({ error: 'content.humanTargets deve ter ao menos 1 telefone válido quando o canal "human_share" está incluído.' });
    }
    // Os dois canais da Fase 0/1 enviam via WhatsApp (conteúdo direto ou convocação).
    if (channels.includes('whatsapp') || channels.includes('human_share')) {
      if (!whatsappNumberId) {
        return reply.code(400).send({ error: 'whatsappNumberId é obrigatório quando "whatsapp" ou "human_share" está incluído.' });
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

    const executionsToCreate = [
      ...targets.map((phone) => ({ missionId: mission.id, channel: 'whatsapp', executor: 'bot', targetRef: phone })),
      ...humanTargets.map((phone) => ({ missionId: mission.id, channel: 'human_share', executor: 'human', targetRef: phone })),
    ];
    if (executionsToCreate.length > 0) {
      await prisma.missionExecution.createMany({ data: executionsToCreate, skipDuplicates: true });
    }

    return reply.code(201).send({ mission, targetsCreated: targets.length, humanTargetsCreated: humanTargets.length });
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
    if (mission.channels.includes('whatsapp') || mission.channels.includes('human_share')) {
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

  // ── Fase 1 (human_share): prova + aprovação manual ──────────────────────
  // Sem verificação automática ainda — quem cumpriu a missão manda o
  // link/print pra quem convocou, e o admin registra/aprova por aqui.

  // POST /missions/:id/executions/:execId/proof — humano (ou quem o convocou,
  // por ele) registra a prova de que cumpriu a missão.
  app.post<{ Params: { id: string; execId: string }; Body: { proofUrl?: string } }>(
    '/missions/:id/executions/:execId/proof',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { proofUrl } = req.body || {};
      if (!proofUrl?.trim()) return reply.code(400).send({ error: 'Informe proofUrl.' });

      const updated = await prisma.missionExecution.updateMany({
        where: { id: req.params.execId, missionId: req.params.id, executor: 'human', status: { in: ['pending', 'awaiting_proof'] } },
        data: { status: 'proof_submitted', proofUrl: proofUrl.trim() },
      });
      if (updated.count === 0) {
        return reply.code(409).send({ error: 'Execução não encontrada, não é de um humano, ou já tem prova registrada.' });
      }
      return { proofSubmitted: true };
    },
  );

  // POST /missions/:id/executions/:execId/approve — admin aprova a prova;
  // reachCount default 1 (alcance simples), ajustável se a missão pedir mais.
  app.post<{ Params: { id: string; execId: string }; Body: { reachCount?: number } }>(
    '/missions/:id/executions/:execId/approve',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const reachCount = Number.isFinite(req.body?.reachCount) ? Number(req.body!.reachCount) : 1;
      const updated = await prisma.missionExecution.updateMany({
        where: { id: req.params.execId, missionId: req.params.id, status: 'proof_submitted' },
        data: { status: 'approved', reachCount, errorReason: null },
      });
      if (updated.count === 0) return reply.code(409).send({ error: 'Execução não encontrada ou sem prova pendente de aprovação.' });
      await maybeCompleteMission(req.params.id);
      return { approved: true, reachCount };
    },
  );

  // POST /missions/:id/executions/:execId/reject
  app.post<{ Params: { id: string; execId: string }; Body: { reason?: string } }>(
    '/missions/:id/executions/:execId/reject',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const updated = await prisma.missionExecution.updateMany({
        where: { id: req.params.execId, missionId: req.params.id, status: 'proof_submitted' },
        data: { status: 'rejected', errorReason: (req.body?.reason || 'Prova rejeitada pelo admin.').slice(0, 500) },
      });
      if (updated.count === 0) return reply.code(409).send({ error: 'Execução não encontrada ou sem prova pendente de aprovação.' });
      await maybeCompleteMission(req.params.id);
      return { rejected: true };
    },
  );
}
