import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function dashboardRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  app.get('/stats', auth, async (req: any) => {
    const userId = req.user.sub;
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const month  = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);

    const [todayCount, monthCount, totalCount, balance, activeNumbers, avgConf, sub] = await Promise.all([
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
    ]);

    const minutesTotal  = sub?.plan.minutesPerMonth || 0;
    // availableMinutes pode ser maior que minutesTotal após downgrade — limitar ao total
    const minutesAvail  = Math.min(balance?.availableMinutes || 0, minutesTotal);
    const minutesUsed   = Math.max(0, minutesTotal - minutesAvail);

    return {
      transcriptionsToday: todayCount,
      transcriptionsMonth: monthCount,
      transcriptionsTotal: totalCount,
      minutesUsed:         +minutesUsed.toFixed(1),
      minutesAvailable:    +minutesAvail.toFixed(1),
      minutesTotal,
      minutesPct:          minutesTotal > 0 ? Math.round((minutesUsed / minutesTotal) * 100) : 0,
      accumulatedMinutes:  +(balance?.accumulatedMinutes || 0).toFixed(1),
      activeNumbers,
      avgConfidence:       +(avgConf._avg.confidenceScore || 99.1).toFixed(1),
      // planName = slug do plano ('free'|'pro'|'ultra'|'executive') — usado para gating
      // planLabel = label exibível ('Grátis'|'Pro'|'Ultra'|'Executive')
      planName:            sub?.plan.name  || 'free',
      planLabel:           sub?.plan.label || 'Free',
      planStatus:          sub?.status || 'active',
    };
  });
}
