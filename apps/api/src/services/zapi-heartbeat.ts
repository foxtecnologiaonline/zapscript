/**
 * zapi-heartbeat.ts
 *
 * Sincronização automática entre Z-API e banco de dados.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PRINCÍPIO FUNDAMENTAL DE SEGURANÇA                                    │
 * │                                                                         │
 * │  Auto-RECONECTAR  ✅  DB disconnected + Z-API online  → connected      │
 * │  Auto-DESCONECTAR ❌  NUNCA feito aqui automaticamente                  │
 * │                                                                         │
 * │  Desconexão real é sinalizada pela Z-API via DisconnectedCallback       │
 * │  (webhook confiável). Timeouts e respostas negativas pontuais da        │
 * │  API de status NÃO são evidência suficiente para desconectar.           │
 * │  Falsos positivos causam perda de mensagens e experiência ruim.         │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  A cada 5 minutos — Status Sync (apenas reconecta)                     │
 * │  • Busca TODOS os números com zapiInstanceId (qualquer status)          │
 * │  • Z-API online + DB não-connected → auto-reconecta                    │
 * │  • Z-API offline ou timeout → ignora, tenta na próxima rodada          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  A cada 1 hora — Webhook Sync                                           │
 * │  • Re-aplica URLs de webhook e auto-read em todos os conectados         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../lib/prisma';

const STATUS_INTERVAL_MS  =  5 * 60 * 1000;   // sync de status a cada 5 min
const WEBHOOK_INTERVAL_MS = 60 * 60 * 1000;   // webhook sync a cada 1 hora
const FIRST_STATUS_MS     =  1 * 60 * 1000;   // primeiro status check em 1 min
const FIRST_WEBHOOK_MS    = 10 * 60 * 1000;   // primeiro webhook sync em 10 min

// ── Helpers ────────────────────────────────────────────────────────────────

function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

function zapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  return headers;
}

function webhookBaseUrl(): string | null {
  // API_URL = URL da API no Render (ex: https://zapscript.onrender.com)
  // APP_URL = URL do frontend Vercel — NÃO usar para webhooks Z-API
  const base = process.env.API_URL || process.env.APP_URL;
  return base ? `${base.replace(/\/$/, '')}/webhook/zapi` : null;
}

// ── Verificar status real na Z-API ─────────────────────────────────────────
// Retorna:
//   true  → Z-API confirma online (connected ou smartphoneConnected)
//   false → Z-API confirma offline (resposta clara de desconexão)
//   null  → inconclusivo (timeout, erro de rede, formato inesperado)
//           → NÃO usar para desconectar — ignorar e tentar mais tarde

async function fetchZapiConnected(instanceId: string, token: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      zapiUrl(instanceId, token, '/status'),
      { headers: zapiHeaders(), signal: AbortSignal.timeout(10_000) }
    );

    if (!res.ok) return null; // erro HTTP — inconclusivo

    const data = await res.json() as any;

    // Suportar instâncias Web (connected) e Mobile (smartphoneConnected)
    if (data?.connected === true || data?.smartphoneConnected === true) return true;

    // Só retornar false se a resposta for explicitamente negativa em ambos os campos
    if (data && 'connected' in data) return false;

    // Formato desconhecido → inconclusivo
    return null;
  } catch {
    // Timeout ou erro de rede → inconclusivo, NÃO desconectar
    return null;
  }
}

// ── Status Sync — apenas auto-reconecta ────────────────────────────────────

export async function runStatusSync(log: any): Promise<void> {
  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { zapiInstanceId: { not: null }, zapiToken: { not: null } },
    select: {
      id:             true,
      userId:         true,
      zapiInstanceId: true,
      zapiToken:      true,
      status:         true,
      phoneNumber:    true,
      updatedAt:      true,
    },
  }).catch((err: any) => {
    log.error(`[Heartbeat] Erro ao buscar números: ${err.message}`);
    return [];
  });

  if (numbers.length === 0) return;

  // Agrupar por instância — uma chamada Z-API por instância (evita duplicatas)
  const byInstance = new Map<string, any[]>();
  for (const n of numbers) {
    const key = n.zapiInstanceId as string;
    if (!byInstance.has(key)) byInstance.set(key, []);
    byInstance.get(key)!.push(n);
  }

  let reconnected = 0;

  for (const [instanceId, group] of byInstance) {
    const repr = group[0]; // qualquer número do grupo para checar a instância

    const isConnected = await fetchZapiConnected(instanceId, repr.zapiToken as string);

    if (isConnected === null) {
      // Inconclusivo (timeout, rede) → não alterar nada
      continue;
    }

    if (isConnected) {
      // Z-API está online — garantir que exatamente um número esteja 'connected'.
      // Prioridade: connected > connecting > disconnected, depois mais recente.
      const sorted = [...group].sort((a: any, b: any) => {
        const priority: Record<string, number> = { connected: 0, connecting: 1, disconnected: 2 };
        const pa = priority[a.status] ?? 3;
        const pb = priority[b.status] ?? 3;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      });

      const winner = sorted[0];

      if (winner.status !== 'connected') {
        await prisma.whatsappNumber.update({
          where: { id: winner.id },
          data:  { status: 'connected', connectedAt: new Date() },
        }).catch(() => null);
        log.info(
          `[Heartbeat] ✅ Auto-reconectado: ${winner.id} (user ${winner.userId}) ` +
          `era '${winner.status}', Z-API está online`
        );
        reconnected++;
      }

      // NÃO desconectar os outros números do grupo.
      // Isolamento multi-tenant é responsabilidade do ConnectedCallback.
    }

    // isConnected === false → Z-API confirma offline.
    // Não alterar o banco aqui — o DisconnectedCallback da Z-API
    // (webhook confiável e em tempo real) cuidará disso quando ocorrer.
    // Desconectar via polling seria arriscado: instabilidade momentânea
    // do telefone ou da rede causaria falsos positivos a cada 5 minutos.

    await new Promise(r => setTimeout(r, 300));
  }

  if (reconnected > 0) {
    log.info(`[Heartbeat] Status Sync: ${reconnected} número(s) auto-reconectados`);
  }
}

// ── Webhook Sync — re-aplica webhooks em conectados ────────────────────────

export async function runWebhookSync(log: any): Promise<void> {
  const url = webhookBaseUrl();
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
    const iid   = n.zapiInstanceId as string;
    const token = n.zapiToken as string;

    const endpoints = [
      { path: '/update-webhook-received',              body: { value: url } },
      { path: '/update-webhook-connected',             body: { value: url } },
      { path: '/update-webhook-received-disconnected', body: { value: url } },
      { path: '/update-auto-read-message',             body: { value: false } },
    ];

    const results = await Promise.allSettled(
      endpoints.map(({ path, body }) =>
        fetch(zapiUrl(iid, token, path), {
          method:  'PUT',
          headers: zapiHeaders(),
          body:    JSON.stringify(body),
          signal:  AbortSignal.timeout(8_000),
        })
      )
    );

    if (results.some(r => r.status === 'fulfilled')) ok++;
    if (results.some(r => r.status === 'rejected'))  fail++;

    await new Promise(r => setTimeout(r, 300));
  }

  log.info(`[Heartbeat] Webhook Sync: ${ok} sincronizado(s)${fail ? `, ${fail} com erro` : ''}`);
}

// ── Inicialização ──────────────────────────────────────────────────────────

export function startHeartbeat(log: any): void {
  const t1 = setTimeout(
    () => runStatusSync(log).catch((e: any) => log.error(`[Heartbeat] ${e.message}`)),
    FIRST_STATUS_MS
  );
  const i1 = setInterval(
    () => runStatusSync(log).catch((e: any) => log.error(`[Heartbeat] ${e.message}`)),
    STATUS_INTERVAL_MS
  );
  const t2 = setTimeout(
    () => runWebhookSync(log).catch((e: any) => log.error(`[Heartbeat] ${e.message}`)),
    FIRST_WEBHOOK_MS
  );
  const i2 = setInterval(
    () => runWebhookSync(log).catch((e: any) => log.error(`[Heartbeat] ${e.message}`)),
    WEBHOOK_INTERVAL_MS
  );

  t1.unref(); i1.unref(); t2.unref(); i2.unref();

  log.info('[Heartbeat] ✅ Status Sync a cada 5min (1ª em 1min) | Webhook Sync a cada 1h (1ª em 10min)');
}

// Alias para compatibilidade
export const runHeartbeat = runStatusSync;
