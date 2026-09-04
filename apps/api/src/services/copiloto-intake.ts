import { prisma } from '../lib/prisma';
import { copilotoQueue } from './queue';

/**
 * Ingestão do módulo Copiloto — chamado a partir do webhook da Evolution
 * (evolution-webhook.ts) pra cada mensagem que pode alimentar uma das duas
 * funções. Nunca lança: falha aqui não pode derrubar o processamento normal
 * da mensagem (Atende, Cobrança, etc.), que segue seu fluxo de qualquer jeito.
 *
 * Função 1 (individual): agrupa mensagens do contato num "lote" (thread) e
 * agenda/reagenda um job de resumo com debounce — a cada mensagem nova do
 * mesmo contato, o job anterior (se ainda não rodou) é substituído por um
 * novo, empurrando o prazo pra frente. O job em si relê o banco na hora de
 * rodar (não carrega as mensagens no payload), então uma corrida entre
 * remove+add nunca perde mensagem — só no pior caso dispara um pouco cedo.
 *
 * Função 2 (grupo): só grava a mensagem bruta (retenção curta) — o resumo
 * diário roda via polling em apps/worker/src/copiloto.ts, não por job.
 */

const CONTACT_DEBOUNCE_MS = parseInt(process.env.COPILOTO_CONTACT_DEBOUNCE_MS || '', 10) || 5 * 60 * 1000; // 5 min

function contactJobId(threadId: string): string {
  return `copiloto-contact-${threadId}`;
}

/**
 * Função 1 — chamado pra mensagem de texto de um contato (!fromMe) quando o
 * chamador já confirmou que o número tem o módulo Copiloto e que o Atende
 * não é dono dessa conversa agora (desligado, ou humanTakeover=true).
 */
export async function ingestCopilotoContactMessage(params: {
  userId: string;
  numberId: string;
  contactPhone: string;
  contactName?: string | null;
  messageText: string;
}): Promise<void> {
  try {
    const { userId, numberId, contactPhone, contactName, messageText } = params;

    const thread = await prisma.copilotoContactThread.upsert({
      where:  { numberId_contactPhone: { numberId, contactPhone } },
      update: { contactName: contactName || undefined },
      create: { userId, numberId, contactPhone, contactName: contactName || null },
    });

    // pendingSince só é setado se ainda não havia pendência — preserva o
    // início real da janela de silêncio mesmo com várias mensagens seguidas.
    if (!thread.pendingSince) {
      await prisma.copilotoContactThread.update({
        where: { id: thread.id },
        data:  { pendingSince: new Date() },
      });
    }

    await prisma.copilotoContactMessage.create({
      data: { threadId: thread.id, content: messageText },
    });

    const jobId = contactJobId(thread.id);
    await copilotoQueue.remove(jobId).catch(() => null); // no-op se já rodando/ausente
    await copilotoQueue.add(
      'contact-message',
      { threadId: thread.id },
      { jobId, delay: CONTACT_DEBOUNCE_MS },
    ).catch(() => null); // best-effort — pior caso, próxima mensagem tenta de novo
  } catch {
    /* ingestão do Copiloto nunca pode derrubar o webhook */
  }
}

/**
 * Função 2 — chamado pra mensagem (texto) de grupo. Só grava se o grupo tem
 * opt-in ativo; silenciosamente ignora caso contrário (grupo sem opt-in não
 * deveria nem chegar aqui, mas o check fica aqui também por segurança).
 */
export async function ingestCopilotoGroupMessage(params: {
  numberId: string;
  groupJid: string;
  senderJid: string;
  senderName?: string | null;
  content: string;
}): Promise<void> {
  try {
    const { numberId, groupJid, senderJid, senderName, content } = params;
    const group = await prisma.copilotoGroup.findUnique({
      where: { numberId_groupJid: { numberId, groupJid } },
    });
    if (!group?.active) return;

    await prisma.copilotoGroupMessage.create({
      data: { groupId: group.id, senderJid, senderName: senderName || null, content },
    });
  } catch {
    /* idem — nunca derruba o webhook */
  }
}
