import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { sendMessageViaEvolution } from './services/evolution';

/**
 * Tarefas #2 — resumo diário de tarefas atrasadas por WhatsApp, mesmo padrão
 * do digest do Atende (self-chat pro dono, no número conectado do time).
 * Sem tabela de estado dedicada: roda 1x na subida do worker e depois a cada
 * 24h — suficiente pro caso de uso (aviso não-crítico) e evita mais uma
 * tabela só pra guardar "já mandei hoje".
 */

const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runTarefasOverdueDigest() {
  const now = new Date();
  const APP_URL = process.env.APP_URL || 'https://zapscript.me';

  try {
    // Só donos de time com o módulo tarefas ativo E ao menos 1 tarefa
    // atrasada — sem alarme falso pra quem está com o quadro em dia.
    const owners = await prisma.entitlement.findMany({
      where:  { productKey: 'tarefas', status: { in: ['active', 'trialing'] } },
      select: { userId: true },
    });

    for (const { userId: ownerId } of owners) {
      const overdue = await prisma.task.count({
        where: { userId: ownerId, status: 'pending', dueAt: { lt: now } },
      });
      if (overdue === 0) continue;

      const number = await prisma.whatsappNumber.findFirst({
        where:  { userId: ownerId, status: 'connected', zapiInstanceId: { not: null } },
        select: { zapiInstanceId: true, phoneNumber: true },
      });
      if (!number?.zapiInstanceId || !number.phoneNumber) continue;

      const msg = [
        '✅ *Tarefas* — resumo do dia',
        '',
        `Você tem *${overdue}* tarefa(s) atrasada(s).`,
        '',
        `Painel: ${APP_URL}/app/tarefas`,
      ].join('\n');

      await sendMessageViaEvolution(number.zapiInstanceId, number.phoneNumber, msg).catch(() => null);
      logger.info(`[Tarefas] 📊 Digest de atraso enviado — owner ${ownerId} (${overdue} atrasadas)`);
    }
  } catch (err: any) {
    logger.error(`[Tarefas] Erro no digest de atrasadas: ${err.message}`);
  }
}

runTarefasOverdueDigest();
setInterval(runTarefasOverdueDigest, DIGEST_INTERVAL_MS);

export { runTarefasOverdueDigest };
