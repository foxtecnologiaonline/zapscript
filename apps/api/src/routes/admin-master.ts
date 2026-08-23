import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { adminAuth } from '../lib/adminAuth';
import { maskPhone, maskText } from '../lib/mask';

function wantsReveal(req: any): boolean {
  return req.query?.reveal === 'true' || req.query?.reveal === '1';
}

export default async function adminMasterRoutes(app: FastifyInstance) {

  // GET /sys/g5r8t2/master/users — lista completa com nome, telefone, refCode, isTester
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
          { email:  { contains: search, mode: 'insensitive' } },
          { name:   { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where, take: limit, skip: offset,
          include: { subscription: { include: { plan: true } }, balance: true, numbers: { select: { phoneNumber: true, status: true, displayName: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      // Telefone mascarado por padrão (dado sensível) — ?reveal=true mostra em claro.
      const reveal = wantsReveal(req);
      const usersOut = reveal ? users : users.map((u: any) => ({
        ...u,
        numbers: u.numbers.map((n: any) => ({ ...n, phoneNumber: maskPhone(n.phoneNumber) })),
      }));

      return { users: usersOut, total, limit, offset, masked: !reveal };
    }
  );

  // GET /sys/g5r8t2/master/users/:id/detail — detalhes completos incluindo conversões
  app.get<{ Params: { id: string } }>(
    '/users/:id/detail',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;

      const [user, transcriptions, numbers, usageLogs] = await Promise.all([
        prisma.user.findUnique({
          where:   { id },
          include: {
            subscription: { include: { plan: true } },
            balance: true,
          },
        }),
        prisma.transcription.findMany({
          where:   { userId: id },
          orderBy: { createdAt: 'desc' },
          take:    50,
          select:  { id: true, originalText: true, summaryBullets: true, durationSec: true, language: true, contactName: true, contactPhone: true, source: true, createdAt: true },
        }),
        prisma.whatsappNumber.findMany({
          where:  { userId: id },
          select: { id: true, displayName: true, phoneNumber: true, status: true, createdAt: true, connectedAt: true, messageCount: true, minutesUsed: true },
        }),
        prisma.usageLog.findMany({
          where:   { userId: id },
          orderBy: { createdAt: 'desc' },
          take:    30,
          select:  { minutesUsed: true, createdAt: true },
        }),
      ]);

      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const totalMinutesUsed = usageLogs.reduce((s: number, l: any) => s + (l.minutesUsed || 0), 0);
      const planLimit        = (user as any).subscription?.plan?.audiosPerMonth || 0;
      const audiosUsed       = (user as any).balance?.audiosUsed || 0;
      const usagePct         = planLimit > 0 ? Math.min(100, (audiosUsed / planLimit) * 100) : 0;

      // Telefone e texto integral da transcrição mascarados por padrão — dado
      // pessoal sensível (LGPD). ?reveal=true mostra em claro quando precisar
      // de verdade pra dar suporte.
      const reveal = wantsReveal(req);
      const numbersOut = reveal ? numbers : numbers.map((n: any) => ({ ...n, phoneNumber: maskPhone(n.phoneNumber) }));
      const transcriptionsOut = reveal ? transcriptions : transcriptions.map((t: any) => ({
        ...t,
        originalText: maskText(t.originalText),
        contactPhone: maskPhone(t.contactPhone),
      }));

      return {
        user,
        stats: {
          totalTranscriptions: transcriptions.length,
          totalMinutesUsed,
          audiosUsed,
          planLimit,
          usagePct: Math.round(usagePct),
        },
        transcriptions: transcriptionsOut,
        numbers: numbersOut,
        usageLogs,
        masked: !reveal,
      };
    }
  );

  // GET /sys/g5r8t2/master/testers — lista todos os testers
  app.get(
    '/testers',
    { preHandler: [adminAuth] },
    async (req) => {
      const testers = await prisma.user.findMany({
        where:   { isTester: true },
        select: {
          id: true,
          name: true,
          email: true,
          refCode: true,
          isTester: true,
          testerSince: true,
          createdAt: true,
          subscription: { include: { plan: true } },
          numbers: { select: { phoneNumber: true, status: true } },
        },
        orderBy: { testerSince: 'desc' },
      });

      const reveal = wantsReveal(req);
      const testersOut = reveal ? testers : testers.map((t: any) => ({
        ...t,
        numbers: t.numbers.map((n: any) => ({ ...n, phoneNumber: maskPhone(n.phoneNumber) })),
      }));

      return { testers: testersOut, total: testers.length, masked: !reveal };
    }
  );

  // GET /sys/g5r8t2/master/invites — lista convites com link completo
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/invites',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50') || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const [invites, total] = await Promise.all([
        prisma.testerInvite.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        prisma.testerInvite.count(),
      ]);
      const appUrl = process.env.APP_URL || 'https://zapscript.me';
      return {
        invites: invites.map((i: any) => ({ ...i, link: `${appUrl}/convite/${i.code}` })),
        total,
        limit,
        offset,
      };
    }
  );
}
