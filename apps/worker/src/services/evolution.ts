/**
 * evolution.ts (worker) — Integração com Evolution API para o worker de transcrição
 *
 * Responsabilidades:
 * - Baixar áudio de uma mensagem via getBase64FromMediaMessage
 * - Enviar mensagem de texto de resposta
 * - Marcar conversa como não lida após responder
 */

import axios from 'axios';
import { logger } from '../lib/logger';

const MAX_BYTES = 25 * 1024 * 1024;  // 25MB

function evolutionBase(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error('EVOLUTION_API_URL não configurado');
  return url.replace(/\/$/, '');
}

function evolutionKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error('EVOLUTION_API_KEY não configurado');
  return key;
}

function headers(): Record<string, string> {
  return { 'apikey': evolutionKey(), 'Content-Type': 'application/json' };
}

/**
 * Baixa áudio de uma mensagem Evolution como Buffer.
 * messageData = objeto completo recebido no webhook messages.upsert (data field).
 */
export async function downloadAudioFromEvolution(
  instanceName: string,
  messageData: any,
): Promise<Buffer> {
  logger.info(`[Evolution] Baixando áudio da instância ${instanceName}`);

  const base = evolutionBase();
  const res  = await axios.post(
    `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
    {
      message: {
        key:     messageData.key,
        message: messageData.message,
      },
    },
    {
      headers: headers(),
      timeout: 30_000,
    }
  );

  const b64 = res.data?.base64 ?? res.data?.data;
  if (!b64) throw new Error('Evolution não retornou base64 do áudio');

  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Áudio muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 25MB`);
  }

  logger.info(`[Evolution] Áudio baixado (${(buffer.length / 1024).toFixed(0)} KB)`);
  return buffer;
}

/**
 * Envia mensagem de texto via Evolution API.
 * phone = número com DDI (ex: 5511999999999) — sem @s.whatsapp.net
 */
export async function sendMessageViaEvolution(
  instanceName: string,
  phone: string,
  message: string,
): Promise<void> {
  const base  = evolutionBase();
  const clean = phone.replace(/\D/g, '');

  await axios.post(
    `${base}/message/sendText/${instanceName}`,
    { number: clean, text: message },
    { headers: headers(), timeout: 15_000 }
  );

  logger.info(`[Evolution] Mensagem enviada para ${clean} (instância ${instanceName})`);
}

/**
 * Marca conversa como não lida via Evolution API.
 * Chamado após enviar transcrição — preserva notificação no WhatsApp do remetente.
 * Ignora erros — operação não-crítica.
 */
export async function markChatAsUnread(
  instanceName: string,
  phone: string,
): Promise<void> {
  try {
    const base  = evolutionBase();
    const clean = phone.replace(/\D/g, '');
    const jid   = `${clean}@s.whatsapp.net`;

    // Evolution API v2: POST /chat/markChatUnread/{instance}
    await axios.post(
      `${base}/chat/markChatUnread/${instanceName}`,
      { lastMessages: [{ key: { remoteJid: jid, fromMe: false, id: '' } }] },
      { headers: headers(), timeout: 10_000 }
    );

    logger.info(`[Evolution] Conversa marcada como não lida: ${clean}`);
  } catch {
    // Silencioso — markChatAsUnread é best-effort, endpoint nem sempre suportado
  }
}
