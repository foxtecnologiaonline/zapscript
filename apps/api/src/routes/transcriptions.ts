import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { transcriptionQueue } from '../services/queue';
import { decryptStr, decryptArr } from '../services/encryption';
import { getUserPlan, requirePlan } from '../lib/planGate';

// Planos com acesso a cada feature
const PLAN_SEARCH  = ['pro', 'executive'];
const PLAN_EXPORT  = ['executive']; // Exportação exclusiva do plano Executive
const PLAN_TAGS    = ['pro', 'executive'];   // tags abertas para Pro+
const PLAN_LANG    = ['executive'];
const PLAN_AI_FEAT = ['executive'];          // reply sugerida + doc (Executive)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function transcriptionRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /transcriptions ───────────────────────────────
  app.get<{
    Querystring: {
      limit?: string; offset?: string; numberId?: string;
      search?: string; tag?: string; language?: string;
      dateFrom?: string; dateTo?: string; contact?: string;
      sort?: string; source?: string;
    }
  }>('/', auth, async (req: any, reply) => {
    const userId   = req.user.sub;
    const limit    = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
    const offset   = Math.max(parseInt(req.query.offset || '0') || 0, 0);
    const numberId = req.query.numberId;
    const search   = req.query.search?.trim();
    const tag      = req.query.tag?.trim();
    const language = req.query.language?.trim();
    const dateFrom = req.query.dateFrom?.trim();   // YYYY-MM-DD
    const dateTo   = req.query.dateTo?.trim();     // YYYY-MM-DD
    const contact  = req.query.contact?.trim();    // nome ou telefone
    const sort     = req.query.sort || 'date_desc'; // date_desc | date_asc | contact | contact_desc
    const source   = req.query.source?.trim();     // voice-note | whatsapp | manual

    const plan = await getUserPlan(userId);

    // ── Orderby ──────────────────────────────────────
    const orderBy: any =
      sort === 'date_asc'     ? { createdAt: 'asc' }    :
      sort === 'contact'      ? { contactName: 'asc' }  :
      sort === 'contact_desc' ? { contactName: 'desc' } :
      { createdAt: 'desc' }; // default: date_desc

    // ── Where base ────────────────────────────────────
    const where: any = { userId };
    if (numberId) where.numberId = numberId === 'none' ? null : numberId;
    if (source)   where.source   = source;

    // Filtro por data (todos os planos)
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1); // inclusive
        where.createdAt.lt = end;
      }
    }

    // Filtro por contato (DB-level, todos os planos)
    if (contact) {
      where.contactName = { contains: contact, mode: 'insensitive' };
    }

    // Filtro por tag (Pro+)
    if (tag) {
      if (!requirePlan(plan, PLAN_TAGS, reply)) return;
      where.tags = { has: tag };
    }

    // Filtro por idioma (Ultra+)
    if (language) {
      if (!requirePlan(plan, PLAN_LANG, reply)) return;
      where.language = language;
    }

    // ── Busca full-text (Pro+) ─────────────────────────
    if (search) {
      if (!requirePlan(plan, PLAN_SEARCH, reply)) return;

      // C2: Limite de 2000 registros para evitar crash de memória em usuários com muitos dados
      // (busca in-memory necessária pois originalText é criptografado — pg_trgm não funciona)
      const SEARCH_LIMIT = 2000;
      const allItems = await prisma.transcription.findMany({
        where:   { ...where },
        orderBy,
        take:    SEARCH_LIMIT,
        include: { number: { select: { displayName: true, phoneNumber: true } } },
      });

      const q = search.toLowerCase();
      const matched = allItems.filter((t: any) => {
        const text    = decryptStr(t.originalText).toLowerCase();
        const bullets = decryptArr(t.summaryBullets as string).join(' ').toLowerCase();
        const name    = (t.contactName || '').toLowerCase();
        return text.includes(q) || bullets.includes(q) || name.includes(q);
      });

      const total = matched.length;
      const page  = matched.slice(offset, offset + limit).map((t: any) => ({
        ...t,
        contactPhone:   decryptStr(t.contactPhone),
        originalText:   decryptStr(t.originalText),
        summaryBullets: decryptArr(t.summaryBullets as string),
      }));
      return { items: page, total, limit, offset };
    }

    // ── Busca padrão ───────────────────────────────────
    const [items, total] = await Promise.all([
      prisma.transcription.findMany({
        where,
        orderBy,
        take:    limit,
        skip:    offset,
        include: { number: { select: { displayName: true, phoneNumber: true } } },
      }),
      prisma.transcription.count({ where }),
    ]);

    const decryptedItems = items.map((t: any) => ({
      ...t,
      contactPhone:   decryptStr(t.contactPhone),
      originalText:   decryptStr(t.originalText),
      summaryBullets: decryptArr(t.summaryBullets as string),
    }));

    return { items: decryptedItems, total, limit, offset };
  });

  // ── GET /transcriptions/export ────────────────────────
  // Exporta transcrições do mês — Executive only
  // Formatos: csv | xls | pdf | docx
  app.get<{
    Querystring: { format?: string; month?: string }
  }>('/export', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_EXPORT, reply)) return;

    const format = (req.query.format || 'csv').toLowerCase(); // csv | xls | pdf | docx
    const month  = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM

    const [year, mon] = month.split('-').map(Number);
    const from = new Date(year, mon - 1, 1);
    const to   = new Date(year, mon, 1);

    const items = await prisma.transcription.findMany({
      where:   { userId, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      take:    1000,
    });

    const esc = (v: string) => (v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // ── PDF export (HTML imprimível — Ctrl+P → Salvar como PDF) ──────────────
    if (format === 'pdf') {
      const rows = items.map((t: any) => {
        const date    = new Date(t.createdAt).toLocaleString('pt-BR');
        const contact = esc(t.contactName || decryptStr(t.contactPhone));
        const dur     = (t.durationSec / 60).toFixed(1);
        const bullets = decryptArr(t.summaryBullets as string);
        const text    = esc(decryptStr(t.originalText));
        return `<div class="tr">
          <div class="hdr"><b>${contact}</b> <span class="meta">${date} · ${dur} min · ${t.language.toUpperCase()}</span></div>
          ${bullets.length ? `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          <p class="txt">${text}</p>
        </div>`;
      }).join('<hr>');
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Transcrições ${month}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;margin:1.5cm;color:#111}
h1{font-size:16px;color:#0d9668;margin-bottom:16px}
.tr{margin-bottom:20px;padding-bottom:20px}
.hdr{font-size:12px;margin-bottom:6px}
.meta{color:#666;font-weight:400;font-size:10px}
ul{margin:4px 0 8px 18px;padding:0}li{margin:2px 0;color:#333}
.txt{color:#555;font-style:italic;line-height:1.5;margin-top:4px}
hr{border:none;border-top:1px solid #ddd;margin:16px 0}
@media print{.no-print{display:none}body{margin:1cm}}</style>
</head><body>
<div class="no-print" style="background:#0d9668;color:#fff;padding:10px 16px;margin:-1.5cm -1.5cm 20px;font-size:12px">
  📄 Pressione <b>Ctrl+P</b> (ou <b>⌘P</b>) → "Salvar como PDF"
</div>
<h1>📝 Transcrições — ${month}</h1>
<p style="color:#666;font-size:10px;margin-bottom:20px">Total: ${items.length} transcrição(ões) · Gerado pelo ZapScript</p>
${rows}
<script>const b=document.querySelector('.no-print');if(b)b.style.display='block'</script>
</body></html>`;
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Content-Disposition', `inline; filename="transcricoes-${month}.pdf"`);
      return reply.send(html);
    }

    // ── DOCX export (HTML Word-compatible) ────────────────────────────────────
    if (format === 'docx') {
      const rows = items.map((t: any) => {
        const date    = new Date(t.createdAt).toLocaleString('pt-BR');
        const contact = esc(t.contactName || decryptStr(t.contactPhone));
        const dur     = (t.durationSec / 60).toFixed(1);
        const bullets = decryptArr(t.summaryBullets as string);
        const text    = esc(decryptStr(t.originalText));
        return `<h2 style="font-size:12pt;color:#0d9668">${contact}</h2>
<p style="color:#666;font-size:10pt">${date} &nbsp;·&nbsp; ${dur} min &nbsp;·&nbsp; ${t.language.toUpperCase()}</p>
${bullets.length ? `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
<p><i>${text}</i></p><hr/>`;
      }).join('\n');
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"/>
<style>body{font-family:Calibri,Arial;font-size:11pt;margin:2cm}h1{font-size:14pt;color:#0d9668}ul{margin:4pt 0}li{margin:2pt 0}</style>
</head><body>
<h1>Transcrições — ${month}</h1>
<p style="color:#666;font-size:9pt">Total: ${items.length} · ZapScript</p><hr/>
${rows}
</body></html>`;
      reply
        .header('Content-Type', 'application/msword; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="transcricoes-${month}.docx"`);
      return reply.send(html);
    }

    // ── XLS export (HTML-based, opens natively in Excel) ──
    if (format === 'xls') {
      const tableRows = items.map((t: any) => {
        const c = (v: string) => `<td>${esc(v)}</td>`;
        return `<tr>${[
          c(t.createdAt.toLocaleString('pt-BR')),
          c(t.contactName || ''),
          c(decryptStr(t.contactPhone)),
          c((t.durationSec / 60).toFixed(2)),
          c(t.language),
          c(decryptStr(t.originalText)),
          c(decryptArr(t.summaryBullets as string).join(' | ')),
          c(((t as any).tags || []).join(', ')),
        ].join('')}</tr>`;
      }).join('');
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><table><tr><th>Data</th><th>Contato</th><th>Telefone</th><th>Duração (min)</th><th>Idioma</th><th>Texto</th><th>Resumo</th><th>Tags</th></tr>${tableRows}</table></body></html>`;
      reply
        .header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="transcricoes-${month}.xls"`);
      return reply.send(html);
    }

    // ── CSV export (default) ──────────────────────────────
    // Sanitiza fórmulas (CSV Injection) prefixando campos que iniciam
    // com =, +, -, @ com apóstrofo, impedindo execução em Excel/LibreOffice.
    const sanitizeCsv = (v: string): string => {
      const s = (v || '').replace(/"/g, '""').replace(/\n/g, ' ');
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    };
    const escCsv = (v: string) => `"${sanitizeCsv(v)}"`;
    const rows = items.map((t: any) => [
      escCsv(t.createdAt.toISOString().slice(0, 16).replace('T', ' ')),
      escCsv(t.contactName || ''),
      escCsv(decryptStr(t.contactPhone)),
      escCsv((t.durationSec / 60).toFixed(2)),
      escCsv(t.language),
      escCsv(decryptStr(t.originalText)),
      escCsv(decryptArr(t.summaryBullets as string).join(' | ')),
      escCsv(((t as any).tags || []).join(', ')),
    ].join(','));

    const header = ['Data', 'Contato', 'Telefone', 'Duração (min)', 'Idioma', 'Texto', 'Resumo', 'Tags'].join(',');
    const csv    = [header, ...rows].join('\n');

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="transcricoes-${month}.csv"`);
    return reply.send('﻿' + csv); // BOM para UTF-8 no Excel
  });

  // ── GET /transcriptions/:id ───────────────────────────
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const t = await prisma.transcription.findFirst({
      where:   { id: req.params.id, userId: req.user.sub },
      include: { number: true },
    });
    if (!t) return reply.code(404).send({ error: 'Não encontrado' });
    return {
      ...t,
      contactPhone:   decryptStr(t.contactPhone),
      originalText:   decryptStr(t.originalText),
      summaryBullets: decryptArr(t.summaryBullets as string),
    };
  });

  // ── GET /transcriptions/:id/suggest-reply ───────────
  // Gera 3 sugestões de resposta com Claude (Pro+)
  app.get<{ Params: { id: string } }>(
    '/:id/suggest-reply', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const plan   = await getUserPlan(userId);
      if (!requirePlan(plan, PLAN_AI_FEAT, reply)) return;

      const t = await prisma.transcription.findFirst({ where: { id: req.params.id, userId } });
      if (!t) return reply.code(404).send({ error: 'Não encontrado' });

      const text = decryptStr(t.originalText);
      const bullets = decryptArr(t.summaryBullets as string);
      const contact = t.contactName || decryptStr(t.contactPhone);

      const prompt = `Você é um assistente de comunicação. Analise esta mensagem de áudio recebida via WhatsApp e gere exatamente 3 sugestões de resposta em português brasileiro.

Remetente: ${contact}
Transcrição: "${text}"
${bullets.length ? `Pontos principais:\n${bullets.map(b => `• ${b}`).join('\n')}` : ''}

Gere 3 sugestões de resposta:
1. Curta e direta (1 linha)
2. Média com detalhes (2-3 linhas)
3. Completa e profissional (3-5 linhas)

Responda SOMENTE com JSON no formato:
{"replies": ["resposta curta", "resposta média", "resposta completa"]}`;

      try {
        const response = await anthropic.messages.create({
          model:      'claude-3-haiku-20240307',
          max_tokens: 600,
          messages:   [{ role: 'user', content: prompt }],
        });
        const raw   = (response.content[0] as any).text?.trim() || '{}';
        const match = raw.match(/\{[\s\S]*\}/);
        const json  = JSON.parse(match ? match[0] : raw);
        return { replies: json.replies || [] };
      } catch (err) {
        app.log.error({ err }, 'suggest-reply: Claude error');
        return reply.code(500).send({ error: 'Erro ao gerar sugestões. Tente novamente.' });
      }
    }
  );

  // ── POST /transcriptions/:id/generate-document ────────
  // Gera documento estruturado a partir da transcrição (Pro+)
  app.post<{
    Params: { id: string };
    Body: { docType: 'ata' | 'briefing' | 'combinados' | 'resumo' | 'email' };
  }>(
    '/:id/generate-document', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const plan   = await getUserPlan(userId);
      if (!requirePlan(plan, PLAN_AI_FEAT, reply)) return;

      const { docType = 'resumo' } = req.body;
      const t = await prisma.transcription.findFirst({ where: { id: req.params.id, userId } });
      if (!t) return reply.code(404).send({ error: 'Não encontrado' });

      const text    = decryptStr(t.originalText);
      const bullets = decryptArr(t.summaryBullets as string);
      const contact = t.contactName || decryptStr(t.contactPhone);
      const date    = new Date(t.createdAt).toLocaleDateString('pt-BR');

      const DOC_PROMPTS: Record<string, string> = {
        ata:        `Crie uma ATA DE REUNIÃO formal e profissional em português brasileiro. Inclua: Data, Participantes (${contact}), Pauta, Pontos discutidos, Decisões tomadas, Próximos passos. Use formatação com seções em MAIÚSCULAS e bullet points.`,
        briefing:   `Crie um BRIEFING executivo em português brasileiro. Inclua: Contexto, Objetivo, Pontos principais, Ações necessárias, Prazo/urgência (se mencionado). Formato profissional e conciso.`,
        combinados: `Extraia e liste todos os COMBINADOS E COMPROMISSOS mencionados em português brasileiro. Para cada item: o quê foi combinado, quem é responsável, prazo (se mencionado). Use checkboxes: ☐`,
        resumo:     `Crie um RESUMO EXECUTIVO em português brasileiro com: Situação, Principais pontos, Conclusão. Máximo 200 palavras. Profissional e direto.`,
        email:      `Converta esta mensagem em um EMAIL PROFISSIONAL em português brasileiro. Inclua: Assunto sugerido, Corpo do e-mail completo com saudação e despedida. Tom profissional e cordial.`,
      };

      const prompt = `${DOC_PROMPTS[docType] || DOC_PROMPTS.resumo}

Data da mensagem: ${date}
Remetente: ${contact}
Transcrição completa: "${text}"
${bullets.length ? `Pontos principais já identificados:\n${bullets.map(b => `• ${b}`).join('\n')}` : ''}

Gere apenas o documento, sem explicações adicionais.`;

      try {
        const response = await anthropic.messages.create({
          model:      'claude-3-haiku-20240307',
          max_tokens: 1000,
          messages:   [{ role: 'user', content: prompt }],
        });
        const content = (response.content[0] as any).text?.trim() || '';
        return { docType, content, contact, date };
      } catch (err) {
        app.log.error({ err }, 'generate-document: Claude error');
        return reply.code(500).send({ error: 'Erro ao gerar documento. Tente novamente.' });
      }
    }
  );

  // ── PATCH /transcriptions/:id/tags ───────────────────
  // Atualiza tags de uma transcrição (Pro+)
  app.patch<{ Params: { id: string }; Body: { tags: string[] } }>(
    '/:id/tags', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const plan   = await getUserPlan(userId);
      if (!requirePlan(plan, PLAN_TAGS, reply)) return;

      const { id }   = req.params;
      const { tags } = req.body;

      if (!Array.isArray(tags)) return reply.code(400).send({ error: 'tags deve ser um array.' });
      if (tags.length > 5)      return reply.code(400).send({ error: 'Máximo de 5 tags por transcrição.' });

      const invalid = tags.find(t => typeof t !== 'string' || t.length > 20 || !/^[\w\sÀ-ſ]+$/u.test(t));
      if (invalid !== undefined) return reply.code(400).send({ error: 'Tag inválida. Máx 20 caracteres, sem símbolos.' });

      const t = await prisma.transcription.findFirst({ where: { id, userId } });
      if (!t) return reply.code(404).send({ error: 'Não encontrado' });

      const updated = await (prisma as any).transcription.update({
        where: { id },
        data:  { tags: tags.map((t: string) => t.trim()) },
      });
      return { ...updated, tags: updated.tags };
    }
  );

  // ── DELETE /transcriptions/:id ────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const t = await prisma.transcription.findFirst({ where: { id: req.params.id, userId: req.user.sub } });
    if (!t) return reply.code(404).send({ error: 'Não encontrado' });
    await prisma.transcription.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // ── POST /transcriptions/upload — envio manual ────────
  app.post('/upload', {
    ...auth,
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (req: any, reply) => {
    const userId = req.user.sub;

    // Verificar saldo de minutos
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || balance.availableMinutes < 0.5) {
      return reply.code(402).send({ error: 'Saldo de minutos insuficiente. Faça upgrade do plano.' });
    }

    // Receber arquivo via multipart
    const data   = await req.file();
    if (!data) return reply.code(400).send({ error: 'Arquivo não recebido' });

    const buffer   = await data.toBuffer();
    const filename = data.filename || 'audio.ogg';
    const allowed  = ['.ogg','.opus','.mp3','.mp4','.m4a','.wav','.webm','.mpeg'];
    const ext      = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: `Formato não suportado. Use: ${allowed.join(', ')}` });
    }
    if (buffer.length > 50 * 1024 * 1024) {
      return reply.code(400).send({ error: 'Arquivo muito grande. Máximo: 50MB' });
    }

    // Buscar qualquer número do usuário (conectado ou não) para associar a transcrição
    const number = await prisma.whatsappNumber.findFirst({ where: { userId } });
    if (!number) {
      return reply.code(400).send({ error: 'Adicione ao menos um número WhatsApp no painel antes de enviar áudios manualmente.' });
    }

    // Enfileirar job de transcrição manual
    await transcriptionQueue.add('transcribe-manual', {
      userId,
      numberId:    number.id,
      audioBase64: buffer.toString('base64'),
      filename,
      source:      'manual',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    return reply.code(202).send({ queued: true, message: 'Áudio enfileirado. A transcrição chegará em instantes.' });
  });
}
