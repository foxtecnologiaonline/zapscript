import { Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { decryptStr } from '../services/encryption';
import { sendTemplateMessage } from '../services/whatsapp-campaigns';
import { sendMessageViaEvolution } from '../services/evolution';
import { sendEmail } from '../services/mailer';
import { logger } from '../lib/logger';

const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CAMPANHAS_CIRCUIT_BREAKER_THRESHOLD || '5', 10);

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Substitui {{nome}} pelo nome do contato (ou o telefone, na falta de nome). Só isso —
 *  canal evolution não tem CSV/variáveis posicionais, é sempre mensagem+audiência derivada
 *  de conversas existentes (ver routes/modules/campanhas.ts, warmContactsForNumber). */
function renderEvolutionMessage(body: string, contato: { phone: string; name: string | null }): string {
  return body.replace(/\{\{\s*nome\s*\}\}/gi, contato.name || contato.phone);
}

/**
 * Processa um job de envio de campanha (fila 'campanhas', job.data: {campanhaId, contatoId}).
 *
 * Semântica de pausa/cancelamento: reconfere o status ao vivo antes de enviar — se a
 * campanha não estiver 'running' ou o contato não estiver 'pending' (já enviado, ou
 * optout via webhook), o job é ignorado sem alterar dados (ver routes/modules/campanhas.ts).
 *
 * Dois canais (Campanha.channel):
 * - 'meta': API oficial, template pré-aprovado. Parâmetros vêm de CampanhaContato.variables
 *   (posicionais, colunas 3+ do CSV) — Campanha.templateComponents guarda só componentes
 *   estáticos (header/botões) iguais para todos os contatos.
 * - 'evolution': número Evolution do próprio usuário, mensagem livre (Campanha.messageBody,
 *   com {{nome}}). Ritmo de envio já vem espaçado do enqueue (delay+jitter — ver
 *   evolutionSendDelayMs em routes/modules/campanhas.ts), então aqui é só enviar; não há
 *   contador de limite diário vivo porque o espaçamento já foi calculado pra respeitá-lo.
 *
 * Número de envio: CampanhaContato.assignedNumberId (setado no /start — ver §11 "pool de
 * números") escolhe de qual número este contato específico sai; por padrão (sem pool) é
 * sempre o número primário da campanha, então não custa query extra no caso comum.
 *
 * Em erro de envio, o erro é propagado para o BullMQ decidir o retry (attempts/backoff
 * configurados na fila); a marcação definitiva de 'failed' só ocorre quando as tentativas
 * se esgotam, tratada pelo listener 'failed' do worker (ver index.ts) para evitar
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

  const numero = (contato.assignedNumberId && contato.assignedNumberId !== campanha.whatsappNumberId)
    ? await prisma.whatsappNumber.findUnique({ where: { id: contato.assignedNumberId } })
    : campanha.whatsappNumber;

  let messageId: string | null;
  if (campanha.channel === 'evolution') {
    if (!numero || numero.status !== 'connected' || !numero.zapiInstanceId) {
      await markContatoFailed(contatoId, 'Número Evolution desconectado.');
      await bumpProcessedAndMaybeComplete(campanhaId, { resetFailures: false });
      return { skipped: true, reason: 'número desconectado' };
    }
    const texto = renderEvolutionMessage(campanha.messageBody || '', contato);
    const res = await sendMessageViaEvolution(numero.zapiInstanceId, contato.phone, texto);
    messageId = res.id;
  } else {
    if (!numero || numero.status !== 'connected' || !numero.metaAccessTokenEnc || !numero.metaPhoneNumberId) {
      await markContatoFailed(contatoId, 'Número Meta desconectado ou sem credenciais.');
      await bumpProcessedAndMaybeComplete(campanhaId, { resetFailures: false });
      return { skipped: true, reason: 'número desconectado' };
    }
    const token = decryptStr(numero.metaAccessTokenEnc);
    const staticComponents = (campanha.templateComponents as Array<Record<string, any>> | null) || [];
    const bodyVars = (contato.variables as string[] | null) || [];
    const components = bodyVars.length
      ? [...staticComponents, { type: 'body', parameters: bodyVars.map((v) => ({ type: 'text', text: String(v) })) }]
      : staticComponents;
    messageId = await sendTemplateMessage(
      token, numero.metaPhoneNumberId, contato.phone,
      campanha.templateName!, campanha.templateLanguage, components,
    );
  }

  await prisma.campanhaContato.update({
    where: { id: contatoId },
    data: { status: 'sent', wamid: messageId, sentAt: new Date(), errorMessage: null },
  });
  logger.info(`[Campanhas] ✅ Enviado ${contato.phone} (campanha ${campanhaId}, canal ${campanha.channel}) — id ${messageId}`);
  // sentCount separado do processedCount: sentCount é "quantos deram certo" (métrica visível
  // pro usuário), processedCount é "quantos já passaram por aqui" (sent+failed+optout, usado
  // só pra saber se a campanha terminou — ver bumpProcessedAndMaybeComplete).
  await prisma.campanha.update({ where: { id: campanhaId }, data: { sentCount: { increment: 1 } } });
  await bumpProcessedAndMaybeComplete(campanhaId, { resetFailures: true });
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

  await markContatoFailed(contatoId, err.message || 'Falha ao enviar mensagem da campanha');
  await bumpProcessedAndMaybeComplete(campanhaId, { resetFailures: false });
}

async function markContatoFailed(contatoId: string, errorMessage: string): Promise<void> {
  await prisma.campanhaContato.update({
    where: { id: contatoId },
    data: { status: 'failed', errorMessage: errorMessage.slice(0, 500), failedAt: new Date() },
  });
}

/**
 * Ponto único, chamado após CADA contato processado (sucesso ou falha definitiva),
 * que: (1) incrementa processedCount — substitui o antigo COUNT(*) a cada contato por
 * uma comparação de contadores já em mãos (ver CAMPANHAS_ARQUITETURA.md §11/item 9);
 * (2) zera ou incrementa consecutiveFailures — N falhas seguidas aciona a auto-pausa
 * (circuit breaker, item 1); (3) completa a campanha quando processedCount alcança
 * audienceCount. updateMany com filtro de status é atômico e idempotente — seguro
 * mesmo se dois jobs terminarem quase simultaneamente (só um efetiva a transição).
 *
 * IMPORTANTE: opt-out via webhook (registerCampanhaOptOut, apps/api) também precisa
 * incrementar processedCount pros seus contatos — senão uma campanha com muitos
 * opt-outs nunca bateria audienceCount e ficaria "running" pra sempre. Ver ali.
 */
async function bumpProcessedAndMaybeComplete(campanhaId: string, opts: { resetFailures: boolean }): Promise<void> {
  const updated = await prisma.campanha.update({
    where: { id: campanhaId },
    data: {
      processedCount: { increment: 1 },
      consecutiveFailures: opts.resetFailures ? 0 : { increment: 1 },
    },
    select: { processedCount: true, audienceCount: true, consecutiveFailures: true, status: true },
  });

  if (!opts.resetFailures && updated.status === 'running' && updated.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    const paused = await prisma.campanha.updateMany({
      where: { id: campanhaId, status: 'running' },
      data: {
        status: 'paused',
        pausedReason: `Pausada automaticamente após ${CIRCUIT_BREAKER_THRESHOLD} falhas de envio seguidas — verifique a conexão do número antes de retomar.`,
      },
    });
    if (paused.count > 0) {
      logger.warn(`[Campanhas] ⛔ Campanha ${campanhaId} auto-pausada após ${CIRCUIT_BREAKER_THRESHOLD} falhas seguidas.`);
      notifyCampanhaAutoPaused(campanhaId).catch((e: any) => logger.warn(`[Campanhas] Falha ao notificar auto-pausa: ${e.message}`));
    }
    return; // pausada — ainda tem pendente, não é conclusão
  }

  if (updated.processedCount < updated.audienceCount) return;
  const completed = await prisma.campanha.updateMany({
    where: { id: campanhaId, status: 'running' },
    data: { status: 'completed', completedAt: new Date() },
  });
  if (completed.count > 0) {
    notifyCampanhaCompleted(campanhaId).catch((e: any) => logger.warn(`[Campanhas] Falha ao notificar conclusão: ${e.message}`));
  }
}

/** E-mail de conclusão — fire-and-forget, nunca bloqueia nem falha o processamento do job. */
async function notifyCampanhaCompleted(campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!campanha?.user?.email) return;

  const grouped = await prisma.campanhaContato.groupBy({ by: ['status'], where: { campanhaId }, _count: true });
  const byStatus: Record<string, number> = {};
  for (const g of grouped) byStatus[g.status] = g._count;

  const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
  const firstName = escHtml(campanha.user.name?.split(' ')[0] || 'tudo bem');
  const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
    <div style="font-size:22px;font-weight:bold;margin-bottom:16px">📣 Campanha concluída: ${escHtml(campanha.name)}</div>
    <div style="font-size:14px;line-height:1.9;color:#a7f3d0">
      Olá, ${firstName}!<br><br>
      ✅ Enviados: <strong>${campanha.sentCount}</strong><br>
      📬 Entregues: <strong>${byStatus.delivered || 0}</strong><br>
      👀 Lidos: <strong>${byStatus.read || 0}</strong><br>
      ❌ Falharam: <strong>${byStatus.failed || 0}</strong><br>
      🚫 Opt-out: <strong>${byStatus.optout || 0}</strong>
    </div>
    <div style="margin:24px 0;text-align:center">
      <a href="${APP_URL}/dashboard/campanhas/${campanhaId}" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver resultado completo →</a>
    </div>
    <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
  </div>`;
  await sendEmail(campanha.user.email, `📣 Campanha "${campanha.name}" concluída`, html);
}

/** E-mail de auto-pausa (circuit breaker) — mesma filosofia fire-and-forget. */
async function notifyCampanhaAutoPaused(campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!campanha?.user?.email) return;

  const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
  const firstName = escHtml(campanha.user.name?.split(' ')[0] || 'tudo bem');
  const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
    <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚠️ Campanha pausada automaticamente</div>
    <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
      Olá, ${firstName}!<br><br>
      Sua campanha <strong>"${escHtml(campanha.name)}"</strong> teve várias falhas de envio seguidas e foi
      <strong>pausada automaticamente</strong> pra evitar desperdiçar o restante da lista. Confira a conexão
      do número antes de retomar.
    </div>
    <div style="margin:24px 0;text-align:center">
      <a href="${APP_URL}/dashboard/campanhas/${campanhaId}" style="background:#f59e0b;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver campanha →</a>
    </div>
    <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
  </div>`;
  await sendEmail(campanha.user.email, `⚠️ Campanha "${campanha.name}" pausada automaticamente`, html);
}
