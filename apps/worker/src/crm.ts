import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';

/**
 * CRM #5 — lembretes vencidos (CrmActivity type='reminder') não empurravam
 * nada: o dono só descobria abrindo o painel. Cron periódico avisa via
 * WhatsApp no mesmo número conectado do dono (self-chat, mesmo padrão do
 * digest do Atende e do resumo diário de Cobrança). Idempotente via
 * CrmActivity.notifiedAt — só marca como notificado depois do envio ter
 * sucesso, pra reprocessar automaticamente em caso de falha temporária.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function notifyOwner(ownerId: string, message: string): Promise<boolean> {
  const number = await prisma.whatsappNumber.findFirst({
    where:  { userId: ownerId, status: 'connected', zapiInstanceId: { not: null } },
    select: { zapiInstanceId: true, phoneNumber: true },
  });
  if (!number?.zapiInstanceId || !number.phoneNumber) return false;

  await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, message);
  return true;
}

async function runCrmReminderNotifications() {
  const now = new Date();
  try {
    const overdue = await prisma.crmActivity.findMany({
      where:   { type: 'reminder', completedAt: null, notifiedAt: null, dueAt: { lte: now } },
      include: { contact: { select: { name: true, phone: true } } },
      take:    200,
    });

    for (const reminder of overdue) {
      try {
        const msg = [
          '⏰ *CRM* — lembrete vencido',
          '',
          `${reminder.contact.name} (${reminder.contact.phone})`,
          reminder.content,
        ].join('\n');

        const sent = await notifyOwner(reminder.userId, msg);
        if (sent) {
          await prisma.crmActivity.update({ where: { id: reminder.id }, data: { notifiedAt: now } });
          logger.info(`[CRM] ⏰ Lembrete ${reminder.id} notificado`);
        }
      } catch (err: any) {
        logger.warn(`[CRM] Falha ao notificar lembrete ${reminder.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[CRM] Erro no cron de lembretes: ${err.message}`);
  }
}

runCrmReminderNotifications();
setInterval(runCrmReminderNotifications, CHECK_INTERVAL_MS);

export { runCrmReminderNotifications };
