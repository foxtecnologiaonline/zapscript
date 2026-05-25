import axios from 'axios';
import { logger } from '../lib/logger';

/**
 * Envia e-mail via Resend API (HTTP) — sem dependência de SMTP.
 * Se RESEND_API_KEY não estiver configurada, loga warning e retorna silenciosamente.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.SMTP_FROM || 'ZapScript <nao-responda@zapscript.me>';

  if (!key) {
    logger.warn(`[Worker/Mailer] RESEND_API_KEY não configurada — e-mail NÃO enviado para ${to}`);
    return;
  }

  try {
    await axios.post(
      'https://api.resend.com/emails',
      { from, to, subject, html },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 10_000 },
    );
    logger.info(`[Worker/Mailer] E-mail enviado para ${to}: "${subject}"`);
  } catch (err: any) {
    logger.warn(`[Worker/Mailer] Falha ao enviar e-mail para ${to}: ${err?.response?.data?.message || err.message}`);
    // Fire-and-forget — não propaga erro
  }
}
