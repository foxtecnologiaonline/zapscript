import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendMessageViaEvolution } from '../services/evolution';

/**
 * Chatbot Campanhas — updates periódicos de progresso no próprio chat (self-chat,
 * mesmo número que disparou) pras campanhas criadas via bot (Campanha.createdViaChat).
 * Mesmo padrão de setInterval auto-registrado de campanhas-scheduler.ts.
 *
 * Sem coluna própria pra marcar "já mandei o relatório final" (evita mais uma
 * migration nesta fatia) — usa guardas em memória do processo. Seguro porque a
 * infra atual roda um único worker (Docker Compose, um servidor — ver CLAUDE.md);
 * numa eventual 2ª réplica ou reinício, o pior caso é reenviar o relatório final
 * uma vez a mais, o que é cosmético (não afeta saldo/envio). Se a infra crescer pra
 * múltiplas réplicas persistentes, migrar esse estado pra uma coluna é o próximo passo.
 */

const CHECK_INTERVAL_MS = 30 * 1000;

const lastSnapshotSent = new Map<string, string>(); // campanhaId -> assinatura do último snapshot mandado
const finalReportSent  = new Set<string>();          // campanhaId -> já mandou o relatório final

type Stats = Record<string, number>;

function snapshotSignature(stats: Stats): string {
  return JSON.stringify(stats);
}

function formatProgress(stats: Stats, audienceCount: number): string {
  const sent    = (stats.sent ?? 0) + (stats.delivered ?? 0) + (stats.read ?? 0);
  const read    = stats.read ?? 0;
  const failed  = stats.failed ?? 0;
  const pending = stats.pending ?? 0;
  return [
    `📊 Progresso: ${sent} ✅ | ${failed} ❌ | ${read} 👀 (${pending} na fila, de ${audienceCount})`,
  ].join('\n');
}

function formatFinalReport(stats: Stats, audienceCount: number): string {
  const sent   = (stats.sent ?? 0) + (stats.delivered ?? 0) + (stats.read ?? 0);
  const read   = stats.read ?? 0;
  const failed = stats.failed ?? 0;
  const rate   = audienceCount > 0 ? Math.round((sent / audienceCount) * 100) : 0;
  const readRate = sent > 0 ? Math.round((read / sent) * 100) : 0;
  return [
    `🎉 Campanha concluída! ${sent}/${audienceCount} enviados (${rate}%)${failed > 0 ? `, ${failed} falharam` : ''}.`,
    `👀 Taxa de leitura: ${readRate}%`,
  ].join('\n');
}

async function statsFor(campanhaId: string): Promise<Stats> {
  const grouped = await prisma.campanhaContato.groupBy({
    by: ['status'],
    where: { campanhaId },
    _count: true,
  });
  const stats: Stats = {};
  for (const g of grouped as any[]) stats[g.status] = g._count;
  return stats;
}

async function notifyCampanha(campanha: {
  id: string; audienceCount: number; status: string;
  whatsappNumber: { zapiInstanceId: string | null; phoneNumber: string; status: string } | null;
}): Promise<void> {
  const numero = campanha.whatsappNumber;
  if (!numero?.zapiInstanceId || numero.status !== 'connected') return;

  const stats = await statsFor(campanha.id);

  if (campanha.status === 'completed') {
    if (finalReportSent.has(campanha.id)) return;
    finalReportSent.add(campanha.id);
    lastSnapshotSent.delete(campanha.id);
    await sendMessageViaEvolution(numero.zapiInstanceId, numero.phoneNumber, formatFinalReport(stats, campanha.audienceCount))
      .catch((err: any) => logger.warn(`[Campanhas][ChatNotifier] Falha ao mandar relatório final (${campanha.id}): ${err.message}`));
    return;
  }

  // status === 'running': só manda se o snapshot mudou desde o último tick (evita spam de "nada novo").
  const signature = snapshotSignature(stats);
  if (lastSnapshotSent.get(campanha.id) === signature) return;
  lastSnapshotSent.set(campanha.id, signature);

  await sendMessageViaEvolution(numero.zapiInstanceId, numero.phoneNumber, formatProgress(stats, campanha.audienceCount))
    .catch((err: any) => logger.warn(`[Campanhas][ChatNotifier] Falha ao mandar progresso (${campanha.id}): ${err.message}`));
}

export async function runCampanhaChatNotifierTick(): Promise<void> {
  try {
    // 'completed' só entra na janela dos últimos 10min — o relatório final já devia ter
    // saído bem antes disso; sem esse corte, campanhas antigas ficariam sendo
    // requeridas (e descartadas via finalReportSent) a cada tick para sempre.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const campanhas = await prisma.campanha.findMany({
      where: {
        createdViaChat: true,
        OR: [
          { status: 'running' },
          { status: 'completed', completedAt: { gte: tenMinAgo } },
        ],
      },
      select: {
        id: true, audienceCount: true, status: true,
        whatsappNumber: { select: { zapiInstanceId: true, phoneNumber: true, status: true } },
      },
    });
    for (const campanha of campanhas) {
      if (campanha.status === 'completed' && finalReportSent.has(campanha.id)) continue;
      try {
        await notifyCampanha(campanha as any);
      } catch (err: any) {
        logger.error(`[Campanhas][ChatNotifier] Falha ao processar campanha ${campanha.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[Campanhas][ChatNotifier] Erro no tick: ${err.message}`);
  }
}

runCampanhaChatNotifierTick();
setInterval(runCampanhaChatNotifierTick, CHECK_INTERVAL_MS);

export { CHECK_INTERVAL_MS };
