import { prisma } from '../lib/prisma';

// ── Helpers ────────────────────────────────────────────────────────────────────

function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

function zapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  return headers;
}

// ── Sync de um único número ───────────────────────────────────────────────────

async function syncNumber(
  number: { id: string; zapiInstanceId: string | null; zapiToken: string | null },
  webhookUrl: string,
  log: any,
): Promise<{ ok: number; fail: number; migrated: boolean }> {
  const envInstanceId = process.env.ZAPI_INSTANCE_ID;
  const envToken      = process.env.ZAPI_TOKEN;

  let instanceId = number.zapiInstanceId || envInstanceId;
  let token      = number.zapiToken      || envToken;
  let migrated   = false;

  // Detectar mudança de instância nas env vars (ex: Trial → Pago)
  if (envInstanceId && envToken && envInstanceId !== number.zapiInstanceId) {
    log.info(
      `[Z-API Sync] Instância migrada para número ${number.id}: ` +
      `${number.zapiInstanceId ?? 'none'} → ${envInstanceId}`
    );
    instanceId = envInstanceId;
    token      = envToken;
    migrated   = true;

    await prisma.whatsappNumber.update({
      where: { id: number.id },
      data:  { zapiInstanceId: envInstanceId, zapiToken: envToken },
    }).catch((e: any) =>
      log.warn(`[Z-API Sync] Falha ao atualizar instância no banco (${number.id}): ${e.message}`)
    );
  }

  if (!instanceId || !token) {
    log.warn(`[Z-API Sync] Número ${number.id} sem credenciais Z-API — pulando`);
    return { ok: 0, fail: 0, migrated };
  }

  const results = await Promise.allSettled([
    fetch(zapiUrl(instanceId, token, '/update-webhook-received'), {
      method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
    }),
    fetch(zapiUrl(instanceId, token, '/update-webhook-connected'), {
      method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
    }),
    fetch(zapiUrl(instanceId, token, '/update-webhook-received-disconnected'), {
      method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
    }),
    fetch(zapiUrl(instanceId, token, '/update-auto-read-message'), {
      method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: false }),
    }),
  ]);

  const ok   = results.filter(r => r.status === 'fulfilled').length;
  const fail = results.filter(r => r.status === 'rejected').length;
  return { ok, fail, migrated };
}

// ── Sync principal — chamada no startup e via endpoint admin ──────────────────

export interface SyncResult {
  total:    number;
  synced:   number;
  skipped:  number;
  migrated: number;
  errors:   number;
}

export async function syncAllZapiConfigs(log: any): Promise<SyncResult> {
  const webhookUrl = process.env.APP_URL
    ? `${process.env.APP_URL}/webhook/zapi`
    : process.env.API_URL
    ? `${process.env.API_URL}/webhook/zapi`
    : null;

  if (!webhookUrl) {
    log.warn('[Z-API Sync] APP_URL/API_URL não configurado — sync de webhooks ignorado');
    return { total: 0, synced: 0, skipped: 0, migrated: 0, errors: 0 };
  }

  // ── ISOLAMENTO: antes de sincronizar, garantir que por instância só há 1 conectado ──
  // Se houver múltiplos números com o mesmo zapiInstanceId marcados como connected/connecting,
  // mantém apenas o mais recentemente atualizado e desconecta os demais.
  const envInstanceId = process.env.ZAPI_INSTANCE_ID;
  if (envInstanceId) {
    const allOnInstance = await (prisma as any).whatsappNumber.findMany({
      where:   { zapiInstanceId: envInstanceId, status: { in: ['connected', 'connecting'] } },
      orderBy: { updatedAt: 'desc' },
      select:  { id: true, userId: true, status: true, updatedAt: true },
    }).catch(() => []);

    if (allOnInstance.length > 1) {
      const [keep, ...evict] = allOnInstance; // manter o mais recente
      const evictIds = evict.map((n: any) => n.id);
      await prisma.whatsappNumber.updateMany({
        where: { id: { in: evictIds } },
        data:  { status: 'disconnected' },
      }).catch(() => null);
      log.warn(
        `[Z-API Sync] ⚠️  Isolamento: ${evictIds.length} número(s) com zapiInstanceId duplicado ` +
        `foram desconectados. Mantido: ${keep.id} (user: ${keep.userId})`
      );
    }
  }

  // ── Auto-reconectar: checar Z-API e corrigir status antes de sincronizar ────
  // Garante que números fisicamente conectados na Z-API estejam como 'connected'
  // no banco, mesmo que o servidor tenha reiniciado sem receber o ConnectedCallback.
  const allWithCredentials = await (prisma as any).whatsappNumber.findMany({
    where:  { zapiInstanceId: { not: null }, zapiToken: { not: null } },
    select: { id: true, userId: true, zapiInstanceId: true, zapiToken: true, status: true },
  }).catch(() => []);

  const checkedInstances = new Set<string>();
  for (const n of allWithCredentials) {
    const iid = n.zapiInstanceId as string;
    if (checkedInstances.has(iid)) continue;
    checkedInstances.add(iid);

    try {
      const headers: Record<string, string> = {};
      if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
      const res = await fetch(
        `https://api.z-api.io/instances/${iid}/token/${n.zapiToken}/status`,
        { headers, signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) continue;
      const data = await res.json() as any;

      if (data?.connected === true && n.status !== 'connected') {
        await prisma.whatsappNumber.update({
          where: { id: n.id },
          data:  { status: 'connected', connectedAt: new Date() },
        }).catch(() => null);
        log.info(
          `[Z-API Sync] ✅ Auto-reconectado no startup: número ${n.id} (user: ${n.userId}) — Z-API online`
        );
      }
    } catch { /* ignorar erros de rede — heartbeat cobre em 1 min */ }
  }

  // Busca todos os números conectados (ou conectando — pode ter travado em connecting)
  const numbers = await (prisma as any).whatsappNumber.findMany({
    where: { status: { in: ['connected', 'connecting'] } },
    select: { id: true, zapiInstanceId: true, zapiToken: true },
  });

  const result: SyncResult = {
    total:    numbers.length,
    synced:   0,
    skipped:  0,
    migrated: 0,
    errors:   0,
  };

  if (numbers.length === 0) {
    log.info('[Z-API Sync] Nenhum número conectado para sincronizar');
    return result;
  }

  log.info(`[Z-API Sync] Sincronizando ${numbers.length} número(s)... (webhook: ${webhookUrl})`);

  for (const number of numbers) {
    try {
      const { ok, fail, migrated } = await syncNumber(number, webhookUrl, log);

      if (ok === 0 && fail === 0) {
        result.skipped++;
      } else {
        result.synced++;
        if (migrated) result.migrated++;
        if (fail > 0) result.errors++;
        log.info(
          `[Z-API Sync] Número ${number.id}: ${ok}/4 OK${fail ? `, ${fail} erro(s)` : ''}${migrated ? ' (instância migrada)' : ''}`
        );
      }
    } catch (err: any) {
      result.errors++;
      log.error(`[Z-API Sync] Erro inesperado ao sincronizar ${number.id}: ${err.message}`);
    }
  }

  log.info(
    `[Z-API Sync] ✅ Concluído — ${result.synced} sincronizados` +
    (result.migrated ? `, ${result.migrated} migrados` : '') +
    (result.skipped  ? `, ${result.skipped} ignorados`  : '') +
    (result.errors   ? `, ${result.errors} erro(s)`     : '')
  );

  return result;
}
