import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { planEfetivo, audioQuotaFor } from '../lib/freemium';
import type { VoiceIntent, VoiceIntentResult } from './voice-command-agent';

/**
 * Executa a ação correspondente ao intent já classificado por voice-command-agent.ts.
 * Cada handler devolve o status final (para o log de auditoria VoiceCommand) e o
 * texto de confirmação a mandar de volta ao usuário no self-chat.
 */

export interface ExecutionResult {
  status: 'executed' | 'failed' | 'ignored';
  resultSummary: string | null;
}

const DEFAULT_STAGE = { name: 'Novo lead', order: 0, color: '#3b82f6' };

/** Espelha getUserModules() sem o cache Redis — caminho de baixo volume (só self-note). */
async function hasModule(userId: string, key: string): Promise<boolean> {
  const ent = await prisma.entitlement.findFirst({
    where:  { userId, productKey: key, status: { in: ['active', 'trialing'] } },
    select: { id: true },
  }).catch(() => null);
  return !!ent;
}

function normalizePhone(raw?: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : `voz-${randomUUID()}`;
}

async function getDefaultStageId(userId: string): Promise<string> {
  const stage = await prisma.crmStage.findFirst({ where: { userId }, orderBy: { order: 'asc' } });
  if (stage) return stage.id;
  const created = await prisma.crmStage.create({ data: { userId, ...DEFAULT_STAGE } });
  return created.id;
}

async function executeCrmCreateLead(userId: string, data: VoiceIntentResult['data']): Promise<ExecutionResult> {
  if (!(await hasModule(userId, 'crm'))) {
    return {
      status: 'ignored',
      resultSummary: '💡 Notei que você quer criar um lead, mas o módulo CRM não está ativo na sua conta. Ative o CRM no painel do ZapScript pra eu conseguir fazer isso por voz.',
    };
  }

  const nome = data.nome?.trim();
  if (!nome) {
    return {
      status: 'failed',
      resultSummary: '🤔 Entendi que você quer criar um lead, mas não peguei o nome com clareza. Manda de novo dizendo o nome do contato.',
    };
  }

  const stageId = await getDefaultStageId(userId);
  const phone = normalizePhone(data.telefone);

  try {
    const contact = await prisma.crmContact.create({
      data: {
        userId, stageId, name: nome, phone,
        company: data.empresa?.trim() || null,
        value:   typeof data.valor === 'number' ? data.valor : null,
        source:  'voice_command',
      },
    });

    if (data.observacao?.trim()) {
      await prisma.crmActivity.create({
        data: { contactId: contact.id, userId, type: 'note', content: data.observacao.trim() },
      }).catch(() => null);
    }

    const detalhes = [
      data.empresa ? `empresa ${data.empresa}` : null,
      typeof data.valor === 'number' ? `R$ ${data.valor}` : null,
    ].filter(Boolean).join(', ');

    return {
      status: 'executed',
      resultSummary: `✅ Lead criado no CRM: *${nome}*${detalhes ? ` (${detalhes})` : ''}.`,
    };
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return { status: 'ignored', resultSummary: `ℹ️ Já existe um lead com esse telefone no seu CRM (${nome}).` };
    }
    throw err;
  }
}

async function executeCrmQuery(userId: string): Promise<ExecutionResult> {
  if (!(await hasModule(userId, 'crm'))) {
    return {
      status: 'ignored',
      resultSummary: '💡 Você perguntou sobre seu funil, mas o módulo CRM não está ativo na sua conta. Ative o CRM no painel do ZapScript.',
    };
  }

  const [stages, overdue] = await Promise.all([
    prisma.crmStage.findMany({
      where:   { userId },
      orderBy: { order: 'asc' },
      select:  { name: true, _count: { select: { contacts: true } } },
    }),
    prisma.crmActivity.count({
      where: { userId, type: 'reminder', dueAt: { lte: new Date() }, completedAt: null },
    }),
  ]);

  if (stages.length === 0 || stages.every((s) => s._count.contacts === 0)) {
    return { status: 'executed', resultSummary: '📊 Seu funil de CRM ainda está vazio — nenhum lead cadastrado.' };
  }

  const total = stages.reduce((sum, s) => sum + s._count.contacts, 0);
  const lines = stages.filter((s) => s._count.contacts > 0).map((s) => `• ${s.name}: ${s._count.contacts}`);
  const overdueLine = overdue > 0 ? `\n⏰ ${overdue} lembrete(s) vencido(s)` : '';

  return {
    status: 'executed',
    resultSummary: `📊 Seu funil agora — total: ${total} lead(s)\n${lines.join('\n')}${overdueLine}`,
  };
}

async function executeAtendeAddKb(userId: string, data: VoiceIntentResult['data']): Promise<ExecutionResult> {
  if (!(await hasModule(userId, 'atende'))) {
    return {
      status: 'ignored',
      resultSummary: '💡 Notei que você quer ensinar uma resposta pro Atende, mas o módulo Atende não está ativo na sua conta.',
    };
  }

  const pergunta = data.pergunta?.trim();
  const resposta = data.resposta?.trim();
  if (!pergunta || !resposta) {
    return {
      status: 'failed',
      resultSummary: '🤔 Entendi que você quer ensinar o Atende, mas não peguei a pergunta E a resposta com clareza. Tenta assim: "adiciona na base de conhecimento: quando perguntarem sobre X, responde Y".',
    };
  }

  await prisma.atendeKnowledgeBase.create({ data: { userId, question: pergunta, answer: resposta } });

  return {
    status: 'executed',
    resultSummary: `✅ Adicionei na base de conhecimento do Atende:\n*P:* ${pergunta}\n*R:* ${resposta}`,
  };
}

async function executeStatsQuery(userId: string): Promise<ExecutionResult> {
  const [user, bal] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { isTester: true, subscription: { select: { status: true, plan: { select: { name: true } } } } },
    }),
    prisma.minuteBalance.findUnique({ where: { userId }, select: { audiosUsed: true } }),
  ]);

  const plan  = planEfetivo(user || {}, new Date());
  const quota = audioQuotaFor(plan);
  const used  = bal?.audiosUsed ?? 0;
  const restam = Math.max(quota - used, 0);
  const planLabel = plan === 'pro' ? 'Pro' : 'Grátis';

  return {
    status: 'executed',
    resultSummary: `📈 Plano ${planLabel}: você já usou ${used} de ${quota} áudios este mês (restam ${restam}).`,
  };
}

export async function executeVoiceCommand(
  userId: string,
  intent: Exclude<VoiceIntent, 'none'>,
  data: VoiceIntentResult['data'],
): Promise<ExecutionResult> {
  try {
    switch (intent) {
      case 'crm_create_lead': return await executeCrmCreateLead(userId, data);
      case 'crm_query':       return await executeCrmQuery(userId);
      case 'atende_add_kb':   return await executeAtendeAddKb(userId, data);
      case 'stats_query':     return await executeStatsQuery(userId);
    }
  } catch (err: any) {
    logger.error(`[VoiceCommand] Falha ao executar intent ${intent}: ${err.message}`);
    return { status: 'failed', resultSummary: null };
  }
}
