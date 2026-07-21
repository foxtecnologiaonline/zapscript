import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../../lib/prisma';
import { transcriptionQueue } from '../../services/queue';
import { decryptStr, decryptArr } from '../../services/encryption';
import { requireModule } from '../../lib/moduleGate';

// Mesmo bucket efêmero do Core (audio-temp) — áudio é removido pelo worker
// após o processamento (sucesso ou falha); Vendas não retém áudio.
const AUDIO_TEMP_BUCKET = 'audio-temp';
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 60MB — chamadas comerciais podem passar do teto global de 15MB

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

function toVisitSummary(v: any) {
  return {
    id:             v.id,
    clientName:     v.clientName,
    filename:       v.filename,
    status:         v.status,
    durationSec:    v.durationSec,
    summaryBullets: v.status === 'done' ? decryptArr(v.summaryBullets) : [],
    errorMessage:   v.errorMessage,
    createdAt:      v.createdAt,
  };
}

export default async function vendasRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate, requireModule('vendas')] };

  // ── POST /modules/vendas — upload de áudio da visita/ligação ─────────────
  app.post('/', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (req: any, reply) => {
    const userId = req.user.sub;

    let clientName: string | undefined;
    let fileBuffer: Buffer | undefined;
    let filename: string | undefined;
    let mimetype: string | undefined;

    for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES } })) {
      if (part.type === 'field' && part.fieldname === 'clientName') {
        const v = typeof part.value === 'string' ? part.value : part.value?.toString('utf-8');
        clientName = v?.trim().slice(0, 200) || undefined;
      } else if (part.type === 'file' && part.fieldname === 'audio') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
        if (part.file.truncated) {
          return reply.code(400).send({ error: `Arquivo excede o limite de ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` });
        }
        filename = part.filename;
        mimetype = part.mimetype;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ error: 'Áudio não enviado (campo "audio" obrigatório)' });
    }
    if (!mimetype || (!mimetype.startsWith('audio/') && !mimetype.startsWith('video/'))) {
      return reply.code(400).send({ error: 'Arquivo precisa ser um áudio' });
    }

    const visit = await prisma.salesVisit.create({
      data: { userId, clientName: clientName ?? null, filename: filename ?? null, status: 'processing' },
    });

    const storageKey = `vendas/${userId}/${visit.id}.audio`;
    try {
      const supabase = getSupabase();
      const { error: uploadError } = await supabase.storage
        .from(AUDIO_TEMP_BUCKET)
        .upload(storageKey, fileBuffer, { contentType: mimetype || 'application/octet-stream', upsert: false });
      if (uploadError) throw new Error(uploadError.message);
    } catch (err: any) {
      app.log.error({ err: err.message }, '[Vendas] Falha no upload para Supabase Storage');
      await prisma.salesVisit.delete({ where: { id: visit.id } }).catch(() => null);
      return reply.code(500).send({ error: 'Falha ao armazenar áudio. Tente novamente.' });
    }

    await transcriptionQueue.add('vendas', {
      source: 'vendas', visitId: visit.id, userId, storageKey, clientName,
    });

    return reply.code(201).send(toVisitSummary(visit));
  });

  // ── GET /modules/vendas — lista as visitas do usuário ─────────────────────
  app.get('/', auth, async (req: any) => {
    const visits = await prisma.salesVisit.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    return visits.map(toVisitSummary);
  });

  // ── GET /modules/vendas/:id — detalhe completo (transcrição + resumo) ─────
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const v = await prisma.salesVisit.findFirst({ where: { id: req.params.id, userId: req.user.sub } });
    if (!v) return reply.code(404).send({ error: 'Visita não encontrada' });
    return {
      ...toVisitSummary(v),
      originalText: v.status === 'done' ? decryptStr(v.originalText) : null,
    };
  });

  // ── DELETE /modules/vendas/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const v = await prisma.salesVisit.findFirst({ where: { id: req.params.id, userId: req.user.sub } });
    if (!v) return reply.code(404).send({ error: 'Visita não encontrada' });
    await prisma.salesVisit.delete({ where: { id: v.id } });
    return reply.code(204).send();
  });
}
