import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { campanhasQueue } from './lib/queue';
import { sendEmail } from './services/mailer';

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

/** Puramente pura, duplicada de tierToNumericCap em
 *  apps/api/src/services/whatsapp-campaigns.ts. Ver §11.13. */
function tierToNumericCap(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t.includes('UNLIMITED')) return Infinity;
  const match = t.match(/(\d+)(K)?/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] ? n * 1000 : n;
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Aviso por e-mail quando o disparo automático (agendado) começa acima do teto de
 * tier conhecido (§11.13, gap do §9.3): diferente de /:id/start e /:id/schedule
 * (que bloqueiam e pedem confirmExceedsTier), aqui não há usuário interativo às
 * 3h da manhã pra confirmar — fail-open, dispara mesmo assim, mas avisa depois.
 * Usa o tier em CACHE (WhatsappNumber.metaMessagingLimitTier, já sincronizado por
 * alguma chamada anterior a /schedule ou /start) — não bate na Graph API aqui.
 */
async function notifyCampanhaExceedsTierAtFire(campanhaId: string, cap: number, pendentesCount: number): Promise<void> {
  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!campanha?.user?.email) return;
  const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
  const firstName = escHtml(campanha.user.name?.split(' ')[0] || 'tudo bem');
  const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
    <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚠️ Campanha acima do limite da Meta</div>
    <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
      Olá, ${firstName}!<br><br>
      Sua campanha agendada <strong>"${escHtml(campanha.name)}"</strong> começou a disparar automaticamente com
      <strong>${pendentesCount}</strong> contatos pendentes, acima do teto conhecido de
      <strong>${cap}</strong> contatos únicos/24h do número. A Meta pode rejeitar parte dos envios em massa.
      O disparo prosseguiu mesmo assim (não há como pedir confirmação num disparo automático) — acompanhe o
      resultado e considere pausar se as falhas se acumularem.
    </div>
    <div style="margin:24px 0;text-align:center">
      <a href="${APP_URL}/dashboard/campanhas/${campanhaId}" style="background:#f59e0b;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver campanha →</a>
    </div>
    <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
  </div>`;
  await sendEmail(campanha.user.email, `⚠️ Campanha "${campanha.name}" acima do limite da Meta`, html);
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

  const startedAt = new Date();
  const claimed = await prisma.campanha.updateMany({
    where: { id: campanhaId, status: 'scheduled' },
    data: { status: 'running', startedAt },
  });
  if (claimed.count === 0) return; // outra réplica já iniciou

  // Sequência/drip (§15.2) — espelha o mesmo hook de POST /:id/start (api):
  // uma campanha agendada (em vez de iniciada manualmente) também pode ser mãe
  // de uma sequência; sem isso os passos-filhos nunca seriam agendados quando
  // o pai dispara pelo relógio em vez de clique do usuário.
  if (!campanha.sequenceParentId) {
    const steps = await prisma.campanha.findMany({ where: { sequenceParentId: campanhaId, status: 'draft' } });
    await Promise.all(steps.map((step) => prisma.campanha.update({
      where: { id: step.id },
      data: {
        status: 'scheduled',
        scheduledAt: new Date(startedAt.getTime() + step.sequenceDelayDays! * 24 * 60 * 60 * 1000),
        consentConfirmedAt: campanha.consentConfirmedAt,
        consentConfirmedIp: campanha.consentConfirmedIp,
      },
    })));
  }

  // Teto de tier conhecido (§11.13, gap do §9.3): diferente de /:id/start e
  // /:id/schedule, aqui não há usuário pra confirmar acima do tier — fail-open,
  // dispara mesmo assim (não vale travar um disparo já agendado às 3h da manhã),
  // mas avisa por e-mail. Usa o tier em CACHE, sem bater na Graph API aqui.
  if (campanha.channel !== 'evolution') {
    let combinedCap: number | null = 0;
    for (const n of sendNumbers) {
      const cap = tierToNumericCap((n as any).metaMessagingLimitTier);
      if (cap === null) continue;
      if (!Number.isFinite(cap)) { combinedCap = Infinity; continue; }
      if (combinedCap !== null && Number.isFinite(combinedCap)) combinedCap += cap;
    }
    if (combinedCap !== null && Number.isFinite(combinedCap) && pendentes.length > combinedCap) {
      logger.warn(`[Campanhas][Scheduler] Campanha ${campanhaId} dispara acima do tier conhecido (${pendentes.length} > ${combinedCap}) — prosseguindo mesmo assim (fail-open).`);
      notifyCampanhaExceedsTierAtFire(campanhaId, combinedCap, pendentes.length).catch((e: any) =>
        logger.warn(`[Campanhas][Scheduler] Falha ao notificar excesso de tier da campanha ${campanhaId}: ${e.message}`));
    }
  }

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
