/**
 * copiloto-actions.ts
 *
 * Único ponto de envio ao CLIENTE no Copiloto — extraído do antigo fluxo de
 * self-chat (`dispatch`, dentro do handleCopilotoChoice que existia em
 * copiloto-commands.ts) pra ser reaproveitado pela rota do painel web
 * (POST /copiloto/suggestions/:id/send, ver routes/copiloto.ts). v3.0 —
 * ESCOPO_COPILOTO.md §15: o Copiloto virou sob demanda, o painel é quem
 * decide enviar, não mais uma resposta "1/2/3" no self-chat.
 */

import { prisma } from '../lib/prisma';
import { sendText } from './evolution';

export type SendCopilotoSuggestionResult =
  | { ok: true; sentTo: string; taskId: string | null; commitmentTitle: string | null; commitmentDueAt: Date | null }
  | { ok: false; status: number; error: string };

/**
 * Envia a sugestão (rascunho original ou texto editado pelo dono) ao contato
 * da conversa, e registra tudo: sugestão como 'sent'/'edited', briefing como
 * 'acted', a mensagem no histórico (pra entrar no próximo briefing) e — se a
 * opção embutia um compromisso — a Task automática.
 */
export async function sendCopilotoSuggestion(params: {
  userId: string;
  suggestionId: string;
  /** Texto final a enviar. Omitido = usa o rascunho original (draft) sem edição. */
  finalText?: string;
}): Promise<SendCopilotoSuggestionResult> {
  const suggestion = await prisma.copilotoSuggestion.findFirst({
    where: { id: params.suggestionId, briefing: { userId: params.userId } },
    include: {
      briefing: {
        include: { conversation: { select: { id: true, contactPhone: true, contactName: true } } },
      },
    },
  });
  if (!suggestion) return { ok: false, status: 404, error: 'Sugestão não encontrada' };
  if (suggestion.status !== 'offered') {
    return { ok: false, status: 409, error: `Esta sugestão já está com status "${suggestion.status}" — não pode ser enviada de novo.` };
  }

  const { briefing } = suggestion;
  const number = await prisma.whatsappNumber.findUnique({
    where: { id: briefing.numberId },
    select: { zapiInstanceId: true, status: true },
  });
  if (!number?.zapiInstanceId || number.status !== 'connected') {
    return { ok: false, status: 409, error: 'Número precisa estar conectado para enviar.' };
  }

  const finalText = params.finalText?.trim() || suggestion.draft;
  const edited = finalText !== suggestion.draft;
  const who = briefing.conversation.contactName || briefing.conversation.contactPhone;

  const sent = await sendText(number.zapiInstanceId, briefing.conversation.contactPhone, finalText);

  // Compromisso embutido na opção (ex.: "te confirmo até as 17h") vira Task
  // automaticamente — reaproveita o módulo Tarefas já existente em vez de
  // inventar uma agenda própria. Best-effort: falha aqui não pode travar o
  // envio, que já aconteceu.
  let taskId: string | null = null;
  if (suggestion.commitmentTitle) {
    try {
      const task = await prisma.task.create({
        data: { userId: params.userId, title: suggestion.commitmentTitle, dueAt: suggestion.commitmentDueAt },
      });
      taskId = task.id;
    } catch {
      // não interrompe o fluxo — o envio já aconteceu, a Task é conveniência
    }
  }

  await prisma.copilotoSuggestion.update({
    where: { id: suggestion.id },
    data: { status: edited ? 'edited' : 'sent', sentText: finalText, sentMessageId: sent.id, sentAt: new Date(), taskId },
  });
  await prisma.copilotoBriefing.update({
    where: { id: briefing.id },
    data: { status: 'acted', actedAt: new Date() },
  });
  await prisma.copilotoMessage.create({
    data: { conversationId: briefing.conversation.id, direction: 'out', content: finalText, fromCopiloto: true },
  });

  return {
    ok: true,
    sentTo: who,
    taskId,
    commitmentTitle: suggestion.commitmentTitle,
    commitmentDueAt: suggestion.commitmentDueAt,
  };
}

/** Descarta o briefing inteiro (equivalente ao antigo "0" no self-chat). */
export async function dismissCopilotoBriefing(params: {
  userId: string;
  briefingId: string;
  /** true = dono confirmou que isso não devia ter virado card (alimenta triagem). */
  noise?: boolean;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const briefing = await prisma.copilotoBriefing.findFirst({
    where: { id: params.briefingId, userId: params.userId },
    select: { id: true },
  });
  if (!briefing) return { ok: false, status: 404, error: 'Briefing não encontrado' };

  await prisma.copilotoBriefing.update({
    where: { id: briefing.id },
    data: { status: 'dismissed', dismissReason: params.noise ? 'ruido' : null },
  });
  return { ok: true };
}
