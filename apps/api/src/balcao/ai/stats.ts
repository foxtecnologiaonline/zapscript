import { prisma } from '../../lib/prisma';
import { getUsage } from '../core/usage';

/**
 * Métricas do chatbot. IQA 07 (TR): % de atendimentos via chatbot resolvidos no 1º contato e classificados
 * como automatizáveis. Metas 40% → 60% → 80%.
 *   numerador   = conversas ENCERRADAS com botHandled ∧ resolvedByBot ∧ firstContactResolved ∧ automatable
 *   denominador = conversas ENCERRADAS com botHandled ∧ automatable      (iqa07 — fórmula da frente de IA)
 *   iqa07PorAtendimentoBot usa como denominador TODAS as encerradas com botHandled (leitura literal do edital)
 */
export async function aiStats(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  const base = { orgId, startedAt: { gte: since }, botHandled: true };
  const [handled, resolvedByBot, closedBot, closedAuto, iqaNum, escEvents, fb, csat, calls, tokens] = await Promise.all([
    prisma.bvConversation.count({ where: base }),
    prisma.bvConversation.count({ where: { ...base, resolvedByBot: true } }),
    prisma.bvConversation.count({ where: { ...base, status: 'CLOSED' } }),
    prisma.bvConversation.count({ where: { ...base, status: 'CLOSED', automatable: true } }),
    prisma.bvConversation.count({ where: { ...base, status: 'CLOSED', automatable: true, resolvedByBot: true, firstContactResolved: true } }),
    prisma.bvConversationEvent.findMany({ where: { orgId, type: 'ESCALATED', createdAt: { gte: since } }, select: { data: true }, take: 5000 }),
    prisma.bvAuditLog.groupBy({ by: ['action'], where: { orgId, action: { in: ['kb.feedback.helpful', 'kb.feedback.unhelpful'] }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bvConversation.aggregate({ where: { ...base, resolvedByBot: true, csatScore: { not: null } }, _avg: { csatScore: true }, _count: { _all: true } }),
    getUsage(orgId, 'AI_CALLS', since, new Date()),
    getUsage(orgId, 'AI_TOKENS', since, new Date()),
  ]);
  const byReason: Record<string, number> = {};
  for (const e of escEvents) { const r = String((e.data as any)?.reason ?? 'UNKNOWN'); byReason[r] = (byReason[r] ?? 0) + 1; }
  const helpful = fb.find((x) => x.action === 'kb.feedback.helpful')?._count._all ?? 0;
  const unhelpful = fb.find((x) => x.action === 'kb.feedback.unhelpful')?._count._all ?? 0;
  const iqa = closedAuto ? iqaNum / closedAuto : null;
  return {
    windowDays: days,
    conversations: { botHandled: handled, resolvedByBot, escalated: Object.values(byReason).reduce((a, b) => a + b, 0) },
    containmentRate: handled ? resolvedByBot / handled : null,
    escalationsByReason: byReason,
    accuracy: { helpful, unhelpful, rate: helpful + unhelpful ? helpful / (helpful + unhelpful) : null, botResolvedCsatAvg: csat._avg.csatScore, botResolvedCsatCount: csat._count._all },
    iqa07: { value: iqa, numerator: iqaNum, denominator: closedAuto, perBotAttendance: closedBot ? iqaNum / closedBot : null, targets: [0.4, 0.6, 0.8], definition: 'resolvidas pelo bot no 1º contato ÷ encerradas classificadas como automatizáveis' },
    usage: { aiCalls: calls, aiTokens: tokens },
  };
}
