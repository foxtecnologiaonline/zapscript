import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { prisma } from '../lib/prisma';
import { transcriptionQueue } from '../services/queue';
import { decryptStr, decryptArr } from '../services/encryption';
import { getUserPlan, requirePlan } from '../lib/planGate';

// ── Supabase Storage para áudios temporários ──────────────────────
const AUDIO_TEMP_BUCKET = 'audio-temp';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  // Node.js 20 não tem WebSocket nativo — passar ws como transport
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Faz upload do buffer de áudio para o Supabase Storage (bucket audio-temp).
 * Retorna a storage key (caminho dentro do bucket).
 * Usado para evitar o limite de 10MB do Upstash no payload dos jobs.
 */
async function uploadAudioToStorage(buffer: Buffer, userId: string, filename: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY)');

  const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '.bin';
  const key = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

  // Cria bucket se não existir (idempotente — ignora erro se já existe)
  await supabase.storage.createBucket(AUDIO_TEMP_BUCKET, { public: false }).catch(() => null);

  const { error } = await supabase.storage.from(AUDIO_TEMP_BUCKET).upload(key, buffer, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Supabase Storage upload falhou: ${error.message}`);
  return key;
}

// Planos com acesso a cada feature (pro-tester tem paridade total com pro)
const PLAN_SEARCH  = ['free', 'pro', 'pro-tester', 'executive']; // busca liberada para todos os planos
const PLAN_EXPORT  = ['pro', 'pro-tester', 'executive'];   // Exportação disponível para Pro+
const PLAN_TAGS    = ['pro', 'pro-tester', 'executive'];   // tags abertas para Pro+
const PLAN_LANG    = ['pro', 'pro-tester', 'executive'];   // filtro por idioma para Pro+
const PLAN_AI_FEAT = ['pro', 'pro-tester', 'executive'];   // reply sugerida + doc para Pro+

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Transcrição Profissional — HTML imprimível ───────────────────────────────
function buildJuridicalPdfHtml(t: any, transcriptText: string): string {
  const createdAt = new Date(t.createdAt);
  const dateStr   = createdAt.toLocaleString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  const totalSec  = Math.round(t.durationSec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const durStr = h > 0 ? `${h}h ${m}min ${s}s` : `${m}min ${s}s`;

  const LANG: Record<string, string> = {
    pt: 'Português (Brasil)', 'pt-BR': 'Português (Brasil)',
    en: 'Inglês (English)', es: 'Espanhol (Español)',
    fr: 'Francês (Français)', de: 'Alemão (Deutsch)',
    it: 'Italiano', ja: 'Japonês', zh: 'Mandarim',
  };
  const language = LANG[t.language] || t.language.toUpperCase();
  const docId    = t.id.toUpperCase();
  const shortId  = t.id.slice(0, 8).toUpperCase();

  const esc = (v: string) => (v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Highlight timestamps [MM:SS] e [HH:MM:SS] em verde
  const body = esc(transcriptText)
    .replace(/\[(\d{2}:\d{2}(?::\d{2})?)\]/g, '<span class="ts">[$1]</span>');

  const now = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Transcrição de Áudio — ${shortId}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.55;color:#111;background:#fff;padding:2.5cm 3cm}
.no-print{background:#0a5c3e;color:#fff;padding:10px 20px;margin:-2.5cm -3cm 2cm;font-family:Arial,sans-serif;font-size:11pt;display:flex;align-items:center;justify-content:space-between;gap:12px}
.no-print a{color:#6ee7b7;font-weight:bold;text-decoration:none;white-space:nowrap}
.no-print a:hover{text-decoration:underline}
.header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #0a5c3e;padding-bottom:12pt;margin-bottom:16pt}
.brand{font-family:Arial,sans-serif}
.brand-name{font-size:20pt;font-weight:900;color:#0a5c3e;letter-spacing:-1pt}
.brand-name em{color:#333;font-style:normal}
.brand-sub{font-size:8.5pt;color:#666;margin-top:2pt}
.doc-ref{text-align:right;font-family:'Courier New',monospace;font-size:9pt;color:#555}
.doc-ref strong{font-size:10pt;color:#111;display:block;letter-spacing:1pt}
h1{font-family:Arial,sans-serif;font-size:13.5pt;font-weight:900;text-align:center;letter-spacing:2.5pt;text-transform:uppercase;margin-bottom:3pt}
h2.sub{font-family:Arial,sans-serif;font-size:9.5pt;font-weight:400;text-align:center;color:#555;margin-bottom:18pt}
hr.div{border:none;border-top:1px solid #ccc;margin:14pt 0}
table.meta{width:100%;border-collapse:collapse;margin-bottom:16pt;font-family:Arial,sans-serif;font-size:10pt}
table.meta td{padding:5pt 9pt;border:1px solid #ccc;vertical-align:top;line-height:1.45}
table.meta td:first-child{background:#f3f3f3;font-weight:700;width:38%;font-size:9.5pt;color:#333}
.box{font-family:Arial,sans-serif;font-size:9pt;color:#2c2c2c;border-left:4pt solid #0a5c3e;padding:9pt 13pt;margin-bottom:18pt;background:#f4fbf7;line-height:1.65}
.box strong{color:#0a5c3e}
.sec{font-family:Arial,sans-serif;font-size:9.5pt;font-weight:900;text-transform:uppercase;letter-spacing:1.5pt;border-bottom:1px solid #bbb;padding-bottom:4pt;margin-bottom:11pt}
.transcript{font-family:'Courier New',monospace;font-size:10pt;line-height:2;white-space:pre-wrap;background:#fafafa;border:1px solid #ddd;padding:14pt 16pt}
.ts{color:#0a5c3e;font-weight:700;letter-spacing:.5pt}
.footer{margin-top:24pt;padding-top:9pt;border-top:1px solid #ccc;font-family:Arial,sans-serif;font-size:8.5pt;color:#888;display:flex;justify-content:space-between;gap:12px}
.end{text-align:center;color:#ccc;font-size:8.5pt;font-family:Arial,sans-serif;margin-top:10pt;letter-spacing:2pt}
@media print{
  .no-print{display:none!important}
  body{padding:2cm 2.5cm}
  @page{margin:2cm 2.5cm;size:A4 portrait}
}
</style>
</head>
<body>

<div class="no-print">
  <span>📄 Pressione <strong>Ctrl+P</strong> (ou <strong>⌘P</strong>) → "Salvar como PDF" — ou clique ao lado</span>
  <a href="javascript:window.print()">🖨️ Imprimir / Salvar PDF</a>
</div>

<div class="header">
  <div class="brand">
    <div class="brand-name">Zap<em>Script</em></div>
    <div class="brand-sub">Plataforma de Transcrição Automática · zapscript.me</div>
  </div>
  <div class="doc-ref">
    <strong>${shortId}</strong>
    Protocolo do Documento
  </div>
</div>

<h1>Transcrição Literal de Áudio</h1>
<h2 class="sub">Documento gerado eletronicamente com marcação temporal — adequado para arquivo, comprovação e fins probatórios</h2>

<hr class="div">

<table class="meta">
  <tr><td>Número do Protocolo</td><td><span style="font-family:monospace;font-size:10pt">${docId}</span></td></tr>
  <tr><td>Data e Hora da Transcrição</td><td>${dateStr} (Horário de Brasília)</td></tr>
  <tr><td>Arquivo de Origem</td><td><span style="font-family:monospace;font-size:10pt">${esc(t.filename || '—')}</span></td></tr>
  <tr><td>Duração Total do Áudio</td><td>${durStr}</td></tr>
  <tr><td>Idioma Detectado</td><td>${language}</td></tr>
  <tr><td>Origem</td><td>Upload manual — ZapScript Dashboard</td></tr>
  <tr><td>Tecnologia</td><td>Whisper ASR — Groq whisper-large-v3-turbo (alta precisão)</td></tr>
  <tr><td>Marcação Temporal</td><td>Por segmento de fala — formato [MM:SS] referenciado ao início do áudio</td></tr>
  <tr><td>Emitido por</td><td>ZapScript — Plataforma de Transcrição Automática (zapscript.me)</td></tr>
</table>

<div class="box">
  <strong>Origem e Integridade:</strong> Esta transcrição foi gerada automaticamente pela plataforma
  <strong>ZapScript</strong> com uso de modelo de reconhecimento de fala de nível profissional (Whisper / Groq),
  reproduzindo o conteúdo auditivo do arquivo de origem sem edições ou correções.
  As marcações temporais no formato <span style="font-family:monospace;color:#0a5c3e">[MM:SS]</span> indicam o instante
  de início de cada segmento de fala no áudio de referência.
  Identificação única do documento: <span style="font-family:monospace">${shortId}</span>.
</div>

<div class="sec">Conteúdo Transcrito</div>
<div class="transcript">${body}</div>

<div class="footer">
  <span>ZapScript — Transcrição Automática de Áudio · zapscript.me</span>
  <span>Gerado em: ${now} (Horário de Brasília)</span>
</div>
<div class="end">· · · Fim do Documento · · ·</div>

<script>
const b = document.querySelector('.no-print');
if (b) b.style.display = 'flex';
</script>
</body>
</html>`;
}

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
    if (source) {
      // 'whatsapp-evolution' agrupa todos os provedores de WhatsApp recebidos
      // (inclui registros antigos com source='whatsapp' — o default do schema)
      if (source === 'whatsapp-evolution') {
        where.source = { in: ['whatsapp', 'whatsapp-evolution', 'whatsapp-zapi', 'whatsapp-meta', 'whatsapp-twilio'] };
      } else {
        where.source = source;
      }
    }

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

  // ── GET /transcriptions/:id/juridical-pdf ────────────────────────────
  // Laudo jurídico em HTML imprimível (Ctrl+P → Salvar como PDF).
  // Disponível para todos os planos que têm upload manual.
  app.get<{ Params: { id: string } }>(
    '/:id/juridical-pdf', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const t = await prisma.transcription.findFirst({
        where: { id: req.params.id, userId, source: 'manual' },
      });
      if (!t) return reply.code(404).send({ error: 'Transcrição não encontrada (apenas uploads manuais)' });

      const transcriptText = decryptStr(t.originalText);
      const html = buildJuridicalPdfHtml(t, transcriptText);

      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Content-Disposition', `inline; filename="transcricao-${t.id.slice(0, 8).toUpperCase()}.pdf"`);
      return reply.send(html);
    }
  );

  // ── GET /transcriptions/:id/audio-download ────────────────────────────
  // Retorna signed URL para download do MP3 gerado no upload manual.
  // Válido por 10 minutos.
  app.get<{ Params: { id: string } }>(
    '/:id/audio-download', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const t = await prisma.transcription.findFirst({
        where: { id: req.params.id, userId, source: 'manual' },
      });
      if (!t) return reply.code(404).send({ error: 'Transcrição não encontrada' });

      const sb = getSupabase();
      if (!sb) return reply.code(503).send({ error: 'Storage não disponível' });

      const audioPath = `${userId}/${t.id}.mp3`;
      const { data, error } = await sb.storage
        .from('audio-juridical')
        .createSignedUrl(audioPath, 600); // 10 minutos

      if (error || !data?.signedUrl) {
        return reply.code(404).send({ error: 'Áudio não disponível para este registro.' });
      }

      return reply.redirect(data.signedUrl);
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

    // Upload de áudio no site — funcionalidade exclusiva Pro
    const uploadPlan = await getUserPlan(userId);
    if (!requirePlan(uploadPlan, ['pro', 'pro-tester', 'executive'], reply)) return;

    // Limite de tamanho por plano: Pro=100MB, Executive=200MB
    const maxBytes   = uploadPlan === 'executive' ? 200 * 1024 * 1024 : 100 * 1024 * 1024;
    const maxLabel   = uploadPlan === 'executive' ? '200MB' : '100MB';

    // Receber arquivo via multipart
    const data   = await req.file();
    if (!data) return reply.code(400).send({ error: 'Arquivo não recebido' });

    const buffer   = await data.toBuffer();
    const filename = data.filename || 'audio.ogg';
    const allowed  = [
      '.ogg','.opus','.mp3','.mp4','.m4a','.wav','.webm','.mpeg',
      '.aac','.flac','.wma','.amr','.3gp','.aiff','.aif',
    ];
    const ext      = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: `Formato não suportado. Use: ${allowed.join(', ')}` });
    }
    if (buffer.length > maxBytes) {
      return reply.code(400).send({ error: `Arquivo muito grande. Máximo: ${maxLabel}` });
    }

    // Buscar qualquer número do usuário (conectado ou não) para associar a transcrição
    const number = await prisma.whatsappNumber.findFirst({ where: { userId } });
    if (!number) {
      return reply.code(400).send({ error: 'Adicione ao menos um número WhatsApp no painel antes de enviar áudios manualmente.' });
    }

    // ── Upload para Supabase Storage (evita limite 10MB do Upstash) ──
    // Para arquivos grandes, armazenamos no Storage e passamos só a key.
    // Fallback base64 apenas se Supabase não estiver configurado E arquivo < 7MB.
    let storageKey: string | null = null;
    try {
      storageKey = await uploadAudioToStorage(buffer, userId, filename);
    } catch (storErr: any) {
      if (buffer.length > 7 * 1024 * 1024) {
        // Arquivo grande E Supabase falhou → não conseguimos processar
        return reply.code(500).send({ error: 'Erro ao armazenar áudio temporariamente. Tente novamente.' });
      }
      // Arquivo pequeno (<7MB) → fallback base64 (OK para Upstash)
    }

    // Enfileirar job de transcrição manual
    await transcriptionQueue.add('transcribe-manual', {
      userId,
      numberId: number.id,
      filename,
      source:   'manual',
      ...(storageKey ? { storageKey } : { audioBase64: buffer.toString('base64') }),
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    return reply.code(202).send({ queued: true, message: 'Áudio enfileirado. A transcrição chegará em instantes.' });
  });

  // ── POST /transcriptions/voice-note — gravação do browser ────────
  // Exclusivo do plano Executive.
  // Após transcrição, envia resultado de volta ao número WhatsApp do próprio usuário (se conectado).
  app.post('/voice-note', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
  }, async (req: any, reply) => {
    const userId = req.user.sub;

    // Verificar plano — Pro+ (Pro e Executive)
    const plan = await getUserPlan(userId);
    if (plan === 'free') {
      return reply.code(403).send({ error: 'Notas de Voz estão disponíveis nos planos Pro e Executive.' });
    }

    // Verificar saldo de minutos
    const balance = await prisma.minuteBalance.findUnique({ where: { userId } });
    if (!balance || balance.availableMinutes < 0.1) {
      return reply.code(402).send({ error: 'Saldo de minutos insuficiente.' });
    }

    // Receber arquivo via multipart
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Arquivo não recebido' });

    const buffer   = await data.toBuffer();
    const filename = data.filename || 'nota.webm';
    const allowed  = ['.ogg', '.opus', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.mpeg'];
    const ext      = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext) && !filename.includes('blob')) {
      // webm gravado pelo browser pode vir sem extensão — aceitar
    }
    if (buffer.length > 50 * 1024 * 1024) {
      return reply.code(400).send({ error: 'Arquivo muito grande. Máximo: 50MB' });
    }

    // Buscar número conectado do usuário (para envio de volta via WhatsApp)
    const number = await prisma.whatsappNumber.findFirst({
      where: { userId, status: 'connected' },
      orderBy: { connectedAt: 'desc' },
    });

    // Se não tem número conectado, aceita mesmo assim (salva sem envio WhatsApp)
    const fallbackNumber = number ?? await prisma.whatsappNumber.findFirst({ where: { userId } });

    // Upload para Supabase Storage (evita limite 10MB do Upstash)
    let vnStorageKey: string | null = null;
    try {
      vnStorageKey = await uploadAudioToStorage(buffer, userId, filename);
    } catch (storErr: any) {
      if (buffer.length > 7 * 1024 * 1024) {
        return reply.code(500).send({ error: 'Erro ao armazenar nota de voz. Tente novamente.' });
      }
    }

    await transcriptionQueue.add('transcribe-voice-note', {
      userId,
      numberId:     fallbackNumber?.id,
      instanceName: number?.zapiInstanceId ?? null,
      selfPhone:    number?.phoneNumber    ?? null,
      filename,
      source:       'voice-note',
      ...(vnStorageKey ? { storageKey: vnStorageKey } : { audioBase64: buffer.toString('base64') }),
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    return reply.code(202).send({ queued: true, message: 'Nota de voz enfileirada. A transcrição chegará em instantes.' });
  });

  // ── GET /transcriptions/queue/status — contagem de jobs na fila do usuário ──
  app.get('/queue/status', { ...auth }, async (req: any, _reply) => {
    const userId = req.user.sub;
    try {
      const [failedJobs, waitingJobs, activeJobs] = await Promise.all([
        transcriptionQueue.getFailed(),
        transcriptionQueue.getWaiting(),
        transcriptionQueue.getActive(),
      ]);
      const myFailed  = failedJobs.filter(j  => j.data?.userId === userId).length;
      const myWaiting = waitingJobs.filter(j  => j.data?.userId === userId).length;
      const myActive  = activeJobs.filter(j   => j.data?.userId === userId).length;
      return { failed: myFailed, waiting: myWaiting, active: myActive };
    } catch (err) {
      app.log.error(err, 'queue/status error');
      return { failed: 0, waiting: 0, active: 0 };
    }
  });

  // ── POST /transcriptions/queue/clear-failed — remove jobs com falha do usuário ──
  app.post('/queue/clear-failed', { ...auth }, async (req: any, reply) => {
    const userId = req.user.sub;
    try {
      const failedJobs = await transcriptionQueue.getFailed();
      const mine       = failedJobs.filter(j => j.data?.userId === userId);
      await Promise.all(mine.map(j => j.remove()));
      app.log.info(`queue/clear-failed: removidos ${mine.length} jobs para userId=${userId}`);
      return reply.send({ removed: mine.length });
    } catch (err) {
      app.log.error(err, 'queue/clear-failed error');
      return reply.code(500).send({ error: 'Erro ao limpar fila. Tente novamente.' });
    }
  });
}
