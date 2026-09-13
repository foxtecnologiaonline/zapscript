import { Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { sendMessageViaEvolution } from '../services/evolution';
import { logger } from '../lib/logger';

/**
 * Processa um job de execução de missão (fila 'mktfast', job.data:
 * {missionId, executionId}). Ver MKTFAST_ESCOPO.md.
 *
 * Mesma semântica de pausa/cancelamento do módulo Campanhas: reconfere o
 * status ao vivo antes de agir — se a missão não estiver 'running' ou a
 * execução não estiver 'pending', o job é ignorado sem alterar dados.
 *
 * Canal novo = adicionar um `case` aqui (schema não muda — ver Mission no
 * schema.prisma). Fase 0 cobre só `channel==='whatsapp'`.
 */
export async function processMissionJob(job: Job): Promise<{ skipped?: boolean; reason?: string }> {
  const { missionId, executionId } = job.data as { missionId: string; executionId: string };

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { whatsappNumber: true } });
  if (!mission) return { skipped: true, reason: 'missão não encontrada' };
  if (mission.status !== 'running') {
    return { skipped: true, reason: `missão em status "${mission.status}"` };
  }

  const execution = await prisma.missionExecution.findUnique({ where: { id: executionId } });
  if (!execution) return { skipped: true, reason: 'execução não encontrada' };
  if (execution.status !== 'pending') {
    return { skipped: true, reason: `execução já processada (status "${execution.status}")` };
  }

  switch (execution.channel) {
    case 'whatsapp':
      await runWhatsappExecution(mission, execution);
      break;
    default:
      await markExecutionFailed(executionId, `Canal "${execution.channel}" sem adapter implementado`);
      break;
  }

  await maybeCompleteMission(missionId);
  return {};
}

async function runWhatsappExecution(
  mission: { id: string; content: unknown; whatsappNumber: { status: string; zapiInstanceId: string | null } | null },
  execution: { id: string; targetRef: string | null },
): Promise<void> {
  const numero = mission.whatsappNumber;
  if (!numero || numero.status !== 'connected' || !numero.zapiInstanceId) {
    await markExecutionFailed(execution.id, 'Número WhatsApp da missão desconectado ou não configurado.');
    return;
  }
  if (!execution.targetRef) {
    await markExecutionFailed(execution.id, 'Execução sem telefone-alvo (targetRef).');
    return;
  }

  const text = (mission.content as { text?: string } | null)?.text || '';
  const { id: wamid } = await sendMessageViaEvolution(numero.zapiInstanceId, execution.targetRef, text);

  await prisma.missionExecution.update({
    where: { id: execution.id },
    data: { status: 'sent', reachCount: 1, errorReason: null },
  });
  logger.info(`[MKT-Fast] ✅ Enviado ${execution.targetRef} (missão ${mission.id}) — id ${wamid}`);
}

async function markExecutionFailed(executionId: string, errorReason: string): Promise<void> {
  await prisma.missionExecution.update({
    where: { id: executionId },
    data: { status: 'failed', errorReason: errorReason.slice(0, 500) },
  });
  logger.warn(`[MKT-Fast] ❌ Execução ${executionId} falhou: ${errorReason}`);
}

/** Chamado pelo listener 'failed' do worker quando as tentativas de um job se esgotam. */
export async function markMissionJobExhausted(job: Job, err: Error): Promise<void> {
  const { missionId, executionId } = (job.data || {}) as { missionId?: string; executionId?: string };
  if (!missionId || !executionId) return;

  // Idempotência: se a execução já saiu de 'pending' por outro caminho, não sobrescreve.
  const execution = await prisma.missionExecution.findUnique({ where: { id: executionId }, select: { status: true } });
  if (!execution || execution.status !== 'pending') return;

  await markExecutionFailed(executionId, err.message || 'Falha ao processar execução da missão');
  await maybeCompleteMission(missionId);
}

/**
 * Completa a missão quando todas as execuções chegaram a um status terminal
 * (sent/posted/failed/approved/rejected) — volume baixo (ferramenta interna),
 * então uma contagem direta é suficiente, sem contador incremental dedicado.
 */
async function maybeCompleteMission(missionId: string): Promise<void> {
  const pending = await prisma.missionExecution.count({
    where: { missionId, status: { in: ['pending', 'proof_submitted'] } },
  });
  if (pending > 0) return;

  const completed = await prisma.mission.updateMany({
    where: { id: missionId, status: 'running' },
    data: { status: 'completed', completedAt: new Date() },
  });
  if (completed.count > 0) {
    logger.info(`[MKT-Fast] 🏁 Missão ${missionId} concluída.`);
  }
}
