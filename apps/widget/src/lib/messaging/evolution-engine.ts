// Implementação Fase 1 do MessagingEngine — Evolution API (Baileys).
// Pode apontar pro MESMO servidor Evolution que já roda no Vultr do
// ZapScript.me (uma instância Evolution serve N instâncias de WhatsApp,
// cada uma isolada por nome) ou para um Evolution separado — configurável
// via env. Instâncias deste produto usam prefixo `wl-` para nunca colidir
// com as `zs-` do ZapScript.me caso dividam o mesmo servidor Evolution.
//
// Env vars:
//   WIDGET_EVOLUTION_API_URL — base URL do servidor Evolution
//   WIDGET_EVOLUTION_API_KEY — apikey global da Evolution

import type { MessagingEngine, QrResult, ConnectionStatus } from './engine';

function baseUrl(): string {
  const url = process.env.WIDGET_EVOLUTION_API_URL;
  if (!url) throw new Error('WIDGET_EVOLUTION_API_URL não configurado');
  return url.replace(/\/$/, '');
}

function headers(): Record<string, string> {
  const key = process.env.WIDGET_EVOLUTION_API_KEY;
  if (!key) throw new Error('WIDGET_EVOLUTION_API_KEY não configurado');
  return { apikey: key, 'Content-Type': 'application/json' };
}

async function createConnection(instanceName: string, webhookUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/instance/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      rejectCall: true,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution instance/create falhou (${res.status}): ${text}`);
  }
}

async function getQrCode(instanceName: string): Promise<QrResult> {
  const res = await fetch(`${baseUrl()}/instance/connect/${instanceName}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { qrCode: null };
  const data = (await res.json().catch(() => null)) as any;
  const qrCode = data?.base64 ?? data?.qrcode?.base64 ?? null;
  const pairingCode = data?.pairingCode ?? null;
  return { qrCode, pairingCode };
}

async function getStatus(instanceName: string): Promise<ConnectionStatus> {
  try {
    const res = await fetch(`${baseUrl()}/instance/connectionState/${instanceName}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 'disconnected';
    const data = (await res.json().catch(() => null)) as any;
    const state = data?.instance?.state ?? data?.state;
    if (state === 'open') return 'connected';
    if (state === 'connecting') return 'connecting';
    return 'disconnected';
  } catch {
    return 'disconnected';
  }
}

async function disconnect(instanceName: string): Promise<void> {
  try {
    await fetch(`${baseUrl()}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => {});
    await fetch(`${baseUrl()}/instance/delete/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* ignora — pode já ter sido removida */
  }
}

async function sendText(instanceName: string, phone: string, text: string): Promise<{ id: string | null }> {
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${baseUrl()}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ number: clean, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution sendText falhou (${res.status}): ${errText}`);
  }
  const data = (await res.json().catch(() => null)) as any;
  return { id: data?.key?.id ?? null };
}

export const evolutionEngine: MessagingEngine = {
  provider: 'evolution',
  createConnection,
  getQrCode,
  getStatus,
  disconnect,
  sendText,
};

/** Nome de instância Evolution para uma conexão deste produto — prefixo `wl-` (white-label). */
export function widgetInstanceName(connectionId: string): string {
  return `wl-${connectionId}`;
}
