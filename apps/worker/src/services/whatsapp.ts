/**
 * Worker WhatsApp Service
 * 
 * Em produção, API e Worker rodam em containers SEPARADOS.
 * O Worker NÃO tem acesso às sessões Baileys da API.
 * Portanto, o Worker chama a API interna para enviar mensagens.
 */

// API_URL pode chegar sem esquema quando resolvido via Render fromService
// (property: hostport retorna "host:port", não uma URL completa).
const rawApiUrl = process.env.API_URL?.replace('/health', '');
const API_BASE = rawApiUrl
  ? (/^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `http://${rawApiUrl}`)
  : 'http://localhost:3001';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

export async function sendMessage(
  numberId: string,
  jid: string,
  text: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/internal/send`, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-internal-token': INTERNAL_TOKEN,
    },
    body: JSON.stringify({ numberId, jid, text }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`Failed to send WA message: ${err.error || res.statusText}`);
  }
}
