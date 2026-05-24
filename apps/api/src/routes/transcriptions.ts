import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { transcriptionQueue } from '../services/queue';
import { decryptStr, decryptArr } from '../services/encryption';
import { getUserPlan, requirePlan } from '../lib/planGate';

// Planos com acesso a cada feature
const PLAN_SEARCH  = ['pro', 'ultra', 'executive'];
const PLAN_EXPORT  = ['pro', 'ultra', 'executive'];
const PLAN_TAGS    = ['ultra', 'executive'];
const PLAN_LANG    = ['ultra', 'executive'];

export default async function transcriptionRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /transcriptions ───────────────────────────────
  app.get<{
    Querystring: {
      limit?: string; offset?: string; numberId?: string;
      search?: string; tag?: string; language?: string;
    }
  }>('/', auth, async (req: any, reply) => {
    const userId   = req.user.sub;
    const limit    = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
    const offset   = Math.max(parseInt(req.query.offset || '0') || 0, 0);
    const numberId = req.query.numberId;
    const search   = req.query.search?.trim();
    const tag      = req.query.tag?.trim();
    const language = req.query.language?.trim();

    const plan = await getUserPlan(userId);

    // ── Busca full-text (Pro+) ─────────────────────────
    if (search) {
      if (!requirePlan(plan, PLAN_SEARCH, reply)) return;

      // Busca server-side: carrega últimas 300 transcrições e decripta em memória
      const allItems = await prisma.transcription.findMany({
        where:   { userId, ...(numberId ? { numberId: numberId === 'none' ? null : numberId } : {}) },
        orderBy: { createdAt: 'desc' },
        take:    300,
        include: { number: { select: { displayName: true, phoneNumber: true } } },
      });

      const q = search.toLowerCase();
      const matched = allItems.filter(t => {
        const text    = decryptStr(t.originalText).toLowerCase();
        const bullets = decryptArr(t.summaryBullets as string).join(' ').toLowerCase();
        const name    = (t.contactName || '').toLowerCase();
        return text.includes(q) || bullets.includes(q) || name.includes(q);
      });

      const total = matched.length;
      const page  = matched.slice(offset, offset + limit).map(t => ({
        ...t,
        contactPhone:   decryptStr(t.contactPhone),
        originalText:   decryptStr(t.originalText),
        summaryBullets: decryptArr(t.summaryBullets as string),
      }));
      return { items: page, total, limit, offset };
    }

    // ── Busca padrão ───────────────────────────────────
    const where: any = { userId };
    if (numberId) where.numberId = numberId === 'none' ? null : numberId;

    // Filtro por tag (Ultra+)
    if (tag) {
      if (!requirePlan(plan, PLAN_TAGS, reply)) return;
      (where as any).tags = { has: tag };
    }

    // Filtro por idioma (Ultra+)
    if (language) {
      if (!requirePlan(plan, PLAN_LANG, reply)) return;
      where.language = language;
    }

    const [items, total] = await Promise.all([
      prisma.transcription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
        include: { number: { select: { displayName: true, phoneNumber: true } } },
      }),
      prisma.transcription.count({ where }),
    ]);

    const decryptedItems = items.map(t => ({
      ...t,
      contactPhone:   decryptStr(t.contactPhone),
      originalText:   decryptStr(t.originalText),
      summaryBullets: decryptArr(t.summaryBullets as string),
    }));

    return { items: decryptedItems, total, limit, offset };
  });

  // ── GET /transcriptions/export ────────────────────────
  // Exporta transcrições do mês em CSV (Pro+)
  app.get<{
    Querystring: { format?: string; month?: string }
  }>('/export', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_EXPORT, reply)) return;

    // format param reservado para versão futura (pdf) — por ora sempre CSV
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM

    const [year, mon] = month.split('-').map(Number);
    const from = new Date(year, mon - 1, 1);
    const to   = new Date(year, mon, 1);

    const items = await prisma.transcription.findMany({
      where:   { userId, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      take:    1000,
    });

    // CSV
    const escCsv = (v: string) => `"${(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const rows = items.map(t => [
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

  // ── PATCH /transcriptions/:id/tags ───────────────────
  // Atualiza tags de uma transcrição (Ultra+)
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
