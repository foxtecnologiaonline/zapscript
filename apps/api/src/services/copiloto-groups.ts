import { prisma } from '../lib/prisma';

/**
 * Ingestão de mensagem de grupo pro Copiloto — Função 2 (resumo diário).
 * Chamado do webhook (evolution-webhook.ts) pra toda mensagem de grupo, texto,
 * de quem não é o dono. Só grava se o grupo tem opt-in ativo (CopilotoGroup);
 * fora isso, é no-op — grupo sem opt-in continua 100% fora do produto.
 *
 * Nunca lança: falha aqui não pode derrubar o processamento normal do webhook.
 * O resumo diário em si roda por polling em apps/worker/src/copiloto.ts, não
 * por job — grupo não tem debounce nem briefing por IA por mensagem.
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
    /* ingestão do Copiloto (grupo) nunca pode derrubar o webhook */
  }
}
