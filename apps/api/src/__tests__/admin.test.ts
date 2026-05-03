/**
 * Testes das rotas administrativas.
 */
import Fastify from 'fastify';
import crypto from 'crypto';

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { count: jest.fn() },
    subscription: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    transcription: { count: jest.fn() },
    usageLog: {
      aggregate: jest.fn(),
    },
    systemError: {
      findMany: jest.fn(),
    },
    supportTicket: {
      count: jest.fn(),
    },
    whatsappNumber: {
      count: jest.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(import('../routes/admin'), { prefix: '/admin' });
  await app.ready();
  return app;
}

describe('GET /admin/stats', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const VALID_TOKEN = process.env.ADMIN_TOKEN || 'test-token';

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem token válido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: { 'x-admin-token': 'invalid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna estatísticas com token válido', async () => {
    // Mock todas as queries
    (prisma.user.count as jest.Mock).mockResolvedValue(10);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'free' } },
      { plan: { name: 'pro' } },
    ]);
    (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
      { status: 'active', _count: { status: 8 } },
      { status: 'canceled', _count: { status: 2 } },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValue(100);
    (prisma.usageLog.aggregate as jest.Mock).mockResolvedValue({
      _sum: { minutesUsed: 500 },
    });
    (prisma.systemError.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(5);
    (prisma.whatsappNumber.count as jest.Mock).mockResolvedValue(20);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: { 'x-admin-token': VALID_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('users');
    expect(body).toHaveProperty('transcriptions');
    expect(body).toHaveProperty('minutes');
    expect(body).toHaveProperty('mrr');
    expect(body).toHaveProperty('conversion');
  });

  it('calcula MRR corretamente', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(10);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'pro' } },  // $29.90
      { plan: { name: 'ultra' } }, // $59.90
    ]);
    (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
      { status: 'active', _count: { status: 2 } },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValue(0);
    (prisma.usageLog.aggregate as jest.Mock).mockResolvedValue({ _sum: { minutesUsed: 0 } });
    (prisma.systemError.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(0);
    (prisma.whatsappNumber.count as jest.Mock).mockResolvedValue(0);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: { 'x-admin-token': VALID_TOKEN },
    });

    const body = res.json();
    // pro: 29.90, ultra: 59.90, total = 89.80
    expect(body.mrr).toBeCloseTo(89.80, 1);
  });

  it('calcula conversion rate corretamente', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(100);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'free' } },
      { plan: { name: 'free' } },
      // ... 98 free users
      { plan: { name: 'pro' } },
      { plan: { name: 'pro' } },
    ]);
    (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
      { status: 'active', _count: { status: 100 } },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValue(0);
    (prisma.usageLog.aggregate as jest.Mock).mockResolvedValue({ _sum: { minutesUsed: 0 } });
    (prisma.systemError.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(0);
    (prisma.whatsappNumber.count as jest.Mock).mockResolvedValue(0);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: { 'x-admin-token': VALID_TOKEN },
    });

    const body = res.json();
    // 2 paid / 100 users = 2%
    expect(body.conversion.rate).toBe(2);
  });
});
