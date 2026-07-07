import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { primarySub, PRODUCT } from '../lib/products';
import crypto from 'crypto';
import { checkAdminTotp } from '../lib/totp';

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
  const totp = await checkAdminTotp(token!, req.headers['x-admin-totp'] as string | undefined);
  if (totp !== 'ok') {
    return reply.code(401).send({
      error: totp === 'totp_required' ? 'Código 2FA necessário' : 'Código 2FA inválido',
      totpRequired: true,
    });
  }
};

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
          include: { subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, include: { plan: true } }, balance: true, numbers: { select: { phoneNumber: true, status: true, displayName: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      const usersOut = users.map((u: any) => ({ ...u, subscription: primarySub(u.subscriptions) }));
      return { users: usersOut, total, limit, offset };
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
            subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, include: { plan: true } },
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
      const planLimit        = (primarySub<any>((user as any).subscriptions)?.plan as any)?.audiosPerMonth || 0;
      const audiosUsed       = (user as any).balance?.audiosUsed || 0;
      const usagePct         = planLimit > 0 ? Math.min(100, (audiosUsed / planLimit) * 100) : 0;

      return {
        user: { ...(user as any), subscription: primarySub<any>((user as any).subscriptions) },
        stats: {
          totalTranscriptions: transcriptions.length,
          totalMinutesUsed,
          audiosUsed,
          planLimit,
          usagePct: Math.round(usagePct),
        },
        transcriptions,
        numbers,
        usageLogs,
      };
    }
  );

  // GET /sys/g5r8t2/master/testers — lista todos os testers
  app.get(
    '/testers',
    { preHandler: [adminAuth] },
    async () => {
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
          subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, include: { plan: true } },
          numbers: { select: { phoneNumber: true, status: true } },
        },
        orderBy: { testerSince: 'desc' },
      });
      const testersOut = testers.map((u: any) => ({ ...u, subscription: primarySub(u.subscriptions) }));
      return { testers: testersOut, total: testersOut.length };
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
