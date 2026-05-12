import axios from 'axios';
import { logger } from '../lib/logger';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Baixar áudio do Twilio (requer Basic Auth com AccountSid:AuthToken)
 */
export async function downloadAudioFromTwilio(mediaUrl: string): Promise<Buffer> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN não configurados');
  }

  logger.info(`[Twilio] Baixando áudio: ${mediaUrl}`);

  const response = await axios.get(mediaUrl, {
    responseType:     'arraybuffer',
    auth:             { username: accountSid, password: authToken },
    maxContentLength: MAX_BYTES,
    maxBodyLength:    MAX_BYTES,
  });

  const buffer = Buffer.from(response.data);

  if (buffer.length > MAX_BYTES) {
    throw new Error(`Áudio muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 25MB`);
  }

  logger.info(`[Twilio] Áudio baixado (${(buffer.length / 1024).toFixed(0)} KB)`);
  return buffer;
}

/**
 * Enviar mensagem de texto via Twilio WhatsApp API
 */
export async function sendMessageViaTwilio(
  to:   string,  // número destino (sem prefixo)
  from: string,  // número Twilio (sem prefixo)
  body: string
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN não configurados');
  }

  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:+${to.replace(/\D/g, '')}`.replace('whatsapp:++', 'whatsapp:+'),
      To:   `whatsapp:+${from.replace(/\D/g, '')}`.replace('whatsapp:++', 'whatsapp:+'),
      Body: body,
    }),
    {
      auth:    { username: accountSid, password: authToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  logger.info(`[Twilio] Mensagem enviada para ${to}`);
}
