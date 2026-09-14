/**
 * evolution-heartbeat.ts
 *
 * Sincronização periódica: status e webhooks.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PRINCÍPIO FUNDAMENTAL DE SEGURANÇA                                    │
 * │                                                                         │
 * │  Auto-RECONECTAR  ✅  DB disconnected + Evolution online  → connected   │
 * │  Auto-DESCONECTAR ❌  NUNCA feito aqui — apenas via connection.update   │
 * │                                                                         │
 * │  Falsos positivos causam perda de mensagens e experiência ruim.        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  A cada 5 minutos — Status Sync (apenas reconecta)                     │
 * │  A cada 1 hora    — Webhook Sync (re-aplica webhooks)                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../lib/prisma';
import { getConnectionState, setWebhook, setGroupsIgnore } from './evolution';
import { getUserModules } from '../lib/moduleGate';
import { backfillUnreadConversations } from './copiloto-backfill';

const STATUS_INTERVAL_MS  =  5 * 60 * 1000;
const WEBHOOK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_STATUS_MS     =  1 * 60 * 1000;
const FIRST_WEBHOOK_MS    = 10 * 60 * 1000;

function getWebhookUrl(): string | null {
  const base = process.env.API_URL || process.env.APP_URL;
  if (!base) return null;
  const url    = `${base.replace(/\/$/, '')}/webhook/evolution`;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

// ── Status Sync — apenas auto-reconecta ────────────────────────────────────────

export async function runStatusSync(log: any): Promise<void> {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;

  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { zapiInstanceId: { not: null } },
    select: { id: true, userId: true, zapiInstanceId: true, status: true, phoneNumber: true },
  }).catch(() => []);

  if (numbers.length === 0) return;

  let reconnected = 0;

  for (const n of numbers) {
    const instName = n.zapiInstanceId as string;
    const state    = await getConnectionState(instName);

    if (state === null) continue;  // inconclusivo — não alterar

    if (state === 'open' && n.status !== 'connected') {
      await prisma.whatsappNumber.update({
        where: { id: n.id },
        data:  { status: 'connected', connectedAt: new Date() },
      }).catch(() => null);
      log.info(`[Heartbeat] ✅ Auto-reconectado: ${n.id} (user ${n.userId}) era '${n.status}'`);
      reconnected++;

      // Grupos ligados pra toda instância conectada (WhatsApp Web
      // simplificado) — corrige aqui instâncias antigas que reconectam por
      // este caminho (sem passar pelo connection.update do webhook).
      setGroupsIgnore(instName, false).catch((err: any) =>
        log.warn(`[Heartbeat] ⚠️ Falha ao ligar grupos: ${instName} — ${err.message}`));

      // Copiloto: quem ficou desconectado pode ter recebido mensagem enquanto
      // isso — sem isso, essas mensagens só apareceriam se o Evolution
      // reenviar o webhook (nem sempre acontece) e nunca virariam briefing.
      // Fire-and-forget: reconexão não pode esperar nem falhar por causa disto.
      if (n.phoneNumber && n.phoneNumber !== 'pending') {
        getUserModules(n.userId)
          .then((mods) => {
            if (!mods.includes('copiloto')) return;
            return backfillUnreadConversations({
              userId: n.userId,
              numberId: n.id,
              instanceId: instName,
              ownPhoneDigits: String(n.phoneNumber).replace(/\D/g, ''),
            });
          })
          .catch((err: any) => log.warn(`[Heartbeat] Backfill de Copiloto falhou (número ${n.id}): ${err.message}`));
      }
    }

    // state === 'close' → NÃO desconectar aqui.
    // Desconexão real vem via connection.update no webhook (confiável e em tempo real).
    // Polling pode gerar falsos positivos por instabilidade momentânea de rede.

    await new Promise(r => setTimeout(r, 200));
  }

  if (reconnected > 0) {
    log.info(`[Heartbeat] Status Sync: ${reconnected} número(s) auto-reconectados`);
  }
}

// ── Webhook Sync — re-aplica webhooks em conectados ────────────────────────────

export async function runWebhookSync(log: any): Promise<void> {
  const url = getWebhookUrl();
  if (!url) {
    log.warn('[Heartbeat] API_URL não configurado — webhook sync ignorado');
    return;
  }
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;

  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { status: 'connected', zapiInstanceId: { not: null } },
    select: { id: true, zapiInstanceId: true },
  }).catch(() => []);

  if (numbers.length === 0) return;

  let ok = 0, fail = 0;

  for (const n of numbers) {
    const success = await setWebhook(n.zapiInstanceId as string, url);
    if (success) ok++; else fail++;
    await new Promise(r => setTimeout(r, 200));
  }

  log.info(`[Heartbeat] Webhook Sync: ${ok} sincronizado(s)${fail ? `, ${fail} com erro` : ''}`);
}

// ── Inicialização ────────────────────────────────────────────────────────────────

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
