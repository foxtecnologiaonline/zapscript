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
const EVOLUTION_DAILY_LIMIT = parseInt(process.env.CAMPANHAS_EVOLUTION_DAILY_LIMIT || '40', 10);
const EVOLUTION_WARMUP_DAYS = parseInt(process.env.CAMPANHAS_EVOLUTION_WARMUP_DAYS || '10', 10);
const EVOLUTION_WARMUP_FLOOR_PCT = 0.15;
const SEND_WINDOW_START_HOUR = parseInt(process.env.CAMPANHAS_SEND_WINDOW_START_HOUR || '8', 10);
const SEND_WINDOW_END_HOUR   = parseInt(process.env.CAMPANHAS_SEND_WINDOW_END_HOUR || '21', 10);

/**
 * Espaçamento entre envios do canal Evolution — duplicada de propósito de
 * evolutionSendDelayMs em apps/api/src/routes/modules/campanhas.ts (api e worker
 * não compartilham código neste monorepo). Ver CAMPANHAS_ARQUITETURA.md §8/§11.
 */
function evolutionSendDelayMs(index: number, dailyLimit: number = EVOLUTION_DAILY_LIMIT): number {
  if (index <= 0) return 0;
  const baseIntervalMs = (24 * 60 * 60 * 1000) / Math.max(dailyLimit, 1);
  const jitter = (Math.random() * 0.6 - 0.3) * baseIntervalMs; // ±30%
  return Math.max(0, Math.round(index * baseIntervalMs + jitter));
}

/** Aquecimento progressivo (item 3) — duplicada de effectiveEvolutionDailyLimit em
 *  apps/api/src/routes/modules/campanhas.ts. Ver §11/item 3. */
function effectiveEvolutionDailyLimit(connectedAt: Date | null, dailyLimit: number = EVOLUTION_DAILY_LIMIT): number {
  if (!connectedAt || EVOLUTION_WARMUP_DAYS <= 0) return dailyLimit;
  const daysSinceConnected = (Date.now() - connectedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceConnected >= EVOLUTION_WARMUP_DAYS) return dailyLimit;
  const progress = Math.max(0, daysSinceConnected) / EVOLUTION_WARMUP_DAYS;
  const pct = EVOLUTION_WARMUP_FLOOR_PCT + (1 - EVOLUTION_WARMUP_FLOOR_PCT) * progress;
  return Math.max(1, Math.round(dailyLimit * pct));
}

/** Janela de envio (item 4) — duplicada de applySendWindow em
 *  apps/api/src/routes/modules/campanhas.ts. Ver §11/item 4. */
function applySendWindow(delayMs: number, now: Date = new Date()): number {
  if (SEND_WINDOW_START_HOUR <= 0 && SEND_WINDOW_END_HOUR >= 24) return delayMs;
  const target = new Date(now.getTime() + delayMs);
  const hourBRT = (target.getUTCHours() + 24 - 3) % 24;
  if (hourBRT >= SEND_WINDOW_START_HOUR && hourBRT < SEND_WINDOW_END_HOUR) return delayMs;
  const hoursUntilStart = hourBRT < SEND_WINDOW_START_HOUR
    ? SEND_WINDOW_START_HOUR - hourBRT
    : (24 - hourBRT) + SEND_WINDOW_START_HOUR;
  return delayMs + hoursUntilStart * 60 * 60 * 1000;
}

async function fireCampanha(campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({ where: { id: campanhaId } });
  if (!campanha || campanha.status !== 'scheduled') return; // já processada em outro tick/réplica

  const numero = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
  const numeroOk = !!numero && numero.status === 'connected'
    && (campanha.channel === 'evolution' ? !!numero.zapiInstanceId : !!numero.metaAccessTokenEnc);
  if (!numeroOk) {
    const claimed = await prisma.campanha.updateMany({
      where: { id: campanhaId, status: 'scheduled' },
      data: { status: 'failed', completedAt: new Date() },
    });
    if (claimed.count > 0) {
      logger.warn(`[Campanhas][Scheduler] Campanha ${campanhaId} → failed: número ${campanha.channel} desconectado no horário agendado.`);
    }
    return;
  }

  // Pool de números (item 2) — mesma lógica de POST /:id/start: só entram na
  // rotação os números extras que estiverem prontos pra enviar agora.
  let sendNumbers = [numero];
  if (campanha.poolNumberIds.length > 0) {
    const poolNumbers = await prisma.whatsappNumber.findMany({
      where: { id: { in: campanha.poolNumberIds }, userId: campanha.userId, provider: campanha.channel },
    });
    sendNumbers = sendNumbers.concat(poolNumbers.filter((n) => n.status === 'connected'
      && (campanha.channel === 'evolution' ? !!n.zapiInstanceId : !!n.metaAccessTokenEnc)));
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

  if (sendNumbers.length > 1) {
    const grupos = new Map<string, string[]>();
    pendentes.forEach((p: { id: string }, i: number) => {
      const numberId = sendNumbers[i % sendNumbers.length].id;
      const arr = grupos.get(numberId);
      if (arr) arr.push(p.id); else grupos.set(numberId, [p.id]);
    });
    await Promise.all(
      Array.from(grupos.entries()).map(([numberId, ids]) =>
        prisma.campanhaContato.updateMany({ where: { id: { in: ids } }, data: { assignedNumberId: numberId } }),
      ),
    );
  }

  const dailyLimit = campanha.channel === 'evolution'
    ? Math.min(...sendNumbers.map((n) => effectiveEvolutionDailyLimit(n.connectedAt)))
    : EVOLUTION_DAILY_LIMIT;
  await campanhasQueue.addBulk(
    pendentes.map((p: { id: string }, i: number) => ({
      name: 'send',
      data: { campanhaId, contatoId: p.id },
      opts: {
        jobId: `${campanhaId}:${p.id}`,
        delay: applySendWindow(campanha.channel === 'evolution' ? evolutionSendDelayMs(i, dailyLimit) : 0),
      },
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
