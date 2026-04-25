import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function dashboardRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  app.get('/stats', auth, async (req: any) => {
    const userId = req.user.sub;
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const month  = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);

    const [todayCount, monthCount, balance, activeNumbers, avgConf, sub] = await Promise.all([
      prisma.transcription.count({ where: { userId, createdAt: { gte: today } } }),
      prisma.transcription.count({ where: { userId, createdAt: { gte: month } } }),
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
    const minutesAvail  = balance?.availableMinutes || 0;
    const minutesUsed   = Math.max(0, minutesTotal - minutesAvail);

    return {
      transcriptionsToday: todayCount,
      transcriptionsMonth: monthCount,
      minutesUsed:         +minutesUsed.toFixed(1),
      minutesAvailable:    +minutesAvail.toFixed(1),
      minutesTotal,
      minutesPct:          minutesTotal > 0 ? Math.round((minutesUsed / minutesTotal) * 100) : 0,
      activeNumbers,
      avgConfidence:       +(avgConf._avg.confidenceScore || 99.1).toFixed(1),
      planName:            sub?.plan.label || 'Free',
      planStatus:          sub?.status || 'active',
    };
  });
}
