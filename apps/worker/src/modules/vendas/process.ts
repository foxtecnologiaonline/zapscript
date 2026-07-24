import { Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { convertToMp3 } from '../../services/audio';
import { encryptStr, encryptArr } from '../../services/encryption';
import { transcribeAudio, generateBullets } from '../../index';

// Mesmo bucket efêmero usado pelo Core (audio-temp) — sem retenção de áudio
// para o módulo Vendas: arquivo é removido no `finally`, sucesso ou falha.
const AUDIO_TEMP_BUCKET = 'audio-temp';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    realtime: { transport: ws as any },
    auth:     { persistSession: false, autoRefreshToken: false },
  });
}

async function downloadFromStorage(storageKey: string): Promise<Buffer> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase não configurado no worker (SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  const { data, error } = await sb.storage.from(AUDIO_TEMP_BUCKET).download(storageKey);
  if (error) throw new Error(`Supabase Storage download falhou: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function deleteFromStorage(storageKey: string): Promise<void> {
  try {
    const sb = getSupabaseClient();
    if (!sb) return;
    await sb.storage.from(AUDIO_TEMP_BUCKET).remove([storageKey]);
  } catch { /* non-fatal */ }
}

/**
 * Pipeline do módulo Vendas: visita/ligação comercial gravada → transcrita e
 * resumida (Claude já prioriza valores, objeções, combinados e próximo passo
 * via detecção automática de domínio em generateBullets). Gate de acesso é o
 * entitlement do módulo — não consome o MinuteBalance/audiosUsed do Core.
 */
export async function processVendasJob(job: Job) {
  const { visitId, userId, storageKey, clientName } = job.data as {
    visitId: string; userId: string; storageKey: string; clientName?: string;
  };

  logger.info(`[Vendas] 📥 Processando visita ${visitId}`, { jobId: job.id });

  let mp3Buffer: Buffer | null = null;

  try {
    logger.info(`[Vendas] ☁️ Baixando do Supabase Storage: ${storageKey}`, { jobId: job.id });
    const rawBuffer = await downloadFromStorage(storageKey);

    if (rawBuffer.length > 100 * 1024 * 1024) {
      throw new Error('Arquivo excede limite de 100MB');
    }

    logger.info('[Vendas] 🔄 Convertendo para MP3...', { jobId: job.id });
    mp3Buffer = await convertToMp3(rawBuffer);

    logger.info('[Vendas] 🎙️ Whisper...', { jobId: job.id });
    const { text, durationSec, language } = await transcribeAudio(mp3Buffer, {
      vocab: clientName ? [clientName] : undefined,
    });

    logger.info('[Vendas] 🤖 Claude resumo...', { jobId: job.id });
    const bullets = await generateBullets(text, durationSec, language);

    await prisma.salesVisit.updateMany({
      where: { id: visitId, userId },
      data: {
        status:         'done',
        durationSec,
        originalText:   encryptStr(text),
        summaryBullets: encryptArr(bullets) as any,
      },
    });

    logger.info(`[Vendas] ✅ Visita ${visitId} concluída (${bullets.length} bullet(s))`, { jobId: job.id });
    return { visitId };

  } catch (err) {
    const message = (err as Error).message;
    logger.error(`[Vendas] ❌ Erro na visita ${visitId}: ${message}`, { jobId: job.id });
    await prisma.salesVisit.updateMany({
      where: { id: visitId, userId },
      data: { status: 'error', errorMessage: message.slice(0, 500) },
    }).catch(() => null);
    throw err;

  } finally {
    mp3Buffer?.fill(0);
    await deleteFromStorage(storageKey);
    logger.info(`[Vendas] 🗑️ Temp storage removido: ${storageKey}`, { jobId: job.id });
  }
}
