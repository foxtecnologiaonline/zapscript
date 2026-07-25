import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import { legendaQueue } from '../services/queue';
import { validateRequest, legendaUploadUrlSchema } from '../lib/validation';

const LEGENDA_UPLOADS_BUCKET = 'legenda-uploads';
const LEGENDA_OUTPUT_BUCKET  = 'legenda-output';

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/3gpp', 'video/x-msvideo',
]);

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Rotas do módulo Legendas (upload de vídeo → .srt/.vtt via Whisper).
 * Upload dos bytes do vídeo é direto do browser para o Supabase Storage
 * (signed upload URL) — nunca passa pelo Fastify, que tem teto de 15MB.
 */
export default async function legendaRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate, requireModule('legenda')] };

  // ── POST /legendas/upload-url — cria o job e devolve um signed upload URL ──
  app.post<{ Body: { filename: string; contentType: string; sizeBytes: number } }>(
    '/upload-url',
    { ...auth, config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;

      const v = validateRequest(legendaUploadUrlSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });
      const { filename, contentType, sizeBytes } = v.data;

      if (!ALLOWED_VIDEO_TYPES.has(contentType)) {
        return reply.code(400).send({ error: 'Formato não suportado. Envie MP4, MOV, WebM, MKV, 3GP ou AVI.' });
      }

      const sb = getSupabase();
      if (!sb) return reply.code(503).send({ error: 'Storage não disponível no momento. Tente novamente em instantes.' });

      const job = await prisma.legendaJob.create({
        data: {
          userId,
          status:           'pending',
          originalFilename:  filename.slice(0, 200),
          inputStorageKey:   '', // preenchido abaixo — a key inclui o próprio id do job
          inputSizeBytes:    Math.round(sizeBytes),
        },
      });

      const ext = (filename.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'mp4';
      const storageKey = `${userId}/${job.id}.${ext}`;

      await sb.storage.createBucket(LEGENDA_UPLOADS_BUCKET, { public: false }).catch(() => null);
      const { data, error } = await sb.storage.from(LEGENDA_UPLOADS_BUCKET).createSignedUploadUrl(storageKey);

      if (error || !data) {
        await prisma.legendaJob.delete({ where: { id: job.id } }).catch(() => null);
        app.log.error({ err: error?.message }, 'legendas/upload-url: createSignedUploadUrl falhou');
        return reply.code(503).send({ error: 'Falha ao preparar upload. Tente novamente.' });
      }

      await prisma.legendaJob.update({ where: { id: job.id }, data: { inputStorageKey: storageKey } });

      return {
        legendaJobId: job.id,
        bucket:       LEGENDA_UPLOADS_BUCKET,
        path:         data.path,
        token:        data.token,
      };
    }
  );

  // ── POST /legendas/:id/confirm — confirma upload concluído e enfileira ──
  app.post<{ Params: { id: string } }>('/:id/confirm', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const job = await prisma.legendaJob.findFirst({
      where: { id: req.params.id, userId, deletedAt: null },
    });
    if (!job) return reply.code(404).send({ error: 'Não encontrado' });
    if (job.status !== 'pending') {
      return reply.code(409).send({ error: 'Este job já foi confirmado ou processado.' });
    }

    await legendaQueue.add('legenda', {
      legendaJobId:     job.id,
      userId,
      storageKey:       job.inputStorageKey,
      originalFilename: job.originalFilename,
    });

    return { queued: true, legendaJobId: job.id };
  });

  // ── GET /legendas — lista os jobs do usuário ──
  app.get('/', auth, async (req: any) => {
    const userId = req.user.sub;
    const items = await prisma.legendaJob.findMany({
      where:   { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    return { items };
  });

  // ── GET /legendas/:id — status de um job ──
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const job = await prisma.legendaJob.findFirst({
      where: { id: req.params.id, userId: req.user.sub, deletedAt: null },
    });
    if (!job) return reply.code(404).send({ error: 'Não encontrado' });
    return job;
  });

  // ── GET /legendas/:id/download?format=srt|vtt — signed URL de download ──
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/:id/download', auth, async (req: any, reply) => {
      const format = (req.query.format || 'srt').toLowerCase();
      if (format !== 'srt' && format !== 'vtt') {
        return reply.code(400).send({ error: 'Formato inválido — use srt ou vtt.' });
      }

      const job = await prisma.legendaJob.findFirst({
        where: { id: req.params.id, userId: req.user.sub, deletedAt: null },
      });
      if (!job || job.status !== 'done') {
        return reply.code(404).send({ error: 'Legenda ainda não disponível.' });
      }

      const key = format === 'srt' ? job.srtStorageKey : job.vttStorageKey;
      if (!key) return reply.code(404).send({ error: 'Arquivo não encontrado.' });

      const sb = getSupabase();
      if (!sb) return reply.code(503).send({ error: 'Storage não disponível.' });

      const { data, error } = await sb.storage
        .from(LEGENDA_OUTPUT_BUCKET)
        .createSignedUrl(key, 600, { download: `legenda-${job.id.slice(0, 8)}.${format}` });

      if (error || !data?.signedUrl) {
        return reply.code(404).send({ error: 'Arquivo não disponível para download.' });
      }
      // JSON (não redirect): a autenticação é via Bearer no header, que um
      // <a href> ou redirect do browser não reenviaria à Supabase Storage.
      return { url: data.signedUrl };
    }
  );

  // ── DELETE /legendas/:id — soft delete + remoção best-effort do storage ──
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const job = await prisma.legendaJob.findFirst({
      where: { id: req.params.id, userId: req.user.sub, deletedAt: null },
    });
    if (!job) return reply.code(404).send({ error: 'Não encontrado' });

    await prisma.legendaJob.update({ where: { id: job.id }, data: { deletedAt: new Date() } });

    const sb = getSupabase();
    if (sb) {
      const keys = [job.srtStorageKey, job.vttStorageKey].filter((k): k is string => !!k);
      if (keys.length) sb.storage.from(LEGENDA_OUTPUT_BUCKET).remove(keys).catch(() => null);
    }

    return reply.code(204).send();
  });
}
