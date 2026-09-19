import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { prisma } from '../lib/prisma';
import { requireAnyModule } from '../lib/moduleGate';
import { zapscreveQueue } from '../services/queue';
import { validateRequest, zapscreveUploadUrlSchema, zapscreveSendSchema } from '../lib/validation';
import { sendText, fetchAllChats } from '../services/evolution';

/**
 * Rotas do ZapScript ZapScreve — áudio do DONO vira texto refinado, enviado
 * no lugar do áudio. Direção contrária da transcrição de entrada (Legendas/
 * webhook): aqui quem grava é o dono, para SI mesmo decidir o que sai.
 *
 * Sem módulo/gate próprio: acesso via requireAnyModule(['atende','copiloto'])
 * — quem já tem qualquer um dos dois já usa. Ver ESCOPO_ZAPSCREVE.md.
 *
 * Upload do áudio é direto do browser pro Supabase Storage (signed URL),
 * mesmo padrão de legendas.ts — nunca passa pelo Fastify.
 */

const ZAPSCREVE_UPLOADS_BUCKET = 'zapscreve-uploads';

// MediaRecorder do navegador (VoiceRecorder.tsx) grava webm/ogg; aceita mais
// alguns formatos comuns caso o upload venha de outro lugar no futuro.
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a',
]);

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a',
};

// Rascunho abandonado (nunca confirmado/enviado/descartado) não pode viver
// pra sempre — minimização de dado (ESCOPO_ZAPSCREVE.md §6). 24h é folga
// generosa: o fluxo inteiro (gravar → revisar → enviar) dura minutos.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

async function deleteAudioBestEffort(storageKey: string | null) {
  if (!storageKey) return;
  const sb = getSupabase();
  if (!sb) return;
  await sb.storage.from(ZAPSCREVE_UPLOADS_BUCKET).remove([storageKey]).catch(() => null);
}

/** Marca como 'expired' e apaga o áudio de rascunhos abandonados há mais de 24h. */
async function expireStaleDrafts(userId: string): Promise<void> {
  const stale = await prisma.zapScreveDraft.findMany({
    where: {
      userId,
      status:    { in: ['uploading', 'processing', 'ready', 'error'] },
      createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
    },
    select: { id: true, audioStorageKey: true },
  });
  for (const d of stale) {
    await deleteAudioBestEffort(d.audioStorageKey);
    await prisma.zapScreveDraft.update({
      where: { id: d.id },
      data:  { status: 'expired', audioStorageKey: null },
    }).catch(() => null);
  }
}

export default async function zapscreveRoutes(app: FastifyInstance) {
  const auth = {
    preHandler: [(app as any).authenticate, requireAnyModule(['atende', 'copiloto'])],
  };

  async function ownedConnectedNumber(userId: string, numberId: string) {
    return prisma.whatsappNumber.findFirst({
      where:  { id: numberId, userId, status: 'connected' },
      select: { id: true, zapiInstanceId: true },
    });
  }

  // ── POST /zapscreve/upload-url — cria o rascunho e devolve signed upload URL ──
  app.post<{ Body: {
    filename: string; contentType: string; sizeBytes: number;
    numberId: string; targetPhone: string; targetName?: string;
    sourceModule: 'atende' | 'copiloto';
  } }>(
    '/upload-url',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;

      const v = validateRequest(zapscreveUploadUrlSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });
      const { filename, contentType, numberId, targetPhone, targetName, sourceModule } = v.data;

      if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
        return reply.code(400).send({ error: 'Formato de áudio não suportado.' });
      }

      const number = await ownedConnectedNumber(userId, numberId);
      if (!number?.zapiInstanceId) {
        return reply.code(409).send({ error: 'Número precisa estar conectado.' });
      }

      const cleanPhone = targetPhone.replace(/\D/g, '');
      if (!cleanPhone) return reply.code(400).send({ error: 'Contato de destino inválido.' });

      const sb = getSupabase();
      if (!sb) return reply.code(503).send({ error: 'Storage não disponível no momento. Tente novamente em instantes.' });

      const draft = await prisma.zapScreveDraft.create({
        data: {
          userId, numberId, sourceModule,
          targetPhone: cleanPhone,
          targetName:  targetName?.slice(0, 120) || null,
          status:      'uploading',
        },
      });

      const ext = EXT_BY_CONTENT_TYPE[contentType]
        || (filename.split('.').pop() || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
        || 'webm';
      const storageKey = `${userId}/${draft.id}.${ext}`;

      await sb.storage.createBucket(ZAPSCREVE_UPLOADS_BUCKET, { public: false }).catch(() => null);
      const { data, error } = await sb.storage.from(ZAPSCREVE_UPLOADS_BUCKET).createSignedUploadUrl(storageKey);

      if (error || !data) {
        await prisma.zapScreveDraft.delete({ where: { id: draft.id } }).catch(() => null);
        app.log.error({ err: error?.message }, 'zapscreve/upload-url: createSignedUploadUrl falhou');
        return reply.code(503).send({ error: 'Falha ao preparar upload. Tente novamente.' });
      }

      await prisma.zapScreveDraft.update({ where: { id: draft.id }, data: { audioStorageKey: storageKey } });

      return {
        draftId: draft.id,
        bucket:  ZAPSCREVE_UPLOADS_BUCKET,
        path:    data.path,
        token:   data.token,
      };
    }
  );

  // ── POST /zapscreve/:id/confirm — confirma upload concluído e enfileira ──
  app.post<{ Params: { id: string } }>('/:id/confirm', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const draft = await prisma.zapScreveDraft.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!draft) return reply.code(404).send({ error: 'Não encontrado' });
    if (draft.status !== 'uploading') {
      return reply.code(409).send({ error: `Este rascunho já está com status "${draft.status}".` });
    }
    if (!draft.audioStorageKey) {
      return reply.code(409).send({ error: 'Upload do áudio ainda não concluído.' });
    }

    await prisma.zapScreveDraft.update({ where: { id: draft.id }, data: { status: 'processing' } });

    await zapscreveQueue.add('process', {
      draftId:    draft.id,
      userId,
      numberId:   draft.numberId,
      storageKey: draft.audioStorageKey,
    });

    return { queued: true, draftId: draft.id };
  });

  // ── GET /zapscreve — lista os rascunhos recentes do usuário ──
  app.get('/', auth, async (req: any) => {
    const userId = req.user.sub;
    await expireStaleDrafts(userId);
    const items = await prisma.zapScreveDraft.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select: {
        id: true, targetPhone: true, targetName: true, status: true, errorMessage: true,
        quickText: true, copilotoText: true, sentText: true, sentVia: true,
        durationSec: true, createdAt: true, sentAt: true,
        audioStorageKey: true, // só pra `hasAudio` abaixo — a key crua não sai da rota
      },
    });
    return { items: items.map(({ audioStorageKey, ...rest }) => ({ ...rest, hasAudio: !!audioStorageKey })) };
  });

  // ── GET /zapscreve/:id — status/conteúdo de um rascunho (poll durante processamento) ──
  app.get<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    await expireStaleDrafts(userId);
    const draft = await prisma.zapScreveDraft.findFirst({ where: { id: req.params.id, userId } });
    if (!draft) return reply.code(404).send({ error: 'Não encontrado' });
    const { audioStorageKey, ...rest } = draft;
    return { ...rest, hasAudio: !!audioStorageKey };
  });

  // ── GET /zapscreve/:id/audio-url — signed URL pra ouvir o áudio original na revisão ──
  app.get<{ Params: { id: string } }>('/:id/audio-url', auth, async (req: any, reply) => {
    const draft = await prisma.zapScreveDraft.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!draft?.audioStorageKey) return reply.code(404).send({ error: 'Áudio não disponível.' });

    const sb = getSupabase();
    if (!sb) return reply.code(503).send({ error: 'Storage não disponível.' });

    const { data, error } = await sb.storage.from(ZAPSCREVE_UPLOADS_BUCKET).createSignedUrl(draft.audioStorageKey, 300);
    if (error || !data?.signedUrl) return reply.code(404).send({ error: 'Áudio não disponível.' });
    return { url: data.signedUrl };
  });

  // ── GET /zapscreve/contacts?numberId= — chats recentes da conexão pra escolher o destino ──
  // Não depende de CRM/Copiloto (ESCOPO_ZAPSCREVE.md §4) — lê direto da Evolution.
  app.get<{ Querystring: { numberId?: string } }>('/contacts', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const numberId = req.query?.numberId;
    if (!numberId) return reply.code(400).send({ error: 'numberId é obrigatório.' });

    const number = await ownedConnectedNumber(userId, numberId);
    if (!number?.zapiInstanceId) return reply.code(409).send({ error: 'Número precisa estar conectado.' });

    try {
      const chats = await fetchAllChats(number.zapiInstanceId, 50);
      // Só contatos individuais — grupo não é "destino" no sentido do ZapScreve v1 (ver escopo §4/§12).
      const individuals = chats.filter((c) => c.type === 'individual');
      return { items: individuals.map((c) => ({ phone: c.phone, name: c.name })) };
    } catch (err: any) {
      app.log.error({ err: err.message }, 'zapscreve/contacts: fetchAllChats falhou');
      return reply.code(502).send({ error: 'Não foi possível buscar as conversas agora. Tente de novo.' });
    }
  });

  // ── POST /zapscreve/:id/send — envia como TEXTO ao contato escolhido ──
  app.post<{ Params: { id: string }; Body: { variant: 'quick' | 'copiloto' | 'edited'; text?: string } }>(
    '/:id/send', auth, async (req: any, reply) => {
      const userId = req.user.sub;

      const v = validateRequest(zapscreveSendSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });
      const { variant, text } = v.data;

      const draft = await prisma.zapScreveDraft.findFirst({ where: { id: req.params.id, userId } });
      if (!draft) return reply.code(404).send({ error: 'Não encontrado' });
      if (draft.status !== 'ready') {
        return reply.code(409).send({ error: `Este rascunho está com status "${draft.status}" — não pode ser enviado agora.` });
      }

      let finalText: string | null = null;
      if (variant === 'edited') {
        finalText = text?.trim() || null;
        if (!finalText) return reply.code(400).send({ error: 'Texto editado não pode ser vazio.' });
      } else if (variant === 'quick') {
        finalText = draft.quickText;
      } else {
        finalText = draft.copilotoText;
      }
      if (!finalText) {
        return reply.code(409).send({ error: `Versão "${variant}" ainda não está disponível para este rascunho.` });
      }

      const number = await prisma.whatsappNumber.findUnique({
        where:  { id: draft.numberId },
        select: { zapiInstanceId: true, status: true },
      });
      if (!number?.zapiInstanceId || number.status !== 'connected') {
        return reply.code(409).send({ error: 'Número precisa estar conectado para enviar.' });
      }

      await sendText(number.zapiInstanceId, draft.targetPhone, finalText);

      await deleteAudioBestEffort(draft.audioStorageKey);
      await prisma.zapScreveDraft.update({
        where: { id: draft.id },
        data:  { status: 'sent', sentText: finalText, sentVia: variant, sentAt: new Date(), audioStorageKey: null },
      });

      return { ok: true, sentTo: draft.targetName || draft.targetPhone };
    }
  );

  // ── DELETE /zapscreve/:id — descarta o rascunho ──
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const draft = await prisma.zapScreveDraft.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!draft) return reply.code(404).send({ error: 'Não encontrado' });
    if (draft.status === 'sent' || draft.status === 'discarded') {
      return reply.code(409).send({ error: `Este rascunho já está com status "${draft.status}".` });
    }

    await deleteAudioBestEffort(draft.audioStorageKey);
    await prisma.zapScreveDraft.update({
      where: { id: draft.id },
      data:  { status: 'discarded', audioStorageKey: null },
    });

    return reply.code(204).send();
  });
}
