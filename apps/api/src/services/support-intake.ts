import { prisma } from '../lib/prisma';
import { runSupportAgent, Canal } from './support-agent';
import { sendOnChannel, sendWelcome, notifyAdminEscalation } from './support-send';
import { io } from '../index';

/**
 * Ingestão de uma mensagem recebida (qualquer canal) → cria SupportAtendimento,
 * roda o agente e decide automaticamente:
 *   - confiança alta e sem escalação → BOT RESPONDE SOZINHO (status "sent")
 *   - escalação/baixa confiança      → fica pendente + avisa o admin no WhatsApp
 * A fila de aprovação no painel continua existindo como rede de segurança
 * (edição manual, reenvio, métricas) — mas não é mais o único caminho de envio.
 */
export interface IntakeInput {
  canal: Canal;
  mensagem: string;
  clienteNome?: string | null;
  clienteEmail?: string | null;
  clienteWhatsapp?: string | null;
  canalExternoId?: string | null; // messageId externo (dedupe)
  threadId?: string | null;
}

// Histórico recente da mesma thread (últimas mensagens) para dar contexto ao agente.
async function buildHistorico(threadId: string | null | undefined, excludeId: string): Promise<string | null> {
  if (!threadId) return null;
  const prev = await prisma.supportAtendimento.findMany({
    where: { threadId, id: { not: excludeId } },
    orderBy: { criadoEm: 'desc' },
    take: 5,
    select: { mensagemOriginal: true, respostaFinal: true },
  }).catch(() => [] as any[]);
  if (!prev.length) return null;
  return prev.reverse().map((p: any) =>
    `Cliente: ${p.mensagemOriginal}${p.respostaFinal ? `\nSuporte: ${p.respostaFinal}` : ''}`
  ).join('\n');
}

export async function intakeMessage(input: IntakeInput, log?: any) {
  // Dedupe por messageId externo
  if (input.canalExternoId) {
    const existing = await prisma.supportAtendimento.findFirst({
      where: { canalExternoId: input.canalExternoId, canal: input.canal },
      select: { id: true },
    }).catch(() => null);
    if (existing) {
      log?.info?.(`[Suporte] Mensagem ${input.canalExternoId} já processada — ignorada`);
      return existing;
    }
  }

  // Vincular usuário existente por whatsapp/email (LGPD: isolamento por usuário)
  let clienteUserId: string | null = null;
  if (input.clienteWhatsapp) {
    const digits = input.clienteWhatsapp.replace(/\D/g, '');
    const u = await prisma.user.findFirst({
      where: { phone: { contains: digits.slice(-8) } },
      select: { id: true, name: true },
    }).catch(() => null);
    if (u) clienteUserId = u.id;
  }
  if (!clienteUserId && input.clienteEmail) {
    const u = await prisma.user.findUnique({
      where: { email: input.clienteEmail.toLowerCase() },
      select: { id: true },
    }).catch(() => null);
    if (u) clienteUserId = u.id;
  }

  // É a primeira mensagem desta conversa? (define se manda a saudação inicial)
  const isFirstInThread = input.threadId
    ? !(await prisma.supportAtendimento.findFirst({
        where: { threadId: input.threadId },
        select: { id: true },
      }).catch(() => null))
    : true;

  // Cria o atendimento em estado de processamento
  const atendimento = await prisma.supportAtendimento.create({
    data: {
      canal: input.canal,
      status: 'pending_approval',
      clienteNome: input.clienteNome ?? null,
      clienteEmail: input.clienteEmail ?? null,
      clienteWhatsapp: input.clienteWhatsapp ?? null,
      clienteUserId,
      mensagemOriginal: input.mensagem,
      threadId: input.threadId ?? null,
      canalExternoId: input.canalExternoId ?? null,
    },
  });

  // Mensagem inicial (saudação) — só na primeira mensagem da conversa, best-effort.
  if (isFirstInThread) {
    sendWelcome(atendimento).catch(() => null);
  }

  // Roda o agente (classifica + gera rascunho)
  try {
    const historico = await buildHistorico(input.threadId, atendimento.id);
    const result = await runSupportAgent({
      message: input.mensagem,
      clienteNome: input.clienteNome,
      historico,
    });

    const c = result.classificacao;
    const isSpam = c.categoria === 'spam';
    // Auto-resolve: confiança alta e sem escalação → o bot responde sozinho.
    // Casos sensíveis (cancelamento/cobrança/reclamação grave/baixa confiança) ficam
    // pendentes na fila + avisam o admin — nunca são respondidos automaticamente.
    const autoResolve = !isSpam && !c.requer_escalacao;

    let atualizado = await prisma.supportAtendimento.update({
      where: { id: atendimento.id },
      data: {
        categoria: c.categoria,
        prioridade: c.prioridade,
        sentimento: c.sentimento,
        confiancaResposta: c.confianca_resposta,
        requerEscalacao: c.requer_escalacao,
        topicos: c.topicos_identificados,
        rascunhoAgente: result.rascunho,
        contextoUsado: result.contextoUsado,
        sugestaoFaq: c.sugestao_faq,
        status: isSpam ? 'spam' : 'pending_approval',
      },
    });

    if (autoResolve) {
      try {
        await sendOnChannel(atualizado, result.rascunho);
        const now = new Date();
        atualizado = await prisma.supportAtendimento.update({
          where: { id: atendimento.id },
          data: { respostaFinal: result.rascunho, status: 'sent', aprovadoEm: now, enviadoEm: now, resolvidoEm: now },
        });
        log?.info?.(`[Suporte] 🤖 Atendimento ${atendimento.id} resolvido automaticamente (conf=${c.confianca_resposta})`);
      } catch (sendErr: any) {
        // Falha ao enviar: não perder o caso — volta para a fila e avisa o admin.
        log?.warn?.(`[Suporte] Falha ao auto-enviar (${atendimento.id}): ${sendErr.message}`);
        atualizado = await prisma.supportAtendimento.update({
          where: { id: atendimento.id },
          data: { requerEscalacao: true },
        });
        notifyAdminEscalation(atualizado, `Falha ao enviar resposta automática: ${sendErr.message}`, log).catch(() => null);
      }
    } else if (!isSpam) {
      notifyAdminEscalation(atualizado, c.requer_escalacao ? 'Caso sensível ou baixa confiança — requer humano' : 'Spam suspeito', log).catch(() => null);
    }

    // Sugestão de FAQ → fila de sugestões
    if (c.sugestao_faq) {
      prisma.faqSuggestion.create({
        data: {
          tituloSugerido: c.sugestao_faq,
          conteudoSugerido: result.rascunho,
          categoria: c.categoria,
          atendimentoOrigemId: atendimento.id,
        },
      }).catch(() => null);
    }

    // Notifica o painel admin em tempo real (MÓDULO 6 — canal painel)
    io.to('admin:suporte').emit('suporte:novo', {
      id: atendimento.id,
      canal: input.canal,
      prioridade: c.prioridade,
      categoria: c.categoria,
      sentimento: c.sentimento,
      requerEscalacao: c.requer_escalacao,
      autoResolvido: autoResolve,
      clienteNome: input.clienteNome,
    });

    log?.info?.(`[Suporte] Atendimento ${atendimento.id} classificado: ${c.categoria}/${c.prioridade} conf=${c.confianca_resposta} auto=${autoResolve}`);
  } catch (err: any) {
    // Falha do agente não perde a mensagem: fica na fila para resposta manual
    const atualizado = await prisma.supportAtendimento.update({
      where: { id: atendimento.id },
      data: { requerEscalacao: true, prioridade: 'alta', contextoUsado: `Falha do agente: ${err.message}` },
    }).catch(() => atendimento);
    io.to('admin:suporte').emit('suporte:novo', { id: atendimento.id, canal: input.canal, requerEscalacao: true });
    notifyAdminEscalation(atualizado, `O agente falhou ao processar: ${err.message}`, log).catch(() => null);
    log?.error?.({ err: err.message }, '[Suporte] Agente falhou — atendimento marcado para resposta manual');
  }

  return atendimento;
}
