/**
 * welcome.ts — Mensagem de boas-vindas automática do Atende.
 *
 * Dispara na 1ª mensagem do contato em cada dia civil (America/Sao_Paulo),
 * antes da resposta normal do agente. Guard de idempotência é um UPDATE
 * condicional atômico em AtendeConversation.lastWelcomeSentAt — nunca
 * check-then-act em duas queries — para cobrir duas mensagens quase
 * simultâneas do mesmo contato (2 webhooks em paralelo).
 */

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendMessageViaEvolution, sendPtt, sendVideo } from './evolution';

// evita rajada texto+áudio+vídeo ser lida como spam/automação pelo WhatsApp
const SEND_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Início do dia civil em America/Sao_Paulo, como instante UTC.
 * Brasil não tem mais horário de verão desde 2019 — o offset é fixo em
 * UTC-3, então meia-noite em SP é sempre 03:00 UTC. Nunca comparar `Date`
 * cru (o servidor Vultr provavelmente roda em UTC).
 */
function startOfTodaySaoPaulo(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"
  const [year, month, day] = parts.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
}

/**
 * Best-effort: nunca lança — falha aqui não pode derrubar o job do Atende.
 * Chamador decide se aguarda (ordem de entrega) ou dispara em paralelo.
 */
export async function maybeSendWelcome(
  conversationId: string,
  numberId: string,
  instanceName: string,
  senderPhone: string,
): Promise<void> {
  try {
    const welcomeConfig = await prisma.welcomeConfig.findUnique({ where: { numberId } });
    if (!welcomeConfig?.enabled) return;
    if (!welcomeConfig.text && !welcomeConfig.audioBytes && !welcomeConfig.videoBytes) return;

    // Guard atômico: só segue se este UPDATE afetou 1 linha — cobre a corrida
    // entre duas mensagens quase simultâneas do mesmo contato.
    const { count } = await prisma.atendeConversation.updateMany({
      where: {
        id: conversationId,
        OR: [{ lastWelcomeSentAt: null }, { lastWelcomeSentAt: { lt: startOfTodaySaoPaulo() } }],
      },
      data: { lastWelcomeSentAt: new Date() },
    });
    if (count === 0) return; // já recebeu boas-vindas hoje (ou outro job venceu a corrida)

    if (welcomeConfig.text) {
      await sendMessageViaEvolution(instanceName, senderPhone, welcomeConfig.text).catch((err: any) =>
        logger.warn(`[Atende→Boas-vindas] Falha ao enviar texto: ${err.message}`));
    }

    if (welcomeConfig.audioBytes) {
      await sleep(SEND_DELAY_MS);
      await sendPtt(instanceName, senderPhone, welcomeConfig.audioBytes.toString('base64')).catch((err: any) =>
        logger.warn(`[Atende→Boas-vindas] Falha ao enviar áudio: ${err.message}`));
    }

    if (welcomeConfig.videoBytes) {
      await sleep(SEND_DELAY_MS);
      await sendVideo(instanceName, senderPhone, welcomeConfig.videoBytes.toString('base64'), welcomeConfig.videoMime || 'video/mp4').catch((err: any) =>
        logger.warn(`[Atende→Boas-vindas] Falha ao enviar vídeo: ${err.message}`));
    }

    logger.info(`[Atende→Boas-vindas] ✅ Enviada para ${senderPhone} (número ${numberId})`);
  } catch (err: any) {
    logger.warn(`[Atende→Boas-vindas] Falha inesperada: ${err.message}`);
  }
}
