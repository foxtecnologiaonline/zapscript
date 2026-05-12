import axios from 'axios';
import { logger } from '../lib/logger';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Retorna a base URL da instância Z-API.
 * Prioridade: credenciais passadas explicitamente → env vars globais.
 */
function zapiBase(instanceId?: string, token?: string): string {
  const id  = instanceId || process.env.ZAPI_INSTANCE_ID;
  const tok = token      || process.env.ZAPI_TOKEN;
  if (!id || !tok) throw new Error('Credenciais Z-API não configuradas (ZAPI_INSTANCE_ID / ZAPI_TOKEN)');
  return `https://api.z-api.io/instances/${id}/token/${tok}`;
}

/**
 * Baixar áudio recebido via Z-API.
 * A URL vem no payload do webhook (audioUrl) — URL temporária do CDN Z-API.
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
 * Enviar mensagem de texto via Z-API.
 * Usa as credenciais do número que recebeu o áudio (multi-tenant).
 * Fallback para env vars globais se não fornecidas.
 */
export async function sendMessageViaZapi(
  phone:      string,
  instanceId: string | undefined,
  token:      string | undefined,
  message:    string,
): Promise<void> {
  const base       = zapiBase(instanceId, token);
  const cleanPhone = phone.replace(/\D/g, '');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;

  await axios.post(
    `${base}/send-text`,
    { phone: cleanPhone, message },
    { headers, timeout: 15_000 }
  );

  logger.info(`[Z-API] Mensagem enviada para ${cleanPhone} (instância ${instanceId ?? 'global'})`);
}
