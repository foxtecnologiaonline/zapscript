import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { safeCompare } from '../lib/safeCompare';
import { checkAdminTotp } from '../lib/totp';
import {
  transcriptionQueue, campanhasQueue, mktfastQueue, atendeQueue,
  legendaQueue, copilotoQueue, zapscreveQueue, voiceCommandQueue,
} from '../services/queue';

/**
 * Dead-letter queue — inspeção e reprocessamento de jobs que esgotaram as
 * tentativas do BullMQ.
 *
 * O worker grava em FailedJob quando attempts >= maxAttempts (ver
 * apps/worker/src/lib/dlq.ts). Antes disso, um job esgotado ficava em
 * 'failed' no Redis e era apagado pelo removeOnFail em 7 dias, sem aviso e
 * sem replay — na fila 'transcriptions' isso é áudio de cliente que nunca
 * voltou.
 */

/** Nome da fila → produtor. Só estas podem ser reenfileiradas. */
const QUEUES = {
  'transcriptions':  transcriptionQueue,
  'campanhas':       campanhasQueue,
  'mktfast':         mktfastQueue,
  'atende-replies':  atendeQueue,
  'legendas':        legendaQueue,
  'copiloto':        copilotoQueue,
  'zapscreve':       zapscreveQueue,
  'voice-commands':  voiceCommandQueue,
} as const;

type QueueName = keyof typeof QUEUES;

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const totp = await checkAdminTotp(token!, req.headers['x-admin-totp'] as string | undefined);
  if (totp !== 'ok') {
    return reply.code(401).send({
      error: totp === 'totp_required' ? 'Código 2FA necessário' : 'Código 2FA inválido',
      totpRequired: true,
    });
  }
};

export default async function adminDlqRoutes(app: FastifyInstance) {

  // GET /?queue=transcriptions&pending=true&limit=50&offset=0
  app.get('/', { preHandler: [adminAuth] }, async (req: any) => {
    const queue   = typeof req.query.queue === 'string' ? req.query.queue : undefined;
    const pending = req.query.pending === 'true';   // só os que nunca foram replayados
    // Teto rígido: sem isto um ?limit=999999 viraria varredura da tabela.
    const limit   = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
    const offset  = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

    const where = {
      ...(queue ? { queue } : {}),
      ...(pending ? { replayedAt: null } : {}),
    };

    const [items, total, porFila] = await Promise.all([
      prisma.failedJob.findMany({
        where, orderBy: { failedAt: 'desc' }, take: limit, skip: offset,
      }),
      prisma.failedJob.count({ where }),
      prisma.failedJob.groupBy({ by: ['queue'], _count: { _all: true }, where: { replayedAt: null } }),
    ]);

    return {
      items, total, limit, offset,
      // Atenção ao ler: `items`/`total` respeitam os filtros da query, mas
      // `pendentesPorFila` é GLOBAL de propósito — serve para o admin ver de
      // onde vêm as falhas sem ter que consultar fila por fila.
      pendentesPorFila: Object.fromEntries(porFila.map(g => [g.queue, g._count._all])),
    };
  });

  // POST /:id/replay — reenfileira o job com o payload guardado
  app.post<{ Params: { id: string }; Body: { force?: boolean } }>('/:id/replay', { preHandler: [adminAuth] }, async (req, reply) => {
    const job = await prisma.failedJob.findUnique({ where: { id: req.params.id } });
    if (!job) return reply.code(404).send({ error: 'Job não encontrado.' });

    const queue = QUEUES[job.queue as QueueName];
    if (!queue) {
      return reply.code(400).send({ error: `Fila "${job.queue}" não é reenfileirável por esta rota.` });
    }

    // payloadTrimmed = o áudio/mídia bruta foi removida antes de gravar (ver
    // lib/dlq.ts). Para as filas de áudio isso é esperado e o replay funciona,
    // porque o worker rebaixa o conteúdo por referência (storageKey,
    // instanceName+messageId). Ainda assim é um reprocessamento que PODE não
    // reproduzir o original, então exige confirmação explícita.
    if (job.payloadTrimmed && req.body?.force !== true) {
      return reply.code(409).send({
        error: 'Payload foi truncado ao ser gravado (mídia removida). Reenvie com {"force":true} para tentar mesmo assim.',
        payloadTrimmed: true,
      });
    }

    // O incremento vem ANTES do add, e o jobId sai do valor devolvido por ele.
    // Lendo replayCount do findUnique acima, dois replays simultâneos (dois
    // admins, ou um duplo clique) calculariam o MESMO replayJobId: o BullMQ
    // ignora em silêncio o add repetido, os dois incrementariam mesmo assim, e
    // o admin veria replayCount 2 com um único job enfileirado — exatamente o
    // engano que o jobId novo deveria evitar. Com o increment atômico antes,
    // cada requisição recebe um número próprio e um jobId distinto.
    const updated = await prisma.failedJob.update({
      where: { id: job.id },
      data:  { replayedAt: new Date(), replayCount: { increment: 1 } },
    });
    const replayJobId = `replay-${job.id}-${updated.replayCount}`;

    try {
      await queue.add(job.jobName, job.payload as any, { jobId: replayJobId });
    } catch (err: any) {
      // Contagem já incrementada mas nada enfileirado. Preferimos o contador
      // adiantado a um "ok" mentiroso — o erro vai explícito para o admin.
      req.log.error({ failedJobId: job.id, queue: job.queue, err: err.message },
        '[DLQ] Falha ao reenfileirar job');
      return reply.code(502).send({ error: `Não foi possível reenfileirar na fila "${job.queue}": ${err.message}` });
    }

    req.log.warn({ failedJobId: job.id, queue: job.queue, replayJobId }, '[DLQ] Job reenfileirado manualmente');
    return { ok: true, replayJobId, replayCount: updated.replayCount };
  });

  // DELETE /:id — descarta um registro já resolvido/irrelevante
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const deleted = await prisma.failedJob.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return reply.code(404).send({ error: 'Job não encontrado.' });
    return { ok: true };
  });
}
