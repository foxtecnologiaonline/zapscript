/**
 * Testes das rotas administrativas.
 */
import Fastify from 'fastify';

// Mock de supabase (admin.ts importa createClient no top-level)
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      admin: {
        deleteUser: jest.fn().mockResolvedValue({ error: null }),
      },
    },
  })),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn(),
      update: jest.fn(),
    },
    transcription: { count: jest.fn() },
    usageLog: { aggregate: jest.fn() },
    systemError: { findMany: jest.fn() },
    supportTicket: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    whatsappNumber: { count: jest.fn() },
    plan: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      user: { update: jest.fn().mockResolvedValue({ id: 'u1' }) },
      subscription: { update: jest.fn() },
      minuteBalance: { update: jest.fn() },
    })),
  },
}));

import { prisma } from '../lib/prisma';

const VALID_TOKEN = 'test-admin-token';

async function buildApp() {
  process.env.ADMIN_TOKEN = VALID_TOKEN;
  const app = Fastify({ logger: false });
  await app.register(import('../routes/admin'), { prefix: '/admin' });
  await app.ready();
  return app;
}

describe('GET /admin/stats', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 sem token válido', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/stats',
      headers: { 'x-admin-token': 'invalid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna estatísticas com token válido', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(10);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'free' } },
      { plan: { name: 'pro' } },
    ]);
    (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
      { status: 'active', _count: { status: 8 } },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValue(100);
    (prisma.usageLog.aggregate as jest.Mock).mockResolvedValue({ _sum: { minutesUsed: 500 } });
    (prisma.systemError.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(5);
    (prisma.whatsappNumber.count as jest.Mock).mockResolvedValue(20);

    const res = await app.inject({
      method: 'GET', url: '/admin/stats',
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

  it('calcula MRR pro + executive corretamente', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(2);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'pro' } },       // R$39.90
      { plan: { name: 'executive' } }, // R$49.90
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
      method: 'GET', url: '/admin/stats',
      headers: { 'x-admin-token': VALID_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mrr).toBeCloseTo(79.80, 1);
  });

  it('calcula conversion rate corretamente', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(100);
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
      { plan: { name: 'free' } },
      { plan: { name: 'pro' } },
      { plan: { name: 'pro' } },
    ]);
    (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
      { status: 'active', _count: { status: 3 } },
    ]);
    (prisma.transcription.count as jest.Mock).mockResolvedValue(0);
    (prisma.usageLog.aggregate as jest.Mock).mockResolvedValue({ _sum: { minutesUsed: 0 } });
    (prisma.systemError.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(0);
    (prisma.whatsappNumber.count as jest.Mock).mockResolvedValue(0);

    const res = await app.inject({
      method: 'GET', url: '/admin/stats',
      headers: { 'x-admin-token': VALID_TOKEN },
    });

    // 2 paid / 100 users = 2%
    expect(res.json().conversion.rate).toBe(2);
  });
});
