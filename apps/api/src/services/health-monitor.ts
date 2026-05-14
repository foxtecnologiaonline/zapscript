import { Queue } from 'bullmq';
import axios from 'axios';
import { redis } from './queue';
import { prisma } from '../lib/prisma';

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
    db:     CheckResult;
    redis:  CheckResult;
    queue:  CheckResult & QueueCounts;
    zapi:   CheckResult & { connected: number; mismatches: any[] };
    worker: CheckResult & { recentProcessed: number; note: string };
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
    const slow = latencyMs > 400;
    return {
      ok: true,
      latencyMs,
      alertMsg:   slow ? `⚠️ Banco de dados lento: ${latencyMs}ms` : undefined,
      suggestion: slow ? 'Latência alta no DB — verificar conexões ativas no Supabase/PgBouncer e índices de queries lentas' : undefined,
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
    const slow = latencyMs > 250;
    return {
      ok: true,
      latencyMs,
      alertMsg:   slow ? `⚠️ Redis lento: ${latencyMs}ms` : undefined,
      suggestion: slow ? 'Redis (Upstash) com latência alta — verificar plano e região configurada' : undefined,
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
    const q = new Queue('transcriptions', { connection: redis });
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
      alertMsgs.push(`🔴 Fila com ${failed} jobs falhos acumulados — transcrições não entregues`);
      suggestions.push('Acesse o Monitor de Fila no painel admin e verifique o failedReason — URLs de áudio podem estar expirando antes do processamento');
    } else if (failed >= 3) {
      alertMsgs.push(`⚠️ ${failed} jobs falhos na fila — algumas transcrições podem não ter sido entregues`);
      suggestions.push('Clique em "Re-tentar todos os falhos" no Monitor de Fila para recuperar transcrições pendentes');
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

// ── Check individual: Z-API ───────────────────────────────────────────────────
async function checkZapi(): Promise<
  CheckResult & { connected: number; mismatches: any[]; alertMsgs: string[]; suggestions: string[] }
> {
  const alertMsgs: string[]  = [];
  const suggestions: string[] = [];
  const mismatches: any[]    = [];

  try {
    const numbers = await (prisma as any).whatsappNumber.findMany({
      where:  { zapiInstanceId: { not: null } },
      select: { id: true, userId: true, phoneNumber: true, status: true, zapiInstanceId: true, zapiToken: true },
    });

    const connected = numbers.filter((n: any) => n.status === 'connected').length;

    if (connected === 0) {
      alertMsgs.push('⚠️ Nenhum número WhatsApp conectado — novos áudios não serão processados');
      suggestions.push('Acessar Meu Número no dashboard e conectar o WhatsApp via QR Code ou código de pareamento');
    }

    // Verificar mismatch DB vs Z-API real (apenas os "connected" no banco)
    const connectedNumbers = numbers.filter((n: any) => n.status === 'connected');
    for (const n of connectedNumbers) {
      try {
        const headers: Record<string, string> = {};
        if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
        const res = await axios.get(
          `https://api.z-api.io/instances/${n.zapiInstanceId}/token/${n.zapiToken}/status`,
          { headers, timeout: 8_000 }
        );
        // Aceitar Web (connected) e Mobile (smartphoneConnected)
        const zapiOk = res.data?.connected === true || res.data?.smartphoneConnected === true;
        if (!zapiOk) {
          mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, zapiStatus: res.data });
          alertMsgs.push(
            `⚠️ Número ${n.phoneNumber || n.id} — banco diz CONNECTED mas Z-API reportou offline. ` +
            `Pode ser instabilidade momentânea. Será resolvido automaticamente se persistir.`
          );
          // NÃO desconectar automaticamente aqui — desconexão real vem via
          // DisconnectedCallback (webhook confiável). Alterar status por polling
          // da API de status causa falsos positivos e desconexões desnecessárias.
        }
      } catch (e: any) {
        mismatches.push({ id: n.id, phoneNumber: n.phoneNumber, error: e.message });
      }
    }

    if (mismatches.length > 0) {
      suggestions.push('Se o mismatch persistir nas próximas verificações, o número pode precisar ser reconectado manualmente');
    }

    return { ok: mismatches.length === 0, connected, mismatches, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, connected: 0, mismatches, error: e.message, alertMsgs: [`⚠️ Erro ao verificar Z-API: ${e.message}`], suggestions };
  }
}

// ── Check individual: worker (indireto via transcrições recentes) ─────────────
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
      alertMsgs.push('🔴 Worker possivelmente travado: jobs aguardando + falhos, mas 0 transcrições nas últimas 2h');
      suggestions.push('Verificar logs do serviço worker no Render — reiniciar o worker pela dashboard do Render');
    }

    const note = workerStalled
      ? 'Nenhuma transcrição processada nas últimas 2h com fila ativa'
      : `${recentProcessed} transcrição(ões) processada(s) nas últimas 2h`;

    // Sugestão de performance: jobs rápidos vs lentos
    if (recentProcessed > 50) {
      suggestions.push(`Alta taxa de processamento (${recentProcessed} transcrições/2h) — considerar aumentar concurrency para 3 se RAM < 70%`);
    }

    return { ok: !workerStalled, recentProcessed, note, alertMsgs, suggestions };
  } catch (e: any) {
    return { ok: false, recentProcessed: 0, note: `Erro: ${e.message}`, alertMsgs: [], suggestions };
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

// ── Notificação WhatsApp para admin ──────────────────────────────────────────
async function notifyAdmin(report: HealthReport, log: any): Promise<void> {
  const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
  if (!adminPhone) return;

  try {
    const number = await (prisma as any).whatsappNumber.findFirst({
      where:  { status: 'connected', zapiInstanceId: { not: null } },
      select: { zapiInstanceId: true, zapiToken: true },
    });
    if (!number) return; // sem número conectado para enviar

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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;

    await axios.post(
      `https://api.z-api.io/instances/${number.zapiInstanceId}/token/${number.zapiToken}/send-text`,
      { phone: adminPhone, message: lines.join('\n') },
      { headers, timeout: 10_000 }
    );
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

  // Z-API e worker dependem do estado da queue (evita duplo trabalho)
  const [zapiRes, workerRes] = await Promise.all([
    checkZapi(),
    checkWorker(queueRes),
  ]);

  // Consolidar alertas e sugestões
  const alerts: string[] = [
    ...(dbRes.alertMsg     ? [dbRes.alertMsg]     : []),
    ...(redisRes.alertMsg  ? [redisRes.alertMsg]  : []),
    ...queueRes.alertMsgs,
    ...zapiRes.alertMsgs,
    ...workerRes.alertMsgs,
  ];

  const rawSuggestions: string[] = [
    ...(dbRes.suggestion    ? [dbRes.suggestion]    : []),
    ...(redisRes.suggestion ? [redisRes.suggestion] : []),
    ...queueRes.suggestions,
    ...zapiRes.suggestions,
    ...workerRes.suggestions,
  ];

  // Extrair só os campos de contagem da fila (descartar alertMsgs/suggestions internos)
  const { alertMsgs: _qa, suggestions: _qs, ...queueCounts } = queueRes;

  const report: Omit<HealthReport, 'suggestions'> = {
    ts:     new Date().toISOString(),
    status: alerts.some(a => a.startsWith('🔴')) ? 'critical'
          : alerts.some(a => a.startsWith('⚠️')) ? 'warn' : 'ok',
    checks: {
      db:     { ok: dbRes.ok,    latencyMs: dbRes.latencyMs,    error: dbRes.error },
      redis:  { ok: redisRes.ok, latencyMs: redisRes.latencyMs, error: redisRes.error },
      queue:  queueCounts,
      zapi:   { ok: zapiRes.ok,  connected: zapiRes.connected, mismatches: zapiRes.mismatches, error: zapiRes.error },
      worker: { ok: workerRes.ok, recentProcessed: workerRes.recentProcessed, note: workerRes.note },
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
    `Z-API:${zapiRes.connected} online | Worker:${workerRes.recentProcessed}/2h | ` +
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
