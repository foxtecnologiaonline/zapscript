import { Queue } from 'bullmq';
import { redis } from './queue';
import { prisma } from '../lib/prisma';
import { getConnectionState, restartInstance, sendText } from './evolution';

// ── Configuração ──────────────────────────────────────────────────────────────
const INTERVAL_MS  = 60 * 60 * 1000;  // 1 hora
const FIRST_RUN_MS =  2 * 60 * 1000;  // 2 min após startup
const MAX_HISTORY  = 48;              // últimas 48 verificações (48h)

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface CheckResult {
  ok:         boolean;
  latencyMs?: number;
  error?:     string;
  detail?:    Record<string, unknown>;
}

export interface QueueCounts {
  waiting:   number;
  active:    number;
  failed:    number;
  completed: number;
  delayed:   number;
}

export interface HealthReport {
  ts:          string;
  status:      'ok' | 'warn' | 'critical';
  checks: {
    db:        CheckResult;
    redis:     CheckResult;
    queue:     CheckResult & QueueCounts;
    whatsapp:  CheckResult & { connected: number; mismatches: any[] };
    worker:    CheckResult & { recentProcessed: number; note: string };
    copiloto:  CheckResult & { aiOutagesLastHour: number; staleCrons: string[] };
  };
  alerts:      string[];
  suggestions: string[];
}

// ── Buffer em memória ─────────────────────────────────────────────────────────
export const history: HealthReport[] = [];
export let   lastReport: HealthReport | null = null;

// ── Check individual: banco de dados ─────────────────────────────────────────
async function checkDb(): Promise<CheckResult & { alertMsg?: string; suggestion?: string }> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    const slow = latencyMs > 2000; // Alerta apenas quando realmente crítico (>2s)
    return {
      ok: true,
      latencyMs,
      alertMsg:   slow ? `⚠️ Banco de dados muito lento: ${latencyMs}ms (>2s)` : undefined,
      suggestion: slow ? `Latência crítica no DB (${latencyMs}ms) — verificar conexões ativas no Supabase, índices e load do servidor` : undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error:     e.message,
      alertMsg:  `🔴 CRÍTICO: Banco de dados inacessível — ${e.message}`,
    };
  }
}

// ── Check individual: Redis ───────────────────────────────────────────────────
async function checkRedis(): Promise<CheckResult & { alertMsg?: string; suggestion?: string }> {
  const t0 = Date.now();
  try {
    await redis.ping();
    const latencyMs = Date.now() - t0;
    const slow = latencyMs > 600; // Upstash free tier no US → Brasil: latência normal 150-400ms
    return {
      ok: true,
      latencyMs,
      alertMsg:   slow ? `⚠️ Redis lento: ${latencyMs}ms` : undefined,
      suggestion: slow ? 'Redis (Upstash) com latência muito alta — considerar plano pago ou região BR' : undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error:     e.message,
      alertMsg:  `🔴 CRÍTICO: Redis inacessível — fila de jobs parada — ${e.message}`,
    };
  }
}

// ── Check individual: fila BullMQ ─────────────────────────────────────────────
async function checkQueue(): Promise<
  CheckResult & QueueCounts & { alertMsgs: string[]; suggestions: string[] }
> {
  const zero = { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 };
  try {
    const q = new Queue('transcriptions', { connection: redis as any });
    const [waiting, active, failed, completed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getFailedCount(),
      q.getCompletedCount(),
      q.getDelayedCount(),
    ]);
    await q.close();

    const alertMsgs: string[]  = [];
    const suggestions: string[] = [];

    if (failed >= 10) {
      alertMsgs.push(`🔴 Fila com ${failed} jobs falhos acumulados — conversões não entregues`);
      suggestions.push('Acesse o Monitor de Fila no painel admin e verifique o failedReason — URLs de áudio podem estar expirando antes do processamento');
    } else if (failed >= 3) {
      alertMsgs.push(`⚠️ ${failed} jobs falhos na fila — algumas conversões podem não ter sido entregues`);
      suggestions.push('Clique em "Re-tentar todos os falhos" no Monitor de Fila para recuperar conversões pendentes');
    }

    if (waiting >= 30) {
      alertMsgs.push(`🔴 Fila com ${waiting} jobs aguardando — worker sobrecarregado ou travado`);
      suggestions.push('Worker pode estar lento ou com OOM — verificar logs no Render e considerar reinício do serviço worker');
    } else if (waiting >= 10) {
      alertMsgs.push(`⚠️ ${waiting} jobs aguardando processamento — fila acumulando`);
      suggestions.push('Considerar aumentar concurrency do worker de 2 para 3 se a RAM do Render permitir (verificar uso de memória nos logs)');
    }

    if (active >= 4) {
      alertMsgs.push(`⚠️ ${active} jobs ativos simultâneos — risco de OOM no worker (512MB)`);
      suggestions.push('Reduzir concurrency para 1 temporariamente e reiniciar o worker para liberar memória');
    }

    if (completed > 2000) {
      suggestions.push(`Fila com ${completed} jobs concluídos acumulados — considerar limpeza periódica para economizar memória Redis`);
    }

    return { ok: true, waiting, active, failed, completed, delayed, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, ...zero, error: e.message, alertMsgs: [`🔴 Erro ao ler fila: ${e.message}`], suggestions: [] };
  }
}

// ── Check individual: WhatsApp (Evolution API) ────────────────────────────────
async function checkWhatsApp(): Promise<
  CheckResult & { connected: number; mismatches: any[]; alertMsgs: string[]; suggestions: string[] }
> {
  const alertMsgs: string[]  = [];
  const suggestions: string[] = [];
  const mismatches: any[]    = [];

  try {
    const numbers = await (prisma as any).whatsappNumber.findMany({
      where:  { zapiInstanceId: { not: null } },
      select: { id: true, userId: true, phoneNumber: true, status: true, zapiInstanceId: true },
    });

    const connected = numbers.filter((n: any) => n.status === 'connected').length;

    if (connected === 0) {
      alertMsgs.push('⚠️ Nenhum número WhatsApp conectado — novos áudios não serão processados');
      suggestions.push('Acessar Meu Número no dashboard e conectar o WhatsApp via QR Code ou código de pareamento');
    }

    // Verificar mismatch DB vs Evolution real (apenas os "connected" no banco).
    // 'connecting' e null (timeout/rede) são inconclusivos — não mexe, evita
    // falso positivo por instabilidade momentânea (mesmo princípio do heartbeat).
    // Só 'close' é tratado como problema real: primeiro tenta reconectar sozinho
    // (restartInstance reabre o socket com a sessão já salva, sem QR novo); só
    // vira alerta de verdade + correção de status no banco se o restart não
    // resolver — nesse ponto é muito provável que a sessão do WhatsApp foi
    // encerrada de fato (logout/banimento/conflito) e só um novo QR/pareamento,
    // feito pelo usuário, resolve — isso é uma garantia do próprio WhatsApp
    // (Baileys/multi-device), não uma limitação nossa que dê pra automatizar.
    const connectedNumbers = numbers.filter((n: any) => n.status === 'connected');
    for (const n of connectedNumbers) {
      try {
        const state = await getConnectionState(n.zapiInstanceId);
        if (state === 'open') continue;
        if (state !== 'close') {
          // 'connecting' ou null — inconclusivo, só registra, sem ação
          mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, evolutionState: state });
          continue;
        }

        // state === 'close' → tenta reconectar sozinho antes de alertar
        const restarted = await restartInstance(n.zapiInstanceId).catch(() => false);
        if (restarted) {
          await new Promise(r => setTimeout(r, 5_000)); // dá tempo do Baileys reabrir o socket
          const stateAfter = await getConnectionState(n.zapiInstanceId);
          if (stateAfter === 'open') {
            mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, evolutionState: state, autoRecovered: true });
            continue; // resolvido sozinho — sem alerta
          }
        }

        // Restart não resolveu (ou falhou) — desconexão real. Corrige o status
        // no banco (evita o dashboard mostrar "conectado" quando não está) e
        // alerta de verdade, com ação clara pro usuário.
        mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, evolutionState: state, autoRecovered: false });
        alertMsgs.push(
          `🔴 WhatsApp desconectado de fato: número ${n.phoneNumber || n.id} (usuário ${n.userId}) estava 'connected' no banco mas a Evolution API reporta '${state}' — reconexão automática não resolveu`
        );
        suggestions.push(
          `Número ${n.phoneNumber || n.id} (usuário ${n.userId}): provavelmente a sessão do WhatsApp foi encerrada (logout pelo celular, conflito com outro dispositivo, ou banimento) — só um novo QR Code/código de pareamento no painel resolve, precisa ser feito pelo usuário`
        );
        await prisma.whatsappNumber.update({
          where: { id: n.id },
          data:  { status: 'disconnected' },
        }).catch(() => null);
      } catch (e: any) {
        mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, error: e.message });
      }
    }

    return { ok: true, connected, mismatches, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, connected: 0, mismatches, error: e.message, alertMsgs: [`⚠️ Erro ao verificar WhatsApp: ${e.message}`], suggestions };
  }
}

// ── Check individual: worker (indireto via conversões recentes) ─────────────
async function checkWorker(queue: QueueCounts): Promise<
  CheckResult & { recentProcessed: number; note: string; alertMsgs: string[]; suggestions: string[] }
> {
  const alertMsgs: string[]  = [];
  const suggestions: string[] = [];
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentProcessed = await prisma.transcription.count({
      where: { createdAt: { gte: twoHoursAgo } },
    });

    // Worker travado: jobs esperando/falhando mas nada sendo processado
    const workerStalled = queue.waiting > 0 && queue.failed > 0 && recentProcessed === 0;
    if (workerStalled) {
      alertMsgs.push('🔴 Worker possivelmente travado: jobs aguardando + falhos, mas 0 conversões nas últimas 2h');
      suggestions.push('Verificar logs do serviço worker no Render — reiniciar o worker pela dashboard do Render');
    }

    const note = workerStalled
      ? 'Nenhuma conversão processada nas últimas 2h com fila ativa'
      : `${recentProcessed} conversão(ões) processada(s) nas últimas 2h`;

    // Sugestão de performance: jobs rápidos vs lentos
    if (recentProcessed > 50) {
      suggestions.push(`Alta taxa de processamento (${recentProcessed} conversões/2h) — considerar aumentar concurrency para 3 se RAM < 70%`);
    }

    // Blind spot descoberto em produção (2026-09-09, ~13h30 sem nenhuma conversão):
    // quando os jobs de áudio nem chegam a ENTRAR na fila (0 waiting, 0 failed —
    // ex: webhook não entrega, ou algo falha antes do transcriptionQueue.add), o
    // alerta de "worker travado" acima nunca dispara — a fila "vazia" parece
    // saudável. Checa direto pelo sintoma que interessa: silêncio prolongado de
    // conversões apesar de haver número WhatsApp conectado, independente do
    // estado da fila BullMQ.
    const STALE_HOURS = parseInt(process.env.WORKER_STALE_HOURS || '3', 10);
    const staleSince = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    const [connectedCount, processedInStaleWindow] = await Promise.all([
      prisma.whatsappNumber.count({ where: { status: 'connected' } }),
      prisma.transcription.count({ where: { createdAt: { gte: staleSince } } }),
    ]);
    const conversionSilent = !workerStalled && connectedCount > 0 && processedInStaleWindow === 0;
    if (conversionSilent) {
      alertMsgs.push(
        `🔴 Nenhuma conversão nas últimas ${STALE_HOURS}h apesar de ${connectedCount} número(s) WhatsApp conectado(s) — fila BullMQ vazia (não é cota nem travamento de worker), então o áudio provavelmente não está chegando na fila`
      );
      suggestions.push(
        'Mandar um áudio de teste pro próprio número conectado e observar os logs do worker no servidor em tempo real — se nada aparecer, o problema é upstream (webhook da Evolution não entregando o evento de áudio), não o worker'
      );
    }

    return { ok: !workerStalled && !conversionSilent, recentProcessed, note, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, recentProcessed: 0, note: `Erro: ${e.message}`, alertMsgs: [], suggestions };
  }
}

// ── Check individual: Copiloto (IA + crons do worker) ─────────────────────────
// api e worker são processos/imagens Docker separados — só o banco liga os
// dois. "Todos os provedores de IA caíram juntos" (SystemError com
// service='copiloto-ai', gravado por apps/worker/src/copiloto.ts) e "um cron
// do worker parou de rodar" (CronHeartbeat, escrito a cada rodada de
// runCopilotoGroupDigests/runCopilotoPendingSweep/runCopilotoTechniqueRecap)
// eram invisíveis até agora — só apareciam no docker logs do worker.
const COPILOTO_CRON_STALE_HOURS: Record<string, number> = {
  copiloto_group_digest:    3,      // poll a cada 30min
  copiloto_pending_sweep:   4,      // poll a cada 1h
  copiloto_technique_recap: 24 * 9, // só roda às segundas — 9 dias cobre 1 semana perdida sem falso positivo
};

async function checkCopiloto(): Promise<
  CheckResult & { aiOutagesLastHour: number; staleCrons: string[]; alertMsgs: string[]; suggestions: string[] }
> {
  const alertMsgs: string[] = [];
  const suggestions: string[] = [];
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const aiOutagesLastHour = await prisma.systemError.count({
      where: { service: 'copiloto-ai', createdAt: { gte: hourAgo } },
    });
    if (aiOutagesLastHour >= 3) {
      alertMsgs.push(`🔴 Copiloto: ${aiOutagesLastHour} falha(s) de IA (todos os provedores) na última hora`);
      suggestions.push('Checar chaves de API (Anthropic/OpenAI/Groq/Gemini) e a env var AI_SKIP_PROVIDERS — provável apagão de todos os provedores ao mesmo tempo');
    }

    const heartbeats = await (prisma as any).cronHeartbeat.findMany({
      where: { jobName: { in: Object.keys(COPILOTO_CRON_STALE_HOURS) } },
    });
    const byName = new Map(heartbeats.map((h: any) => [h.jobName, h]));
    const staleCrons: string[] = [];
    for (const [jobName, staleHours] of Object.entries(COPILOTO_CRON_STALE_HOURS)) {
      const hb: any = byName.get(jobName);
      const staleSince = new Date(Date.now() - staleHours * 60 * 60 * 1000);
      if (!hb?.lastOkAt || hb.lastOkAt < staleSince) {
        staleCrons.push(jobName);
        alertMsgs.push(
          `🔴 Copiloto: cron "${jobName}" sem rodar com sucesso há mais de ${staleHours}h` +
          (hb?.lastErrorMessage ? ` — último erro: ${hb.lastErrorMessage.slice(0, 150)}` : ' — nunca rodou com sucesso'),
        );
        suggestions.push(`Verificar logs do worker pra "${jobName}" — pode estar travado ou o processo reiniciando em loop`);
      }
    }

    return { ok: aiOutagesLastHour < 3 && staleCrons.length === 0, aiOutagesLastHour, staleCrons, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, aiOutagesLastHour: 0, staleCrons: [], error: e.message, alertMsgs: [`⚠️ Erro ao verificar Copiloto: ${e.message}`], suggestions };
  }
}

// ── Sugestões gerais de performance ──────────────────────────────────────────
function generalSuggestions(report: Omit<HealthReport, 'suggestions'>): string[] {
  const s: string[] = [];
  const { db, redis, queue } = report.checks;

  if (db.ok && db.latencyMs && db.latencyMs < 30)
    s.push('✅ Banco de dados com ótima performance — sem otimizações necessárias no momento');

  if (redis.ok && redis.latencyMs && redis.latencyMs < 20)
    s.push('✅ Redis respondendo muito rápido — fila de jobs em boa forma');

  if (queue.ok && queue.failed === 0 && queue.waiting === 0)
    s.push('✅ Fila limpa — todos os jobs processados com sucesso');

  if (queue.completed > 500 && queue.failed === 0)
    s.push('📈 Sistema processando bem — considerar revisão de limites de plano conforme crescimento');

  return s;
}

// ── Notificação WhatsApp para admin via Evolution API ─────────────────────────
async function notifyAdmin(report: HealthReport, log: any): Promise<void> {
  const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
  if (!adminPhone) return;

  try {
    // ADMIN_INSTANCE_NAME: instância dedicada do admin (env var obrigatória para notificações).
    // Sem ela, o sistema usaria o número de um cliente aleatório — não fazer isso.
    const adminInstanceName = process.env.ADMIN_INSTANCE_NAME;
    if (!adminInstanceName) {
      log.warn('[Health Monitor] ADMIN_INSTANCE_NAME não configurado — notificação admin desabilitada');
      return;
    }

    const number = await (prisma as any).whatsappNumber.findFirst({
      where:  { zapiInstanceId: adminInstanceName, status: 'connected' },
      select: { zapiInstanceId: true },
    });
    if (!number) {
      log.warn(`[Health Monitor] Instância admin "${adminInstanceName}" não encontrada ou desconectada`);
      return;
    }

    const icon = report.status === 'critical' ? '🔴' : '⚠️';
    const lines = [
      `${icon} *ZapScript — Monitor ${report.status.toUpperCase()}*`,
      `📅 ${new Date(report.ts).toLocaleString('pt-BR')}`,
      '',
      '*Alertas detectados:*',
      ...report.alerts.map(a => `• ${a}`),
    ];

    if (report.suggestions.filter(s => !s.startsWith('✅')).length > 0) {
      lines.push('', '*Sugestões:*');
      report.suggestions.filter(s => !s.startsWith('✅')).forEach(s => lines.push(`• ${s}`));
    }

    lines.push(
      '',
      `📊 Fila: ⏳${report.checks.queue.waiting} aguard. | ▶️${report.checks.queue.active} ativos | ❌${report.checks.queue.failed} falhos`,
      `🔗 DB: ${report.checks.db.latencyMs ?? '—'}ms | Redis: ${report.checks.redis.latencyMs ?? '—'}ms`,
    );

    await sendText(number.zapiInstanceId, adminPhone, lines.join('\n'));
    log.info(`[Health Monitor] 📲 Notificação enviada para admin (${adminPhone})`);
  } catch (e: any) {
    log.warn(`[Health Monitor] Falha ao notificar admin via WhatsApp: ${e.message}`);
  }
}

// ── Execução principal ────────────────────────────────────────────────────────
export async function runHealthCheck(log: any): Promise<HealthReport> {
  log.info('[Health Monitor] 🔍 Iniciando verificação de saúde...');

  const [dbRes, redisRes, queueRes] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkQueue(),
  ]);

  const [waRes, workerRes, copilotoRes] = await Promise.all([
    checkWhatsApp(),
    checkWorker(queueRes),
    checkCopiloto(),
  ]);

  const alerts: string[] = [
    ...(dbRes.alertMsg     ? [dbRes.alertMsg]     : []),
    ...(redisRes.alertMsg  ? [redisRes.alertMsg]  : []),
    ...queueRes.alertMsgs,
    ...waRes.alertMsgs,
    ...workerRes.alertMsgs,
    ...copilotoRes.alertMsgs,
  ];

  const rawSuggestions: string[] = [
    ...(dbRes.suggestion    ? [dbRes.suggestion]    : []),
    ...(redisRes.suggestion ? [redisRes.suggestion] : []),
    ...queueRes.suggestions,
    ...waRes.suggestions,
    ...workerRes.suggestions,
    ...copilotoRes.suggestions,
  ];

  const { alertMsgs: _qa, suggestions: _qs, ...queueCounts } = queueRes;

  const report: Omit<HealthReport, 'suggestions'> = {
    ts:     new Date().toISOString(),
    status: alerts.some(a => a.startsWith('🔴')) ? 'critical'
          : alerts.some(a => a.startsWith('⚠️')) ? 'warn' : 'ok',
    checks: {
      db:       { ok: dbRes.ok,    latencyMs: dbRes.latencyMs,    error: dbRes.error },
      redis:    { ok: redisRes.ok, latencyMs: redisRes.latencyMs, error: redisRes.error },
      queue:    queueCounts,
      whatsapp: { ok: waRes.ok,    connected: waRes.connected,    mismatches: waRes.mismatches, error: waRes.error },
      worker:   { ok: workerRes.ok, recentProcessed: workerRes.recentProcessed, note: workerRes.note },
      copiloto: { ok: copilotoRes.ok, aiOutagesLastHour: copilotoRes.aiOutagesLastHour, staleCrons: copilotoRes.staleCrons, error: copilotoRes.error },
    },
    alerts,
  };

  const suggestions = [...rawSuggestions, ...generalSuggestions(report)];
  const fullReport: HealthReport = { ...report, suggestions };

  // ── Histórico em memória ──────────────────────────────────
  history.push(fullReport);
  if (history.length > MAX_HISTORY) history.shift();
  lastReport = fullReport;

  // ── Gravar alertas no systemError ─────────────────────────
  if (alerts.length > 0) {
    for (const alert of alerts) {
      await prisma.systemError.create({
        data: {
          service: 'health-monitor',
          message: alert,
          stack:   JSON.stringify({
            suggestions: suggestions.filter(s => !s.startsWith('✅')),
            queue: { waiting: queueRes.waiting, active: queueRes.active, failed: queueRes.failed },
            ts:    fullReport.ts,
          }),
        },
      }).catch(() => null);
    }
  }

  // ── Notificar admin via WhatsApp se houver alertas ────────
  if (alerts.length > 0) {
    await notifyAdmin(fullReport, log);
  }

  log.info(
    `[Health Monitor] ${fullReport.status.toUpperCase()} | ` +
    `DB:${dbRes.latencyMs ?? 'ERR'}ms Redis:${redisRes.latencyMs ?? 'ERR'}ms | ` +
    `Queue(⏳${queueRes.waiting} ▶️${queueRes.active} ❌${queueRes.failed}) | ` +
    `WhatsApp:${waRes.connected} online | Worker:${workerRes.recentProcessed}/2h | ` +
    `Alertas:${alerts.length}`
  );

  return fullReport;
}

// ── Inicialização ─────────────────────────────────────────────────────────────
export function startHealthMonitor(log: any): void {
  const firstRun = setTimeout(
    () => runHealthCheck(log).catch((e: any) => log.error(`[Health Monitor] Erro: ${e.message}`)),
    FIRST_RUN_MS
  );
  const interval = setInterval(
    () => runHealthCheck(log).catch((e: any) => log.error(`[Health Monitor] Erro: ${e.message}`)),
    INTERVAL_MS
  );
  firstRun.unref();
  interval.unref();
  log.info('[Health Monitor] ✅ Iniciado — primeira verificação em 2 min, depois a cada 1 hora');
}
