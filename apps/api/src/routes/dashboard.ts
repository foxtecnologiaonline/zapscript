import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { planEfetivo, audioQuotaFor, formatSavedTime } from '../lib/freemium';

export default async function dashboardRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  app.get('/stats', auth, async (req: any) => {
    const userId = req.user.sub;
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const month  = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);

    const [todayCount, monthCount, totalCount, balance, activeNumbers, avgConf, sub, user, userTester, savedAgg] = await Promise.all([
      prisma.transcription.count({ where: { userId, createdAt: { gte: today } } }),
      prisma.transcription.count({ where: { userId, createdAt: { gte: month } } }),
      prisma.transcription.count({ where: { userId } }),
      prisma.minuteBalance.findUnique({ where: { userId } }),
      prisma.whatsappNumber.count({ where: { userId, status: 'connected' } }),
      prisma.transcription.aggregate({
        where: { userId },
        _avg:  { confidenceScore: true },
      }),
      prisma.subscription.findUnique({
        where:   { userId },
        include: { plan: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { refCode: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { isTester: true, createdAt: true } }),
      // Tempo economizado no mês = soma das durações dos áudios lidos (C3).
      prisma.transcription.aggregate({
        where: { userId, createdAt: { gte: month } },
        _sum:  { durationSec: true },
      }),
    ]);

    const minutesTotal  = sub?.plan.minutesPerMonth || 0;
    // availableMinutes pode ser maior que minutesTotal após downgrade — limitar ao total
    const minutesAvail  = Math.min(balance?.availableMinutes || 0, minutesTotal);
    const minutesUsed   = Math.max(0, minutesTotal - minutesAvail);

    // Saldo extra (avulso/indicação) — só conta se ainda válido (não expirado)
    const extraValid    = balance?.extraExpiresAt && balance.extraExpiresAt > new Date()
      ? (balance.extraMinutes || 0) : 0;

    // ── Métrica primária: ÁUDIOS do ciclo ──────────────────────────────────
    const now           = new Date();
    const effPlan       = planEfetivo(
      { isTester: userTester?.isTester, subscription: sub ? { status: sub.status, trialEndsAt: sub.trialEndsAt, plan: { name: sub.plan.name } } : null },
      now,
    );
    const audiosQuota   = audioQuotaFor(effPlan);
    // audiosUsed pode ser negativo (bônus de indicação abate a cota) — nunca exibir < 0.
    const audiosUsed    = Math.max(0, balance?.audiosUsed || 0);
    // PRO comunica "ilimitado" — não expõe o teto oculto na UI.
    const audiosUnlimited = effPlan === 'pro';

    // ── Trial (7 dias de PRO) ──────────────────────────────────────────────
    const isTrial       = sub?.status === 'trialing' && !!sub.trialEndsAt && sub.trialEndsAt > now;
    const trialDaysLeft = isTrial && sub?.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null;

    // ── Tempo economizado no mês (C3) ──────────────────────────────────────
    const savedSecondsMonth = savedAgg._sum.durationSec || 0;

    return {
      transcriptionsToday: todayCount,
      transcriptionsMonth: monthCount,
      transcriptionsTotal: totalCount,
      minutesUsed:         +minutesUsed.toFixed(1),
      minutesAvailable:    +minutesAvail.toFixed(1),
      minutesTotal,
      minutesPct:          minutesTotal > 0 ? Math.round((minutesUsed / minutesTotal) * 100) : 0,
      accumulatedMinutes:  +(balance?.accumulatedMinutes || 0).toFixed(1),
      extraMinutes:        +extraValid.toFixed(1),
      extraExpiresAt:      extraValid > 0 ? balance?.extraExpiresAt?.toISOString() ?? null : null,
      activeNumbers,
      avgConfidence:       +(avgConf._avg.confidenceScore || 99.1).toFixed(1),
      // planName = slug do plano ('free'|'pro'|'ultra'|'executive') — usado para gating
      // planLabel = label exibível ('Grátis'|'Pro'|'Ultra'|'Executive')
      planName:            sub?.plan.name  || 'free',
      planLabel:           sub?.plan.label || 'Free',
      planStatus:          sub?.status || 'active',
      // Fallback: se currentPeriodEnd não estiver setado (ex.: tester/admin), usa balance.resetAt
      renewAt:             sub?.currentPeriodEnd?.toISOString() ?? balance?.resetAt?.toISOString() ?? null,
      refCode:             user?.refCode ?? null,
      isTester:            userTester?.isTester ?? false,
      testerCreatedAt:     userTester?.createdAt?.toISOString() ?? null,
      testerRenewalsUsed:  sub?.testerRenewalsUsed ?? 0,
      testerRenewalsTotal: 12,
      // ── Métrica primária: áudios ──
      audiosUsed,
      audiosQuota,
      audiosUnlimited,
      audiosPct:           audiosUnlimited ? 0 : (audiosQuota > 0 ? Math.min(100, Math.round((audiosUsed / audiosQuota) * 100)) : 0),
      effectivePlan:       effPlan, // 'pro' | 'free' (efetivo, considerando trial/tester)
      // ── Trial freemium ──
      isTrial,
      trialEndsAt:         isTrial ? sub?.trialEndsAt?.toISOString() ?? null : null,
      trialDaysLeft,
      // ── Tempo economizado no mês (C3) ──
      savedSecondsMonth,
      savedLabelMonth:     formatSavedTime(savedSecondsMonth),
    };
  });
}
