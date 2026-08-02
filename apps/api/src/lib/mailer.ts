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

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

/** Template base (dark mode) usado por todos os e-mails transacionais do ZapScript. */
export function emailWrapper(
  iconEmoji: string,
  title: string,
  body: string,
  securityNote = 'Se você não reconhece esta ação, ignore este e-mail.'
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
</head>
<body style="margin:0;padding:0;background:#050a07;font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="padding:40px 16px">
    <div style="max-width:540px;margin:0 auto">

      <!-- Logo -->
      <div style="text-align:center;margin-bottom:28px">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
          <tr>
            <td style="background:#10b981;border-radius:10px;width:38px;height:38px;text-align:center;vertical-align:middle">
              <span style="font-size:18px;line-height:38px">💬</span>
            </td>
            <td style="padding-left:10px;vertical-align:middle">
              <span style="font-size:21px;font-weight:700;color:#10b981;letter-spacing:-0.5px">ZapScript</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Card -->
      <div style="background:#0d1c19;border:1px solid rgba(16,185,129,.18);border-radius:20px;padding:40px 36px">

        <!-- Ícone -->
        <div style="text-align:center;margin-bottom:18px">
          <div style="display:inline-block;width:64px;height:64px;background:rgba(16,185,129,.12);border-radius:50%;font-size:28px;line-height:64px;text-align:center">${iconEmoji}</div>
        </div>

        <!-- Título -->
        <h1 style="text-align:center;color:#10b981;font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-0.3px">${title}</h1>
        <p style="text-align:center;color:#4ade80;font-size:13px;font-weight:400;margin:0 0 28px;opacity:.7">zapscript.me</p>

        <!-- Divisória -->
        <div style="height:1px;background:rgba(16,185,129,.12);margin-bottom:28px"></div>

        ${body}

        <!-- Divisória -->
        <div style="height:1px;background:rgba(16,185,129,.08);margin-top:32px;margin-bottom:20px"></div>

        <p style="color:#4a7060;font-size:12px;line-height:1.6;margin:0;text-align:center">
          ${securityNote}
        </p>
      </div>

      <!-- Rodapé -->
      <div style="text-align:center;margin-top:24px">
        <p style="color:#2d5040;font-size:12px;margin:0 0 4px">ZapScript — Conversão Inteligente de Áudios do WhatsApp</p>
        <a href="${APP_URL}" style="color:rgba(16,185,129,.55);font-size:12px;text-decoration:none">zapscript.me</a>
      </div>

    </div>
  </div>
</body>
</html>`;
}
