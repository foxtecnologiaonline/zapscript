/**
 * zapi-heartbeat.ts
 *
 * Sincronização automática e bidirecional entre Z-API e banco de dados.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  A cada 5 minutos — Status Sync                                        │
 * │  • Verifica TODOS os números com zapiInstanceId (qualquer status no DB) │
 * │  • Z-API connected  + DB disconnected → atualiza para connected ✅     │
 * │  • Z-API connected  + DB connecting  → confirma connected ✅           │
 * │  • Z-API disconnected + DB connected  → atualiza para disconnected ⚠️  │
 * │  Resultado: DB sempre espelha o estado real sem ação do usuário        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  A cada 1 hora — Webhook Sync                                           │
 * │  • Re-aplica URLs de webhook e auto-read em todos os conectados        │
 * │  • Garante que eventos continuem chegando após mudanças de URL         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../lib/prisma';

const STATUS_INTERVAL_MS  =  5 * 60 * 1000;  // status sync a cada 5 minutos
const WEBHOOK_INTERVAL_MS = 60 * 60 * 1000;  // webhook sync a cada 1 hora
const FIRST_STATUS_MS     =  1 * 60 * 1000;  // primeiro status check em 1 min (após estabilizar)
const FIRST_WEBHOOK_MS    = 10 * 60 * 1000;  // primeiro webhook sync em 10 min

// ── Helpers ────────────────────────────────────────────────────────────────

function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

function zapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  return headers;
}

function webhookUrl(): string | null {
  const base = process.env.APP_URL || process.env.API_URL;
  return base ? `${base}/webhook/zapi` : null;
}

// ── Status de um número via Z-API API ──────────────────────────────────────

async function fetchZapiStatus(
  instanceId: string,
  token: string,
): Promise<{ connected: boolean; phone?: string } | null> {
  try {
    const res = await fetch(
      zapiUrl(instanceId, token, '/status'),
      { headers: zapiHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      connected: data?.connected === true,
      phone:     data?.phone ?? data?.smartphoneConnected?.phone ?? undefined,
    };
  } catch {
    return null; // timeout ou erro de rede — não alterar status
  }
}

// ── Status Sync — verifica todos os números e corrige DB ───────────────────

export async function runStatusSync(log: any): Promise<void> {
  // Busca TODOS os números com credenciais Z-API (qualquer status)
  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { zapiInstanceId: { not: null }, zapiToken: { not: null } },
    select: { id: true, userId: true, zapiInstanceId: true, zapiToken: true, status: true, phoneNumber: true },
  }).catch((err: any) => {
    log.error(`[Heartbeat] Erro ao buscar números: ${err.message}`);
    return [];
  });

  if (numbers.length === 0) return;

  // Agrupar por instância — só verificar uma vez por instância (evita chamadas duplicadas)
  const byInstance = new Map<string, typeof numbers[number][]>();
  for (const n of numbers) {
    const key = n.zapiInstanceId as string;
    if (!byInstance.has(key)) byInstance.set(key, []);
    byInstance.get(key)!.push(n);
  }

  let reconnected = 0, disconnected = 0, stable = 0;

  for (const [instanceId, group] of byInstance) {
    // Usar credenciais do primeiro número do grupo para checar status da instância
    const repr  = group[0];
    const status = await fetchZapiStatus(instanceId, repr.zapiToken as string);

    if (status === null) {
      // Timeout / erro de rede — não alterar nada, tentar na próxima rodada
      continue;
    }

    if (status.connected) {
      // Z-API está conectado — garantir que EXATAMENTE UM número esteja "connected"
      // Estratégia: pegar o mais recentemente atualizado do grupo e marcar como connected.
      // Desconectar os demais (isolamento).
      const sorted = [...group].sort((a: any, b: any) =>
        new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      );
      const [winner, ...losers] = sorted;

      if (winner.status !== 'connected') {
        await prisma.whatsappNumber.update({
          where: { id: winner.id },
          data:  {
            status:      'connected',
            connectedAt: new Date(),
            ...(status.phone ? { phoneNumber: status.phone.replace(/\D/g, '') } : {}),
          },
        }).catch(() => null);
        log.info(
          `[Heartbeat] ✅ Auto-reconectado: número ${winner.id} (user ${winner.userId}) ` +
          `— estava '${winner.status}', Z-API está online`
        );
        reconnected++;
      } else {
        stable++;
      }

      // Desconectar os demais do grupo (isolamento multi-tenant)
      if (losers.length > 0) {
        const loserIds = losers.map((l: any) => l.id);
        await prisma.whatsappNumber.updateMany({
          where: { id: { in: loserIds }, status: { in: ['connected', 'connecting'] } },
          data:  { status: 'disconnected' },
        }).catch(() => null);
      }
    } else {
      // Z-API desconectado — garantir que todos do grupo estejam disconnected
      const activeInGroup = group.filter((n: any) => n.status === 'connected' || n.status === 'connecting');
      if (activeInGroup.length > 0) {
        await prisma.whatsappNumber.updateMany({
          where: { id: { in: activeInGroup.map((n: any) => n.id) } },
          data:  { status: 'disconnected' },
        }).catch(() => null);
        for (const n of activeInGroup) {
          log.warn(
            `[Heartbeat] ⚠️  Auto-desconectado: número ${n.id} (user ${n.userId}) ` +
            `— estava '${n.status}', Z-API está offline`
          );
          disconnected++;
        }
      } else {
        stable++;
      }
    }

    // Pausa entre instâncias para não sobrecarregar Z-API
    await new Promise(r => setTimeout(r, 300));
  }

  if (reconnected > 0 || disconnected > 0) {
    log.info(
      `[Heartbeat] Status Sync: ${reconnected} auto-reconectados, ${disconnected} desconectados, ${stable} estáveis`
    );
  }
}

// ── Webhook Sync — re-aplica webhooks em todos os conectados ───────────────

export async function runWebhookSync(log: any): Promise<void> {
  const url = webhookUrl();
  if (!url) {
    log.warn('[Heartbeat] APP_URL/API_URL não configurado — webhook sync ignorado');
    return;
  }

  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { status: 'connected', zapiInstanceId: { not: null }, zapiToken: { not: null } },
    select: { id: true, zapiInstanceId: true, zapiToken: true },
  }).catch(() => []);

  if (numbers.length === 0) return;

  let ok = 0, fail = 0;

  for (const n of numbers) {
    const instanceId = n.zapiInstanceId as string;
    const token      = n.zapiToken as string;

    const endpoints = [
      { path: '/update-webhook-received',             body: { value: url } },
      { path: '/update-webhook-connected',            body: { value: url } },
      { path: '/update-webhook-received-disconnected',body: { value: url } },
      { path: '/update-auto-read-message',            body: { value: false } },
    ];

    const results = await Promise.allSettled(
      endpoints.map(({ path, body }) =>
        fetch(zapiUrl(instanceId, token, path), {
          method:  'PUT',
          headers: zapiHeaders(),
          body:    JSON.stringify(body),
          signal:  AbortSignal.timeout(8_000),
        })
      )
    );

    const numOk   = results.filter(r => r.status === 'fulfilled').length;
    const numFail = results.filter(r => r.status === 'rejected').length;
    if (numOk > 0) ok++;
    if (numFail > 0) fail++;

    await new Promise(r => setTimeout(r, 300));
  }

  log.info(`[Heartbeat] Webhook Sync: ${ok} número(s) sincronizados, ${fail} com erro`);
}

// ── Inicialização ──────────────────────────────────────────────────────────

export function startHeartbeat(log: any): void {
  // ── Status Sync (a cada 5 min) ──────────────────────────────────────────
  const firstStatus = setTimeout(
    () => runStatusSync(log).catch((e: any) => log.error(`[Heartbeat] Erro status sync: ${e.message}`)),
    FIRST_STATUS_MS
  );
  const statusInterval = setInterval(
    () => runStatusSync(log).catch((e: any) => log.error(`[Heartbeat] Erro status sync: ${e.message}`)),
    STATUS_INTERVAL_MS
  );

  // ── Webhook Sync (a cada 1 hora) ────────────────────────────────────────
  const firstWebhook = setTimeout(
    () => runWebhookSync(log).catch((e: any) => log.error(`[Heartbeat] Erro webhook sync: ${e.message}`)),
    FIRST_WEBHOOK_MS
  );
  const webhookInterval = setInterval(
    () => runWebhookSync(log).catch((e: any) => log.error(`[Heartbeat] Erro webhook sync: ${e.message}`)),
    WEBHOOK_INTERVAL_MS
  );

  firstStatus.unref();
  statusInterval.unref();
  firstWebhook.unref();
  webhookInterval.unref();

  log.info(
    '[Heartbeat] ✅ Iniciado — Status Sync a cada 5min (1ª em 1min) | Webhook Sync a cada 1h (1ª em 10min)'
  );
}

// ── Exportar runHeartbeat como alias para compatibilidade ──────────────────
export const runHeartbeat = runStatusSync;
