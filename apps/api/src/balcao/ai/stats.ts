import { prisma } from '../../lib/prisma';
import { getUsage } from '../core/usage';
import { computeIqa, getIqaConfig, iqaDefinition, iqaForPeriod } from '../reports/metrics';

/**
 * Métricas do chatbot. IQA 07 (TR 18.1): % de atendimentos via chatbot resolvidos no 1º contato e classificados
 * como automatizáveis. A fórmula é ÚNICA e vive em `reports/metrics.ts` (`computeIqa`/`iqaForPeriod`); esta
 * função só a chama — a base do denominador vem de `settings.iqa.denominator` ('ALL_BOT' padrão | 'AUTOMATABLE').
 * Aqui os valores são razões 0–1 (compatível com o front); `valuePct` é o mesmo número em %.
 */
export async function aiStats(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  const base = { orgId, startedAt: { gte: since }, botHandled: true };
  const [handled, resolvedByBot, escEvents, fb, csat, calls, tokens, iqaCfg, iqa] = await Promise.all([
    prisma.bvConversation.count({ where: base }),
    prisma.bvConversation.count({ where: { ...base, resolvedByBot: true } }),
    prisma.bvConversationEvent.findMany({ where: { orgId, type: 'ESCALATED', createdAt: { gte: since } }, select: { data: true }, take: 5000 }),
    prisma.bvAuditLog.groupBy({ by: ['action'], where: { orgId, action: { in: ['kb.feedback.helpful', 'kb.feedback.unhelpful'] }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bvConversation.aggregate({ where: { ...base, resolvedByBot: true, csatScore: { not: null } }, _avg: { csatScore: true }, _count: { _all: true } }),
    getUsage(orgId, 'AI_CALLS', since, new Date()),
    getUsage(orgId, 'AI_TOKENS', since, new Date()),
    getIqaConfig(orgId),
    iqaForPeriod({ orgId, period: { from: since, to: new Date(Date.now() + 60_000), timezone: 'UTC' } }),
  ]);
  const byReason: Record<string, number> = {};
  for (const e of escEvents) { const r = String((e.data as any)?.reason ?? 'UNKNOWN'); byReason[r] = (byReason[r] ?? 0) + 1; }
  const helpful = fb.find((x) => x.action === 'kb.feedback.helpful')?._count._all ?? 0;
  const unhelpful = fb.find((x) => x.action === 'kb.feedback.unhelpful')?._count._all ?? 0;
  const ratio = (v: number | null) => (v == null ? null : v / 100);
  // as duas leituras alternativas passam pela MESMA função, só trocando a base
  const alt = (d: 'ALL_BOT' | 'AUTOMATABLE') => ratio(computeIqa(iqa, d).value);
  return {
    windowDays: days,
    conversations: { botHandled: handled, resolvedByBot, escalated: Object.values(byReason).reduce((a, b) => a + b, 0) },
    containmentRate: handled ? resolvedByBot / handled : null,
    escalationsByReason: byReason,
    accuracy: { helpful, unhelpful, rate: helpful + unhelpful ? helpful / (helpful + unhelpful) : null, botResolvedCsatAvg: csat._avg.csatScore, botResolvedCsatCount: csat._count._all },
    iqa07: {
      value: ratio(iqa.value), valuePct: iqa.value, numerator: iqa.numerator, denominator: iqa.denominator, denominatorKind: iqa.denominatorKind,
      perBotAttendance: alt('ALL_BOT'), perAutomatable: alt('AUTOMATABLE'),
      targets: iqaCfg.goals.map((g) => g.goalPct / 100), definition: iqaDefinition(iqa.denominatorKind),
    },
    usage: { aiCalls: calls, aiTokens: tokens },
  };
}
