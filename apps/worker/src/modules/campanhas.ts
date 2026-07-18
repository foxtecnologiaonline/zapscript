import { Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { decryptStr } from '../services/encryption';
import { sendTemplateMessage } from '../services/whatsapp-campaigns';
import { logger } from '../lib/logger';

/**
 * Processa um job de envio de campanha (fila 'campanhas', job.data: {campanhaId, contatoId}).
 *
 * Semântica de pausa/cancelamento: reconfere o status ao vivo antes de enviar — se a
 * campanha não estiver 'running' ou o contato não estiver 'pending' (já enviado, ou
 * optout via webhook), o job é ignorado sem alterar dados (ver routes/modules/campanhas.ts).
 *
 * Parâmetros do corpo do template vêm de CampanhaContato.variables (posicionais, colunas
 * 3+ do CSV) — Campanha.templateComponents guarda só componentes estáticos (header/botões)
 * iguais para todos os contatos.
 *
 * Em erro de envio (Meta API), o erro é propagado para o BullMQ decidir o retry (attempts/
 * backoff configurados na fila); a marcação definitiva de 'failed' só ocorre quando as
 * tentativas se esgotam, tratada pelo listener 'failed' do worker (ver index.ts) para evitar
 * ambiguidade sobre o número exato da tentativa dentro do próprio processor.
 */
export async function processCampanhaJob(job: Job): Promise<{ skipped?: boolean; reason?: string }> {
  const { campanhaId, contatoId } = job.data as { campanhaId: string; contatoId: string };

  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    include: { whatsappNumber: true },
  });
  if (!campanha) return { skipped: true, reason: 'campanha não encontrada' };
  if (campanha.status !== 'running') {
    return { skipped: true, reason: `campanha em status "${campanha.status}"` };
  }

  const contato = await prisma.campanhaContato.findUnique({ where: { id: contatoId } });
  if (!contato) return { skipped: true, reason: 'contato não encontrado' };
  if (contato.status !== 'pending') {
    return { skipped: true, reason: `contato já processado (status "${contato.status}")` };
  }

  const numero = campanha.whatsappNumber;
  if (!numero || numero.status !== 'connected' || !numero.metaAccessTokenEnc || !numero.metaPhoneNumberId) {
    await markContatoFailed(contatoId, 'Número Meta desconectado ou sem credenciais.');
    await maybeCompleteCampanha(campanhaId);
    return { skipped: true, reason: 'número desconectado' };
  }

  const token = decryptStr(numero.metaAccessTokenEnc);
  const staticComponents = (campanha.templateComponents as Array<Record<string, any>> | null) || [];
  const bodyVars = (contato.variables as string[] | null) || [];
  const components = bodyVars.length
    ? [...staticComponents, { type: 'body', parameters: bodyVars.map((v) => ({ type: 'text', text: String(v) })) }]
    : staticComponents;

  const wamid = await sendTemplateMessage(
    token, numero.metaPhoneNumberId, contato.phone,
    campanha.templateName, campanha.templateLanguage, components,
  );

  await prisma.$transaction([
    prisma.campanhaContato.update({
      where: { id: contatoId },
      data: { status: 'sent', wamid, sentAt: new Date(), errorMessage: null },
    }),
    prisma.campanha.update({ where: { id: campanhaId }, data: { sentCount: { increment: 1 } } }),
  ]);
  logger.info(`[Campanhas] ✅ Enviado ${contato.phone} (campanha ${campanhaId}) — wamid ${wamid}`);
  await maybeCompleteCampanha(campanhaId);
  return {};
}

/** Chamado pelo listener 'failed' do worker quando as tentativas de um job se esgotam. */
export async function markCampanhaJobExhausted(job: Job, err: Error): Promise<void> {
  const { campanhaId, contatoId } = (job.data || {}) as { campanhaId?: string; contatoId?: string };
  if (!campanhaId || !contatoId) return;

  // Idempotência: se o contato já saiu de 'pending' por outro caminho (ex: optout
  // recebido via webhook enquanto o envio estava em retry), não sobrescreve.
  const contato = await prisma.campanhaContato.findUnique({ where: { id: contatoId }, select: { status: true } });
  if (!contato || contato.status !== 'pending') return;

  await markContatoFailed(contatoId, err.message || 'Falha ao enviar via Meta API');
  await maybeCompleteCampanha(campanhaId);
}

async function markContatoFailed(contatoId: string, errorMessage: string): Promise<void> {
  await prisma.campanhaContato.update({
    where: { id: contatoId },
    data: { status: 'failed', errorMessage: errorMessage.slice(0, 500), failedAt: new Date() },
  });
}

/**
 * Marca a campanha como concluída quando não sobra nenhum contato 'pending'.
 * updateMany com filtro de status é atômico e idempotente — seguro mesmo se dois
 * jobs finalizarem quase simultaneamente (só um efetiva a transição de status).
 */
async function maybeCompleteCampanha(campanhaId: string): Promise<void> {
  const pending = await prisma.campanhaContato.count({ where: { campanhaId, status: 'pending' } });
  if (pending > 0) return;
  await prisma.campanha.updateMany({
    where: { id: campanhaId, status: 'running' },
    data: { status: 'completed', completedAt: new Date() },
  });
}
