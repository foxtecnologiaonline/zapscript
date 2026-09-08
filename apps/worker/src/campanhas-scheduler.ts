import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { campanhasQueue } from './lib/queue';

/**
 * ZapScript Campanhas — dispara automaticamente campanhas agendadas (status
 * 'scheduled', ver POST /modules/campanhas/:id/schedule) quando scheduledAt
 * chega. Mesma semântica de enfileiramento de POST /:id/start (jobId
 * determinístico campanhaId:contatoId, reconferido ao vivo pelo worker de
 * envio — ver modules/campanhas.ts), só que disparada pelo relógio em vez de
 * uma ação do usuário.
 *
 * A transição scheduled → running usa updateMany filtrado por status (mesmo
 * idioma de apps/api/src/routes/modules/campanhas.ts:maybeCompleteCampanha):
 * atômica e idempotente, então rodar mais de uma réplica do worker não
 * enfileira a mesma campanha duas vezes.
 */

const CHECK_INTERVAL_MS = 60 * 1000;

async function fireCampanha(campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({ where: { id: campanhaId } });
  if (!campanha || campanha.status !== 'scheduled') return; // já processada em outro tick/réplica

  const numero = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
  if (!numero || numero.status !== 'connected' || !numero.metaAccessTokenEnc) {
    const claimed = await prisma.campanha.updateMany({
      where: { id: campanhaId, status: 'scheduled' },
      data: { status: 'failed', completedAt: new Date() },
    });
    if (claimed.count > 0) {
      logger.warn(`[Campanhas][Scheduler] Campanha ${campanhaId} → failed: número Meta desconectado no horário agendado.`);
    }
    return;
  }

  const pendentes = await prisma.campanhaContato.findMany({
    where: { campanhaId, status: 'pending' },
    select: { id: true },
  });
  if (pendentes.length === 0) {
    const claimed = await prisma.campanha.updateMany({
      where: { id: campanhaId, status: 'scheduled' },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (claimed.count > 0) {
      logger.warn(`[Campanhas][Scheduler] Campanha ${campanhaId} → completed: sem contatos pendentes no horário agendado.`);
    }
    return;
  }

  const claimed = await prisma.campanha.updateMany({
    where: { id: campanhaId, status: 'scheduled' },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count === 0) return; // outra réplica já iniciou

  await campanhasQueue.addBulk(
    pendentes.map((p: { id: string }) => ({
      name: 'send',
      data: { campanhaId, contatoId: p.id },
      opts: { jobId: `${campanhaId}:${p.id}` },
    })),
  );
  logger.info(`[Campanhas][Scheduler] ▶ Campanha ${campanhaId} iniciada automaticamente (${pendentes.length} contato(s)).`);
}

async function runCampanhaSchedulerTick(): Promise<void> {
  try {
    const due = await prisma.campanha.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        await fireCampanha(id);
      } catch (err: any) {
        logger.error(`[Campanhas][Scheduler] Falha ao iniciar campanha ${id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[Campanhas][Scheduler] Erro no tick do agendador: ${err.message}`);
  }
}

runCampanhaSchedulerTick();
setInterval(runCampanhaSchedulerTick, CHECK_INTERVAL_MS);

export { runCampanhaSchedulerTick };
