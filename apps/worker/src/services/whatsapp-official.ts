import axios from 'axios';
import { logger } from '../lib/logger';

const META_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Token efetivo da Meta para um número.
 * Modelo Tech Provider (System User token único) com fallback ao token legado global.
 * `perNumberToken` é opcional (descriptografado) — usado se um dia houver token por número.
 */
function resolveMetaToken(perNumberToken?: string | null): string {
  const token =
    perNumberToken ||
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.WHATSAPP_API_TOKEN;
  if (!token) {
    throw new Error('Nenhum token Meta configurado (META_SYSTEM_USER_TOKEN / WHATSAPP_API_TOKEN)');
  }
  return token;
}

/**
 * Baixar áudio da Meta API e retornar como Buffer.
 * @param mediaId  ID da mídia recebida no webhook
 * @param token    token por número (opcional); cai para System User / global
 */
export async function downloadAudioFromMeta(mediaId: string, token?: string | null): Promise<Buffer> {
  const apiToken = resolveMetaToken(token);

  // Primeiro, obter URL de download do media ID
  logger.info(`[Meta] Obtendo URL para mídia ${mediaId}`);
  const infoResponse = await axios.get(`${META_API_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  const downloadUrl = infoResponse.data.url;
  const fileSize: number = infoResponse.data.file_size || 0;

  // Validar tamanho antes de baixar (Whisper aceita no máximo 25MB)
  const MAX_BYTES = 25 * 1024 * 1024; // 25MB
  if (fileSize > MAX_BYTES) {
    throw new Error(`Áudio muito grande (${(fileSize / 1024 / 1024).toFixed(1)}MB). Máximo: 25MB`);
  }

  logger.info(`[Meta] URL obtida, baixando...`);
  const mediaResponse = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${apiToken}` },
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
  });

  const buffer = Buffer.from(mediaResponse.data);

  // Double-check after download
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Áudio muito grande após download (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 25MB`);
  }

  logger.info(`[Meta] Áudio baixado (${(buffer.length / 1024).toFixed(0)} KB)`);
  return buffer;
}

/**
 * Enviar mensagem de texto via Meta API.
 * @param phoneNumber   destinatário
 * @param text          corpo
 * @param phoneNumberId phone_number_id do remetente (por número); cai para o global
 * @param token         token por número (opcional); cai para System User / global
 */
export async function sendMessageToMeta(
  phoneNumber: string,
  text: string,
  phoneNumberId?: string | null,
  token?: string | null
): Promise<string> {
  const apiToken = resolveMetaToken(token);
  const fromPhoneId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!fromPhoneId) {
    throw new Error('phone_number_id ausente (parâmetro ou WHATSAPP_PHONE_NUMBER_ID)');
  }

  const response = await axios.post(
    `${META_API_URL}/${fromPhoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber.replace(/\D/g, ''),
      type: 'text',
      text: { body: text },
    },
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );

  const messageId = response.data.messages?.[0]?.id;
  logger.info(`[Meta] Mensagem enviada: ${messageId}`);
  return messageId;
}
