import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { mktfastQueue } from './lib/queue';

/**
 * MKT-Fast — dispara automaticamente missões agendadas (status 'scheduled',
 * ver POST /sys/g5r8t2/mktfast/missions/:id/schedule) quando scheduledAt
 * chega. Mesma semântica de POST /:id/start (api): claim atômico via
 * updateMany filtrado por status, depois enfileira as MissionExecution
 * 'pending' já materializadas na criação da missão — ver
 * apps/api/src/routes/mktfast-admin.ts e MKTFAST_ESCOPO.md.
 */

const CHECK_INTERVAL_MS = 60 * 1000;

async function fireMission(missionId: string): Promise<void> {
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { whatsappNumber: true } });
  if (!mission || mission.status !== 'scheduled') return; // já processada em outro tick/réplica

  if (mission.channels.includes('whatsapp')) {
    const numero = mission.whatsappNumber;
    if (!numero || numero.status !== 'connected' || !numero.zapiInstanceId) {
      const claimed = await prisma.mission.updateMany({
        where: { id: missionId, status: 'scheduled' },
        data: { status: 'canceled', completedAt: new Date() },
      });
      if (claimed.count > 0) {
        logger.warn(`[MKT-Fast][Scheduler] Missão ${missionId} → canceled: número WhatsApp desconectado no horário agendado.`);
      }
      return;
    }
  }

  const pending = await prisma.missionExecution.findMany({ where: { missionId, status: 'pending' }, select: { id: true } });
  if (pending.length === 0) {
    const claimed = await prisma.mission.updateMany({
      where: { id: missionId, status: 'scheduled' },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (claimed.count > 0) {
      logger.warn(`[MKT-Fast][Scheduler] Missão ${missionId} → completed: sem execuções pendentes no horário agendado.`);
    }
    return;
  }

  const claimed = await prisma.mission.updateMany({
    where: { id: missionId, status: 'scheduled' },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count === 0) return; // outra réplica já iniciou

  await mktfastQueue.addBulk(
    pending.map((e) => ({ name: 'send', data: { missionId, executionId: e.id }, opts: { jobId: `${missionId}:${e.id}` } })),
  );
  logger.info(`[MKT-Fast][Scheduler] ▶ Missão ${missionId} iniciada automaticamente (${pending.length} execução(ões)).`);
}

async function runMissionSchedulerTick(): Promise<void> {
  try {
    const due = await prisma.mission.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        await fireMission(id);
      } catch (err: any) {
        logger.error(`[MKT-Fast][Scheduler] Falha ao iniciar missão ${id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[MKT-Fast][Scheduler] Erro no tick do agendador: ${err.message}`);
  }
}

runMissionSchedulerTick();
setInterval(runMissionSchedulerTick, CHECK_INTERVAL_MS);

export { runMissionSchedulerTick };
