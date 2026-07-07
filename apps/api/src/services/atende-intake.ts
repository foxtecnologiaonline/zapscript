import { prisma } from '../lib/prisma';
import { redactPII } from '../lib/pii';
import { runAtendeAgent, decideAutonomia } from './atende-agent';
import { sendAtendeReply } from './atende-send';
import { io } from '../index';

/**
 * Ingestão de UMA mensagem recebida de um cliente do assinante (Atende).
 *
 * Reaproveita o fluxo do support-intake, mas MULTI-TENANT: o dono do dado é o
 * `userId` do assinante (dono do WhatsappNumber que recebeu a mensagem), não "o
 * ZapScript". Decide auto-envio (verde) × fila (amarelo/vermelho) × spam com a
 * config do tenant e o piso jurídico não-desligável.
 *
 * Minimização de dados (LGPD): NÃO guardamos o histórico bruto de mensagens do
 * terceiro. Persistimos apenas o necessário para auditoria da resposta — o
 * rascunho/resposta, a classificação e as pendências — e um resumo REDIGIDO.
 */

export interface AtendeIntakeInput {
  numberId: string;             // WhatsappNumber que recebeu
  userId: string;               // dono do número (o assinante)
  remoteJid: string;            // contato do cliente
  clienteNome?: string | null;
  mensagem: string;             // texto (ou transcrição de áudio já calculada)
  messageId: string;            // idempotência
}

export interface AtendeIntakeResult {
  status: 'skipped' | 'duplicate' | 'sent' | 'pending_approval' | 'spam' | 'escalated' | 'error';
  mensagemId?: string;
}

export async function atendeIntake(input: AtendeIntakeInput, log?: any): Promise<AtendeIntakeResult> {
  // ── Config do tenant (gate + guardrails) ────────────────────────────────
  const cfg = await prisma.atendeConfig.findUnique({ where: { userId: input.userId } }).catch(() => null);
  if (!cfg || !cfg.ativo) {
    return { status: 'skipped' };
  }

  // ── Idempotência por messageId ──────────────────────────────────────────
  const existing = await prisma.atendeMensagem
    .findFirst({ where: { canalExternoId: input.messageId }, select: { id: true } })
    .catch(() => null);
  if (existing) {
    log?.info?.(`[Atende] Mensagem ${input.messageId} já processada — ignorada`);
    return { status: 'duplicate', mensagemId: existing.id };
  }

  // ── Conversa (uma por assinante+número+cliente) ─────────────────────────
  const conversa = await prisma.atendeConversa.upsert({
    where:  { userId_numberId_remoteJid: { userId: input.userId, numberId: input.numberId, remoteJid: input.remoteJid } },
    create: {
      userId: input.userId, numberId: input.numberId, remoteJid: input.remoteJid,
      contatoNome: input.clienteNome ?? null,
    },
    update: { contatoNome: input.clienteNome ?? undefined },
  });

  // ── Agente: classifica + gera rascunho ──────────────────────────────────
  let result;
  try {
    result = await runAtendeAgent({
      message: input.mensagem,
      clienteNome: input.clienteNome,
      resumoConversa: conversa.resumoAtual || null,
      config: {
        negocioDescricao:    cfg.negocioDescricao,
        toneOverride:        cfg.toneOverride,
        categoriasSensiveis: cfg.categoriasSensiveis,
      },
    });
  } catch (err: any) {
    // Falha do agente não perde a mensagem: entra na fila para resposta manual.
    const msg = await prisma.atendeMensagem.create({
      data: {
        conversaId: conversa.id, direcao: 'recebida', status: 'pending_approval',
        requerEscalacao: true, canalExternoId: input.messageId,
      },
    });
    await touchConversa(conversa.id, input.messageId, `falha do agente`);
    emitNovo(input.userId, conversa.id, msg.id, { requerEscalacao: true });
    log?.error?.(`[Atende] Agente falhou (${conversa.id}): ${err.message}`);
    return { status: 'error', mensagemId: msg.id };
  }

  const c = result.classificacao;
  const decision = decideAutonomia(c, input.mensagem, cfg.categoriasSensiveis);

  // ── Auto-envio: só VERDE (não sensível, sem escalação, sem spam) E com
  //    opt-in explícito (autoEnvioAtivo). Categoria sensível NUNCA é enviada
  //    automaticamente, mesmo com autoEnvioAtivo=true. ──────────────────────
  const verde = !decision.spam && !decision.requerEscalacao && !decision.sensivel;
  const autoEnviar = verde && cfg.autoEnvioAtivo;

  let status: AtendeIntakeResult['status'] = decision.spam
    ? 'spam'
    : decision.requerEscalacao ? 'escalated' : 'pending_approval';
  let respostaFinal: string | null = null;
  let enviadoEm: Date | null = null;

  if (autoEnviar) {
    try {
      await sendAtendeReply(input.numberId, input.remoteJid, result.rascunho);
      respostaFinal = result.rascunho;
      enviadoEm = new Date();
      status = 'sent';
      log?.info?.(`[Atende] 🤖 Resposta automática enviada (conv=${conversa.id} conf=${c.confianca_resposta})`);
    } catch (sendErr: any) {
      // Falha ao enviar: não perde o caso — volta para a fila.
      status = 'pending_approval';
      log?.warn?.(`[Atende] Falha ao auto-enviar (${conversa.id}): ${sendErr.message}`);
    }
  }

  const dbStatus = status === 'escalated' ? 'pending_approval' : status; // 'escalated' vira fila com flag

  const msg = await prisma.atendeMensagem.create({
    data: {
      conversaId:        conversa.id,
      direcao:           'recebida',
      categoria:         c.categoria,
      prioridade:        c.urgencia,
      confiancaResposta: c.confianca_resposta,
      requerEscalacao:   decision.requerEscalacao,
      categoriaSensivel: decision.sensivel,
      status:            dbStatus,
      rascunho:          result.rascunho,
      respostaFinal,
      enviadoEm,
      canalExternoId:    input.messageId,
    },
  });

  // ── Pendências detectadas ──────────────────────────────────────────────
  if (c.pendencias.length) {
    await prisma.atendePendencia.createMany({
      data: c.pendencias.slice(0, 10).map(p => ({
        conversaId: conversa.id,
        descricao:  redactPII(p.descricao).slice(0, 280),
        urgencia:   p.urgencia,
      })),
    }).catch(() => null);
  }

  // ── Resumo REDIGIDO (minimização — não guarda a mensagem bruta) ─────────
  const resumo = redactPII([c.categoria, ...c.topicos_identificados].join('; ')).slice(0, 500);
  await touchConversa(conversa.id, input.messageId, resumo);

  emitNovo(input.userId, conversa.id, msg.id, {
    categoria: c.categoria, urgencia: c.urgencia, sensivel: decision.sensivel,
    requerEscalacao: decision.requerEscalacao, autoResolvido: status === 'sent',
    contatoNome: input.clienteNome,
  });

  log?.info?.(`[Atende] Msg ${msg.id} conv=${conversa.id} cat=${c.categoria} conf=${c.confianca_resposta} status=${status}`);
  return { status, mensagemId: msg.id };
}

async function touchConversa(conversaId: string, messageId: string, resumo: string) {
  await prisma.atendeConversa.update({
    where: { id: conversaId },
    data:  { resumoAtual: resumo, ultimaMsgId: messageId, ultimaMsgEm: new Date() },
  }).catch(() => null);
}

function emitNovo(userId: string, conversaId: string, mensagemId: string, extra: Record<string, any>) {
  try {
    io.to(`user:${userId}`).emit('atende:novo', { conversaId, mensagemId, ...extra });
  } catch { /* socket best-effort */ }
}
