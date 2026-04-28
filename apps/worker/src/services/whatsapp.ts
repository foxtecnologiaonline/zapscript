/**
 * Worker WhatsApp Service
 * 
 * Em produção, API e Worker rodam em containers SEPARADOS.
 * O Worker NÃO tem acesso às sessões Baileys da API.
 * Portanto, o Worker chama a API interna para enviar mensagens.
 */

const API_BASE = process.env.API_URL
  ? process.env.API_URL.replace('/health', '')
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
