import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import nodemailer from 'nodemailer';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_HOST) {
    console.log('[Support] SMTP não configurado, e-mail não enviado');
    return;
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, html });
}

export default async function supportRoutes(app: FastifyInstance) {

  // POST /support/ticket — criar ticket de suporte com suporte a anexo
  app.post('/ticket', async (req, reply) => {
    let attachmentData: string | undefined;
    let attachmentFilename: string | undefined;
    let attachmentMimeType: string | undefined;

    // Parse multipart form data
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'Multipart form data obrigatório' });
    }

    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = await part.toBuffer().then(b => b.toString('utf-8'));
      } else if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (buffer.length > maxSize) {
          return reply.code(400).send({ error: 'Arquivo muito grande (máx 10MB)' });
        }
        // Allowed MIME types
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
        if (!allowedTypes.includes(part.mimetype)) {
          return reply.code(400).send({ error: 'Tipo de arquivo não permitido' });
        }
        attachmentData = buffer.toString('base64');
        attachmentFilename = part.filename;
        attachmentMimeType = part.mimetype;
      }
    }

    const { name, email, category, description } = fields;
    if (!name || !email || !category || !description) {
      return reply.code(400).send({ error: 'name, email, category, description obrigatórios' });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        name,
        email,
        category,
        description,
        attachmentData,
        attachmentFilename,
        attachmentMimeType,
      },
    });

    const safeName        = escapeHtml(name);
    const safeEmail       = escapeHtml(email);
    const safeCategory    = escapeHtml(category);
    const safeDescription = escapeHtml(description).replace(/\n/g, '<br>');

    let attachmentHtml = '';
    if (attachmentFilename) {
      attachmentHtml = `<p><b>Anexo:</b> ${escapeHtml(attachmentFilename)} (${attachmentMimeType})</p>`;
    }

    // Enviar e-mail para a equipe
    await sendEmail(
      process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '',
      `[ZapScript Suporte] ${safeCategory} — ${safeName}`,
      `
        <h2>Novo Ticket de Suporte</h2>
        <p><b>Nome:</b> ${safeName}</p>
        <p><b>E-mail:</b> ${safeEmail}</p>
        <p><b>Categoria:</b> ${safeCategory}</p>
        <p><b>Descrição:</b></p>
        <p>${safeDescription}</p>
        ${attachmentHtml}
        <hr>
        <p>Ticket ID: ${ticket.id}</p>
      `
    );

    // Enviar confirmação ao usuário
    await sendEmail(
      email,
      'Recebemos seu contato — ZapScript',
      `
        <h2>Olá, ${safeName}!</h2>
        <p>Recebemos seu contato sobre: <b>${safeCategory}</b></p>
        <p>Nossa equipe responderá em até 24 horas no e-mail <b>${safeEmail}</b>.</p>
        <br>
        <p>— Equipe ZapScript</p>
        <p><a href="https://zapscript.me">zapscript.me</a></p>
      `
    );

    return { ticket: true, id: ticket.id, message: 'Ticket criado! Responderemos em até 24h.' };
  });
}
