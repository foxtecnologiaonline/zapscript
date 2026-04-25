import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';

const PLAN_PRICES: Record<string, number> = { pro: 29.90, ultra: 59.90, free: 0 };

function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
};

export default async function adminRoutes(app: FastifyInstance) {

  // GET /admin/stats — dashboard completo do admin
  app.get('/stats', { preHandler: [adminAuth] }, async () => {
    const now            = new Date();
    const today          = new Date(now); today.setHours(0, 0, 0, 0);
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = monthStart;

    const [
      totalUsers, todayUsers, monthUsers, lastMonthUsers,
      byPlanRaw,
      activeSubs,
      subStatusGroups,
      totalTranscriptions, todayTranscriptions,
      totalMinutes, todayMinutes,
      recentErrors,
      totalTickets, openTickets,
      connectedNumbers, totalNumbers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } } }),
      // distribuição por plano
      prisma.subscription.findMany({ include: { plan: { select: { name: true } } } }).then(subs =>
        subs.reduce((acc: Record<string, number>, s) => {
          const name = s.plan.name;
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {})
      ),
      // assinaturas ativas com plano (para MRR)
      prisma.subscription.findMany({
        where:   { status: 'active' },
        include: { plan: { select: { name: true } } },
      }),
      // agrupamento por status
      prisma.subscription.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.transcription.count(),
      prisma.transcription.count({ where: { createdAt: { gte: today } } }),
      prisma.usageLog.aggregate({ _sum: { minutesUsed: true } }),
      prisma.usageLog.aggregate({ _sum: { minutesUsed: true }, where: { createdAt: { gte: today } } }),
      prisma.systemError.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: 'open' } }),
      prisma.whatsappNumber.count({ where: { status: 'connected' } }),
      prisma.whatsappNumber.count(),
    ]);

    const mrr            = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan.name] || 0), 0);
    const paidActive     = activeSubs.filter(s => s.plan.name !== 'free').length;
    const conversionRate = totalUsers > 0 ? (paidActive / totalUsers) * 100 : 0;
    const subsByStatus   = subStatusGroups.reduce((acc: Record<string, number>, g) => {
      acc[g.status] = g._count.status;
      return acc;
    }, {});

    return {
      users:          { total: totalUsers, today: todayUsers, month: monthUsers, lastMonth: lastMonthUsers },
      byPlan:         byPlanRaw,
      transcriptions: { total: totalTranscriptions, today: todayTranscriptions },
      minutes:        { total: totalMinutes._sum.minutesUsed || 0, today: todayMinutes._sum.minutesUsed || 0 },
      recentErrors,
      tickets:        { total: totalTickets, open: openTickets },
      mrr,
      conversion:     { paid: paidActive, rate: conversionRate },
      subscriptions:  subsByStatus,
      whatsapp:       { connected: connectedNumbers, total: totalNumbers },
    };
  });

  // GET /admin/users — lista de usuários com busca e paginação
  app.get<{ Querystring: { limit?: string; offset?: string; search?: string } }>(
    '/users',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const search = req.query.search;

      const where: any = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { name:  { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where, take: limit, skip: offset,
          include: { subscription: { include: { plan: true } }, balance: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      return { users, total, limit, offset };
    }
  );

  // GET /admin/tickets — tickets de suporte com filtro e paginação
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>(
    '/tickets',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const status = req.query.status;

      const where: any = {};
      if (status) where.status = status;

      const [tickets, total] = await Promise.all([
        prisma.supportTicket.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.supportTicket.count({ where }),
      ]);

      return { tickets, total, limit, offset };
    }
  );

  // GET /admin/errors — log de erros do sistema
  app.get<{ Querystring: { limit?: string } }>(
    '/errors',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '50') || 50, 1), 500);
      return prisma.systemError.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
  );
}
