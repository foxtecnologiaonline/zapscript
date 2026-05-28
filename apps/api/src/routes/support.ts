import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { createClient } from '@supabase/supabase-js';

// Bucket no Supabase Storage para anexos de suporte (criar no dashboard Supabase se ainda não existir)
const ATTACHMENTS_BUCKET = 'support-attachments';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export default async function supportRoutes(app: FastifyInstance) {

  // POST /support/ticket — criar ticket de suporte com suporte a anexo
  app.post('/ticket', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req, reply) => {
    let attachmentUrl: string | undefined;
    let attachmentFilename: string | undefined;
    let attachmentMimeType: string | undefined;
    const fields: Record<string, string> = {};

    // Parse multipart form data
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        // Field values are Buffer or string
        if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        } else if (Buffer.isBuffer(part.value)) {
          fields[part.fieldname] = part.value.toString('utf-8');
        }
      } else if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (buffer.length > maxSize) {
          return reply.code(400).send({ error: 'Arquivo muito grande (máx 10MB)' });
        }
        // Allowed MIME types
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
        if (!allowedTypes.includes(part.mimetype)) {
          return reply.code(400).send({ error: 'Tipo de arquivo não permitido' });
        }
        attachmentFilename = part.filename;
        attachmentMimeType = part.mimetype;

        // Upload para Supabase Storage (evita Base64 gigante no banco)
        try {
          const supabase = getSupabase();
          const ext      = part.filename?.split('.').pop() || 'bin';
          const path     = `tickets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(path, buffer, { contentType: part.mimetype, upsert: false });

          if (uploadError) {
            app.log.error({ err: uploadError.message }, '[Support] Falha no upload para Supabase Storage');
            return reply.code(500).send({ error: 'Falha ao armazenar anexo. Tente novamente.' });
          }

          const { data: urlData } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path);
          attachmentUrl = urlData.publicUrl;
        } catch (err: any) {
          app.log.error({ err: err.message }, '[Support] Erro inesperado no upload do anexo');
          return reply.code(500).send({ error: 'Falha ao armazenar anexo. Tente novamente.' });
        }
      }
    }

    const { name, email, category, description } = fields;
    if (!name || !email || !category || !description) {
      return reply.code(400).send({ error: 'name, email, category, description obrigatórios' });
    }

    // Validações de formato
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({ error: 'E-mail inválido.' });
    }
    if (name.length > 100) {
      return reply.code(400).send({ error: 'Nome muito longo (máx 100 caracteres).' });
    }
    if (description.length > 5000) {
      return reply.code(400).send({ error: 'Descrição muito longa (máx 5000 caracteres).' });
    }
    const allowedCategories = ['técnico', 'cobrança', 'conta', 'outro', 'sugestão'];
    const categoryLower = category.toLowerCase();
    if (!allowedCategories.some(c => categoryLower.includes(c))) {
      // Aceita qualquer categoria mas limita o tamanho
      if (category.length > 50) {
        return reply.code(400).send({ error: 'Categoria muito longa (máx 50 caracteres).' });
      }
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        name,
        email,
        category,
        description,
        attachmentUrl,
        attachmentFilename,
        attachmentMimeType,
      } as any,
    });

    const safeName        = escapeHtml(name);
    const safeEmail       = escapeHtml(email);
    const safeCategory    = escapeHtml(category);
    const safeDescription = escapeHtml(description).replace(/\n/g, '<br>');

    let attachmentHtml = '';
    if (attachmentFilename) {
      const safeFilename = escapeHtml(attachmentFilename);
      attachmentHtml = attachmentUrl
        ? `<p><b>Anexo:</b> <a href="${escapeHtml(attachmentUrl)}">${safeFilename}</a> (${attachmentMimeType})</p>`
        : `<p><b>Anexo:</b> ${safeFilename} (${attachmentMimeType})</p>`;
    }

    // Enviar e-mail para a equipe
    const supportEmail = (process.env.SUPPORT_EMAIL || process.env.SMTP_USER || 'support@zapscript.me') as string;
    await sendEmail(
      supportEmail,
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

  // ── POST /support/enterprise-contact — formulário Para Empresas (sem auth) ──
  app.post('/enterprise-contact', {
    config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
  }, async (req: any, reply) => {
    const { whatsappNumbers, audiosPerMonth, integrations, email } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.code(400).send({ error: 'E-mail corporativo é obrigatório.' });
    }

    const clean = (v: any) => (typeof v === 'string' ? escapeHtml(v.slice(0, 400)) : '—');

    const html = `
      <div style="font-family:sans-serif;max-width:520px;padding:28px">
        <h2 style="color:#10b981;margin:0 0 20px">📋 Nova solicitação de proposta — Para Empresas</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:10px 0;color:#6b7280;width:180px;font-weight:600">E-mail</td>
            <td style="padding:10px 0;font-weight:700">${clean(email)}</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:10px 0;color:#6b7280;font-weight:600">Números WhatsApp</td>
            <td style="padding:10px 0">${clean(whatsappNumbers) || '—'}</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:10px 0;color:#6b7280;font-weight:600">Áudios por mês</td>
            <td style="padding:10px 0">${clean(audiosPerMonth) || '—'}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#6b7280;font-weight:600">Integrações</td>
            <td style="padding:10px 0">${clean(integrations) || '—'}</td>
          </tr>
        </table>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
        <p style="color:#9ca3af;font-size:12px;margin:0">Enviado via formulário Para Empresas — zapscript.me</p>
      </div>
    `;

    try {
      await sendEmail('contato@zapscript.me', `🏢 Proposta solicitada: ${clean(email)}`, html);
      return reply.send({ ok: true });
    } catch (err: any) {
      app.log.error({ err: err.message }, '[Enterprise] Falha ao enviar e-mail de proposta');
      return reply.code(500).send({ error: 'Falha ao enviar. Tente novamente em instantes.' });
    }
  });
}
