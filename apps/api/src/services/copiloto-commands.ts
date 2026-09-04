import { prisma } from '../lib/prisma';
import { sendText } from './evolution';

/**
 * Resolução da escolha do usuário num card do Copiloto (Função 1) — chamado
 * do webhook quando uma mensagem fromMe chega no chat "Mensagens para você
 * mesmo". Ver escopo de produto, seção "Virar compromisso": o usuário dá
 * reply na mensagem do card com o número da opção (1, 2 ou 3); o stanzaId
 * citado aponta pra qual CopilotoSuggestion a resposta vale. Sem reply (só
 * o dígito solto), cai no fallback best-effort: sugestão pendente mais
 * recente do número, dentro de uma janela curta — evita confundir um "2"
 * qualquer, digitado por outro motivo, com uma escolha de card antiga.
 */

const OPTION_RE = /^\s*([123])\s*$/;
const FALLBACK_WINDOW_MS = 30 * 60 * 1000; // 30 min

export interface CopilotoOpcao {
  arquetipo: 'R' | 'C' | 'P';
  texto: string;
  compromisso: { titulo: string; prazo: string } | null; // prazo = ISO string
}

/**
 * Tenta interpretar `messageText` como escolha de uma sugestão pendente.
 * Retorna true se tratou a mensagem (o chamador deve parar de processá-la
 * como nota pessoal comum); false se não é uma resposta reconhecível.
 */
export async function handleCopilotoReply(params: {
  instanceName: string;
  selfPhone: string;
  numberId: string;
  messageText: string;
  stanzaId?: string | null;
}): Promise<boolean> {
  const { instanceName, selfPhone, numberId, messageText, stanzaId } = params;

  const match = OPTION_RE.exec(messageText);
  if (!match) return false; // não parece resposta a card nenhum — segue fluxo normal
  const optionIndex = parseInt(match[1], 10) - 1;

  try {
    let suggestion = stanzaId
      ? await prisma.copilotoSuggestion.findFirst({
          where: { waMessageId: stanzaId, chosenOption: null, thread: { numberId } },
          include: { thread: true },
        })
      : null;

    // Fallback: sem reply (ou reply que não bateu com nada), tenta a sugestão
    // pendente mais recente desse número dentro da janela — só faz sentido
    // porque "1/2/3 soltos" já é raro fora desse contexto.
    if (!suggestion) {
      suggestion = await prisma.copilotoSuggestion.findFirst({
        where: {
          chosenOption: null,
          createdAt: { gte: new Date(Date.now() - FALLBACK_WINDOW_MS) },
          thread: { numberId },
        },
        orderBy: { createdAt: 'desc' },
        include: { thread: true },
      });
    }

    if (!suggestion) return false; // nada pendente pra responder — deixa seguir como nota comum

    const opcoes = Array.isArray(suggestion.opcoes) ? (suggestion.opcoes as unknown as CopilotoOpcao[]) : [];
    const escolhida = opcoes[optionIndex];
    if (!escolhida) return false;

    let taskId: string | null = null;
    if (escolhida.compromisso?.titulo) {
      const dueAt = escolhida.compromisso.prazo ? new Date(escolhida.compromisso.prazo) : null;
      const task = await prisma.task.create({
        data: {
          userId: suggestion.thread.userId,
          title:  escolhida.compromisso.titulo,
          dueAt:  dueAt && !isNaN(dueAt.getTime()) ? dueAt : null,
        },
      });
      taskId = task.id;
    }

    await prisma.copilotoSuggestion.update({
      where: { id: suggestion.id },
      data:  { chosenOption: optionIndex, taskId, respondedAt: new Date() },
    });

    const confirm = taskId
      ? `✅ Compromisso criado: ${escolhida.compromisso!.titulo}${escolhida.compromisso!.prazo ? ` — ${new Date(escolhida.compromisso!.prazo).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}.`
      : '✅ Opção registrada.';
    await sendText(instanceName, selfPhone, confirm).catch(() => null);
    return true;
  } catch {
    return false; // erro ao resolver: melhor deixar a mensagem seguir o fluxo normal do que travar o webhook
  }
}
