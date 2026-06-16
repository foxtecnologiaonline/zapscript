import { prisma } from '../lib/prisma';
import { runSupportAgent, Canal } from './support-agent';
import { io } from '../index';

/**
 * Ingestão de uma mensagem recebida (qualquer canal) → cria SupportAtendimento,
 * roda o agente e persiste o rascunho para aprovação. Idempotente por canalExternoId.
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

  // Roda o agente (classifica + gera rascunho)
  try {
    const historico = await buildHistorico(input.threadId, atendimento.id);
    const result = await runSupportAgent({
      message: input.mensagem,
      clienteNome: input.clienteNome,
      historico,
    });

    const c = result.classificacao;
    await prisma.supportAtendimento.update({
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
        status: c.categoria === 'spam' ? 'spam' : 'pending_approval',
      },
    });

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
      clienteNome: input.clienteNome,
    });

    log?.info?.(`[Suporte] Atendimento ${atendimento.id} classificado: ${c.categoria}/${c.prioridade} conf=${c.confianca_resposta}`);
  } catch (err: any) {
    // Falha do agente não perde a mensagem: fica na fila para resposta manual
    await prisma.supportAtendimento.update({
      where: { id: atendimento.id },
      data: { requerEscalacao: true, prioridade: 'alta', contextoUsado: `Falha do agente: ${err.message}` },
    }).catch(() => null);
    io.to('admin:suporte').emit('suporte:novo', { id: atendimento.id, canal: input.canal, requerEscalacao: true });
    log?.error?.({ err: err.message }, '[Suporte] Agente falhou — atendimento marcado para resposta manual');
  }

  return atendimento;
}
