import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { logger } from './logger';

/**
 * Envia e-mail via Resend (API HTTP) ou SMTP como fallback.
 * Resend nunca é bloqueado por cloud providers (usa HTTPS porta 443).
 * SMTP é mantido como fallback para desenvolvimento local.
 *
 * Para domínio verificado no Resend:
 *   1. Acesse resend.com/domains → Add Domain → zapscript.me
 *   2. Adicione os registros DNS (TXT + CNAME/MX) no provedor do domínio
 *   3. Clique em "Verify" no painel Resend
 *   4. Configure a env var SMTP_FROM=ZapScript <nao-responda@zapscript.me> no Render
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasSmtp   = !!process.env.SMTP_HOST;
  logger.info(`[Mailer] Tentando enviar para ${to} | RESEND_API_KEY: ${hasResend ? 'configurado' : 'AUSENTE'} | SMTP_HOST: ${hasSmtp ? 'configurado' : 'AUSENTE'} | SMTP_FROM: ${process.env.SMTP_FROM || 'não definido'}`);

  // ── Resend (primário — API HTTP, nunca bloqueado em cloud) ─────────────
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from   = process.env.SMTP_FROM || `ZapScript <nao-responda@zapscript.me>`;

    logger.info(`[Mailer] Enviando via Resend | from: ${from} | to: ${to}`);
    const { data, error } = await resend.emails.send({ from, to, subject, html });

    if (error) {
      logger.error(`[Mailer] Resend ERRO para ${to}: ${JSON.stringify(error)}`);
      throw new Error(`Resend: ${error.message}`);
    }

    logger.info(`[Mailer] ✅ E-mail enviado via Resend para ${to} (id: ${data?.id})`);
    return;
  }

  // ── SMTP (fallback — desenvolvimento local) ───────────────────────────
  if (process.env.SMTP_HOST) {
    const port   = Number(process.env.SMTP_PORT) || 587;
    const secure = port === 465 || process.env.SMTP_SECURE === 'true';
    const from   = process.env.SMTP_FROM || `"ZapScript" <${process.env.SMTP_USER}>`;

    logger.info(`[Mailer] Enviando via SMTP | host: ${process.env.SMTP_HOST}:${port} | from: ${from} | to: ${to}`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15_000,
      greetingTimeout:   10_000,
      socketTimeout:     20_000,
    });

    const info = await transporter.sendMail({ from, to, subject, html });
    logger.info(`[Mailer] ✅ E-mail enviado via SMTP para ${to} (id: ${info.messageId})`);
    return;
  }

  // ── Nenhum provider configurado ───────────────────────────────────────
  logger.error(`[Mailer] ❌ CRÍTICO: Nenhum provider de e-mail configurado! Configure RESEND_API_KEY no Render. E-mail NÃO enviado para ${to} | assunto: ${subject}`);
  throw new Error('Nenhum provider de e-mail configurado (RESEND_API_KEY ou SMTP_HOST)');
}
