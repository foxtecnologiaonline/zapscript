import { Worker, Job } from 'bullmq';
import { redis } from './lib/queue';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';
import { runCopilotoContactAgent, runCopilotoGroupDigestAgent } from './services/copiloto-agent';

/**
 * Worker do ZapScript Copiloto — consome a fila 'copiloto' (produzida por
 * apps/api/src/services/copiloto-intake.ts) para a Função 1 (mensagens
 * individuais) e roda o polling da Função 2 (resumo diário de grupo), mesmo
 * padrão do digest de Tarefas/Atende. Registrado como side-effect: importado
 * por src/index.ts.
 *
 * Entrega das duas funções: sempre no chat "Mensagens para você mesmo" do
 * dono (sendMessageViaEvolution(instance, phoneNumber, ...) — nunca no
 * remoteJid de origem). O reply do usuário escolhendo uma opção é resolvido
 * do lado da API (evolution-webhook.ts + copiloto-commands.ts), não aqui.
 */

const ARCHETYPE_LABEL: Record<string, string> = { R: 'Resolve Agora', C: 'Constrói Relação', P: 'Protege' };

function formatOpcoesBlock(opcoes: { arquetipo: string; texto: string }[]): string {
  return opcoes
    .map((o, i) => `${i + 1} · ${ARCHETYPE_LABEL[o.arquetipo] ?? o.arquetipo} · "${o.texto}"`)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Função 1 — card de contato (fila 'copiloto', job 'contact-message')
// ─────────────────────────────────────────────────────────────────────────

interface ContactJobData {
  threadId: string;
}

async function processCopilotoContactJob(job: Job<ContactJobData>) {
  const { threadId } = job.data;

  const thread = await prisma.copilotoContactThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      number:   { select: { zapiInstanceId: true, phoneNumber: true, status: true } },
    },
  });
  if (!thread || thread.messages.length === 0) {
    return { skipped: true, reason: 'sem_mensagem_pendente' };
  }

  // Confirma entitlement ainda ativo — downgrade no meio da janela de debounce
  // não deve gerar (e cobrar) uma sugestão que o usuário não tem mais acesso.
  const hasCopiloto = await prisma.entitlement.findFirst({
    where: { userId: thread.userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
    select: { id: true },
  });
  if (!hasCopiloto) return { skipped: true, reason: 'sem_entitlement' };

  if (thread.number?.status !== 'connected' || !thread.number.zapiInstanceId || !thread.number.phoneNumber) {
    return { skipped: true, reason: 'numero_desconectado' };
  }

  let result;
  try {
    result = await runCopilotoContactAgent({
      userId:      thread.userId,
      contactName: thread.contactName || thread.contactPhone,
      messages:    thread.messages.map((m) => m.content),
    });
  } catch (err: any) {
    logger.error(`[Copiloto] ❌ Agente (contato) falhou: ${err.message}`);
    throw err; // deixa o BullMQ tentar de novo — não limpa o buffer nesse caso
  }

  const card = [
    `🧑 *${thread.contactName || thread.contactPhone}*`,
    result.resumo,
    '',
    formatOpcoesBlock(result.opcoes),
  ].join('\n');

  let waMessageId: string | null = null;
  try {
    const sent = await sendMessageViaEvolution(thread.number.zapiInstanceId, thread.number.phoneNumber, card);
    waMessageId = sent?.id ?? null;
  } catch (err: any) {
    logger.error(`[Copiloto] ❌ Falha ao entregar card (thread ${threadId}): ${err.message}`);
  }

  await prisma.copilotoSuggestion.create({
    data: {
      threadId,
      waMessageId,
      resumo: result.resumo,
      opcoes: result.opcoes as any,
    },
  });

  // Buffer processado — limpa e fecha a janela de debounce. Mensagens que
  // chegarem depois disso abrem uma pendência nova (novo pendingSince).
  await prisma.copilotoContactMessage.deleteMany({ where: { threadId } });
  await prisma.copilotoContactThread.update({
    where: { id: threadId },
    data:  { pendingSince: null, lastSuggestedAt: new Date() },
  });

  logger.info(`[Copiloto] ✅ Card entregue (thread ${threadId}, contato ${thread.contactPhone})`);
  return { threadId, delivered: !!waMessageId };
}

async function processCopilotoJob(job: Job) {
  if (job.name === 'contact-message') return processCopilotoContactJob(job as Job<ContactJobData>);
  logger.warn(`[Copiloto] Job de tipo desconhecido: ${job.name}`);
  return { skipped: true, reason: 'job_desconhecido' };
}

const COPILOTO_CONCURRENCY = parseInt(process.env.COPILOTO_WORKER_CONCURRENCY || '2', 10);

const copilotoWorker = new Worker('copiloto', processCopilotoJob, {
  connection: redis as any,
  concurrency: COPILOTO_CONCURRENCY,
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

copilotoWorker.on('completed', (job, result) => {
  if (result?.skipped) logger.warn(`[Copiloto] Job ${job.id} ignorado — motivo: ${result.reason}`);
});
copilotoWorker.on('failed', (job, err) => logger.error(`[Copiloto] ❌ Job ${job?.id} falhou: ${err.message}`));
copilotoWorker.on('error', (err) => logger.error('[Copiloto] Erro interno do worker', { err: err.message }));

logger.info('Worker Copiloto (mensagens individuais) iniciado');

// ─────────────────────────────────────────────────────────────────────────
// Função 2 — resumo diário de grupo (polling, mesmo padrão de Tarefas/Atende)
// ─────────────────────────────────────────────────────────────────────────

const GROUP_DIGEST_HOUR   = parseInt(process.env.COPILOTO_GROUP_DIGEST_HOUR || '20', 10); // hora local (Brasil) a partir da qual o digest pode sair
const GROUP_DIGEST_POLL_MS = 30 * 60 * 1000; // checa a cada 30 min — só dispara depois da hora configurada
const GROUP_TZ = 'America/Sao_Paulo';
const MAX_MESSAGES_PER_GROUP = 400; // teto de segurança de custo/contexto por grupo/dia

function todayLabel(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: GROUP_TZ }); // 'YYYY-MM-DD'
}

function localHourNow(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: GROUP_TZ, hour: '2-digit', hour12: false }), 10);
}

async function runCopilotoGroupDigests() {
  if (localHourNow() < GROUP_DIGEST_HOUR) return; // ainda não é hora — tenta de novo no próximo poll
  const date = todayLabel();

  try {
    const numbersWithGroups = await prisma.copilotoGroup.groupBy({
      by:    ['numberId'],
      where: { active: true },
    });

    for (const { numberId } of numbersWithGroups) {
      const already = await prisma.copilotoGroupDigest.findUnique({ where: { numberId_date: { numberId, date } } });
      if (already) continue;

      const number = await prisma.whatsappNumber.findUnique({
        where:  { id: numberId },
        select: { userId: true, zapiInstanceId: true, phoneNumber: true, status: true },
      });
      if (!number || number.status !== 'connected' || !number.zapiInstanceId || !number.phoneNumber) continue;

      const hasCopiloto = await prisma.entitlement.findFirst({
        where: { userId: number.userId, productKey: 'copiloto', status: { in: ['active', 'trialing'] } },
        select: { id: true },
      });
      if (!hasCopiloto) continue;

      const groups = await prisma.copilotoGroup.findMany({
        where: { numberId, active: true },
        include: {
          messages: {
            where:   { createdAt: { gte: new Date(`${date}T00:00:00-03:00`) } },
            orderBy: { createdAt: 'asc' },
            take:    MAX_MESSAGES_PER_GROUP,
          },
        },
      });
      if (groups.length === 0) continue;

      const totalMessages = groups.reduce((s, g) => s + g.messages.length, 0);
      if (totalMessages === 0) {
        // Marca o dia como processado mesmo sem envio — silêncio total não
        // gera mensagem nenhuma (nem digest vazio), mas evita reprocessar.
        await prisma.copilotoGroupDigest.create({
          data: { userId: number.userId, numberId, date, groupsIncluded: 0, summaryMd: '' },
        }).catch(() => null);
        continue;
      }

      let blocos: { grupo: string; resumo: string | null }[];
      try {
        const result = await runCopilotoGroupDigestAgent({
          userId: number.userId,
          groups: groups.map((g) => ({
            name:     g.name,
            messages: g.messages.map((m) => `${m.senderName || m.senderJid}: ${m.content}`),
          })),
        });
        blocos = result.blocos;
      } catch (err: any) {
        logger.error(`[Copiloto] ❌ Agente (digest de grupo) falhou — número ${numberId}: ${err.message}`);
        continue; // tenta de novo no próximo poll do mesmo dia
      }

      const relevantes = blocos.filter((b) => b.resumo && b.resumo.trim());
      if (relevantes.length === 0) {
        await prisma.copilotoGroupDigest.create({
          data: { userId: number.userId, numberId, date, groupsIncluded: groups.length, summaryMd: '' },
        }).catch(() => null);
        continue;
      }

      const summaryMd = relevantes.map((b) => `👥 *${b.grupo}*\n${b.resumo}`).join('\n\n');
      const msg = [`📋 *Resumo dos grupos — hoje*`, '', summaryMd].join('\n');

      await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, msg).catch((err: any) =>
        logger.error(`[Copiloto] ❌ Falha ao entregar digest de grupo (número ${numberId}): ${err.message}`));

      await prisma.copilotoGroupDigest.create({
        data: { userId: number.userId, numberId, date, groupsIncluded: relevantes.length, summaryMd },
      }).catch(() => null);

      logger.info(`[Copiloto] ✅ Digest de grupo enviado — número ${numberId} (${relevantes.length}/${groups.length} grupos com destaque)`);
    }
  } catch (err: any) {
    logger.error(`[Copiloto] Erro no digest diário de grupo: ${err.message}`);
  }
}

runCopilotoGroupDigests();
setInterval(runCopilotoGroupDigests, GROUP_DIGEST_POLL_MS);

export { copilotoWorker, runCopilotoGroupDigests };
