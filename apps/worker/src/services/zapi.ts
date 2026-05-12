import axios from 'axios';
import { logger } from '../lib/logger';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

function zapiBase(): string {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token      = process.env.ZAPI_TOKEN;
  if (!instanceId || !token) throw new Error('ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurados');
  return `https://api.z-api.io/instances/${instanceId}/token/${token}`;
}

/**
 * Baixar áudio recebido via Z-API.
 * A URL vem no payload do webhook (audioUrl) — é uma URL temporária do CDN.
 */
export async function downloadAudioFromZapi(audioUrl: string): Promise<Buffer> {
  logger.info(`[Z-API] Baixando áudio: ${audioUrl}`);

  const response = await axios.get(audioUrl, {
    responseType:     'arraybuffer',
    maxContentLength: MAX_BYTES,
    maxBodyLength:    MAX_BYTES,
    timeout:          30_000,
  });

  const buffer = Buffer.from(response.data);

  if (buffer.length > MAX_BYTES) {
    throw new Error(`Áudio muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 25MB`);
  }

  logger.info(`[Z-API] Áudio baixado (${(buffer.length / 1024).toFixed(0)} KB)`);
  return buffer;
}

/**
 * Enviar mensagem de texto para uma conversa via Z-API.
 * phone: número do destinatário no formato internacional sem + (ex: 5534999990000)
 */
export async function sendMessageViaZapi(phone: string, message: string): Promise<void> {
  const base        = zapiBase();
  const cleanPhone  = phone.replace(/\D/g, '');

  await axios.post(
    `${base}/send-text`,
    { phone: cleanPhone, message },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    }
  );

  logger.info(`[Z-API] Mensagem enviada para ${cleanPhone}`);
}
