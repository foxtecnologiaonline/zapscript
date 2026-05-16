/**
 * evolution-sync.ts
 *
 * Sincronização de webhooks e status na inicialização.
 *
 * Com Evolution API, cada usuário tem sua própria instância dedicada.
 * NÃO há isolamento multi-tenant necessário — instâncias são naturalmente isoladas.
 *
 * Responsabilidades:
 * 1. Re-aplicar webhooks em todas as instâncias conectadas (startup + schedule)
 * 2. Auto-reconectar no banco números que estejam fisicamente conectados no Evolution
 *    mas marcados como disconnected (ex: servidor reiniciou sem receber connection.update)
 */

import { prisma } from '../lib/prisma';
import { getConnectionState, setWebhook } from './evolution';

function getWebhookUrl(): string | null {
  const base = process.env.API_URL || process.env.APP_URL;
  if (!base) return null;
  const url    = `${base.replace(/\/$/, '')}/webhook/evolution`;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

export interface SyncResult {
  total:    number;
  synced:   number;
  skipped:  number;
  errors:   number;
  reconnected: number;
}

export async function syncAllEvolutionConfigs(log: any): Promise<SyncResult> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    log.warn('[Evolution Sync] API_URL não configurado — sync ignorado. Configure API_URL=https://seu-app.onrender.com');
    return { total: 0, synced: 0, skipped: 0, errors: 0, reconnected: 0 };
  }

  // Verificar se Evolution API está configurada
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  if (!evolutionUrl || !evolutionKey) {
    log.warn('[Evolution Sync] EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados — sync ignorado');
    return { total: 0, synced: 0, skipped: 0, errors: 0, reconnected: 0 };
  }

  // Buscar todos os números que têm instância Evolution vinculada
  const numbers = await (prisma as any).whatsappNumber.findMany({
    where:  { zapiInstanceId: { not: null } },
    select: { id: true, userId: true, zapiInstanceId: true, status: true },
  }).catch((err: any) => {
    log.error(`[Evolution Sync] Erro ao buscar números: ${err.message}`);
    return [];
  });

  if (numbers.length === 0) {
    log.info('[Evolution Sync] Nenhum número com instância Evolution vinculada');
    return { total: 0, synced: 0, skipped: 0, errors: 0, reconnected: 0 };
  }

  const result: SyncResult = { total: numbers.length, synced: 0, skipped: 0, errors: 0, reconnected: 0 };

  log.info(`[Evolution Sync] Verificando ${numbers.length} número(s)... (webhook: ${webhookUrl})`);

  for (const number of numbers) {
    const instName = number.zapiInstanceId as string;

    try {
      // Verificar estado real da instância no Evolution API
      const state = await getConnectionState(instName);

      if (state === null) {
        // Inconclusivo (rede, timeout) — não alterar nada
        result.skipped++;
        continue;
      }

      if (state === 'open') {
        // Instância conectada — re-aplicar webhook
        const ok = await setWebhook(instName, webhookUrl);
        if (ok) {
          result.synced++;
          log.info(`[Evolution Sync] ✅ Webhook sincronizado: ${instName} (número ${number.id})`);
        } else {
          result.errors++;
          log.warn(`[Evolution Sync] ⚠️ Falha ao sincronizar webhook: ${instName}`);
        }

        // Auto-reconectar no banco se status estiver desatualizado
        if (number.status !== 'connected') {
          await prisma.whatsappNumber.update({
            where: { id: number.id },
            data:  { status: 'connected', connectedAt: new Date() },
          }).catch(() => null);
          result.reconnected++;
          log.info(`[Evolution Sync] ✅ Auto-reconectado: ${number.id} (user ${number.userId}) era '${number.status}'`);
        }
      } else if (state === 'close') {
        // Instância offline — corrigir status no banco se necessário
        if (number.status === 'connected') {
          await prisma.whatsappNumber.update({
            where: { id: number.id },
            data:  { status: 'disconnected' },
          }).catch(() => null);
          log.info(`[Evolution Sync] ℹ️ Número ${number.id} marcado como disconnected (Evolution offline)`);
        }
        result.skipped++;
      } else {
        // connecting — aguardar connection.update via webhook
        result.skipped++;
      }

      await new Promise(r => setTimeout(r, 200));  // throttle para não sobrecarregar Evolution API

    } catch (err: any) {
      result.errors++;
      log.error(`[Evolution Sync] Erro ao processar ${instName}: ${err.message}`);
    }
  }

  log.info(
    `[Evolution Sync] ✅ Concluído — ${result.synced} sincronizados` +
    (result.reconnected ? `, ${result.reconnected} auto-reconectados` : '') +
    (result.skipped     ? `, ${result.skipped} ignorados`              : '') +
    (result.errors      ? `, ${result.errors} erro(s)`                 : '')
  );

  return result;
}
