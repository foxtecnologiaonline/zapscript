/**
 * Testes da correção de planos no admin (PATCH /users/:id, bulk set-plan —
 * profissional/empresas passam a ser aceitos e sincronizam os módulos do
 * bundle via activatePlan(); 'ultra' deixa de ser uma opção válida por não
 * existir como Plan de verdade) e da concessão de cortesia de saldo/plano
 * Mensal Ilimitado do módulo Campanhas pra um usuário específico
 * (POST /users/:id/campanha-grant).
 */
process.env.ADMIN_TOKEN    = 'test-admin-token';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.ASAAS_API_KEY  = process.env.ASAAS_API_KEY || 'test-key';

import Fastify from 'fastify';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { admin: { deleteUser: jest.fn() } } })),
}));

jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

type Plan = { id: string; name: string; minutesPerMonth: number; audiosPerMonth: number; priceBrl: number };
type Sub = { id: string; userId: string; planId: string; status: string; currentPeriodEnd: Date | null; comboDiscountPct: number | null };
type Ent = { id: string; userId: string; productKey: string; status: string; source: string; canceledAt: Date | null };
type CampBal = {
  id: string; userId: string; availableMessages: number;
  freeMessages: number; freeResetAt: Date | null;
  paidMessages: number; paidExpiresAt: Date | null;
  plan: string | null; renewalDate: Date | null;
};

const users = new Map<string, { id: string; email: string }>();
const plans = new Map<string, Plan>();
const subs  = new Map<string, Sub>();
const minuteBalances = new Map<string, any>();
const ents  = new Map<string, Ent>(); // key: `${userId}:${productKey}`
const campBalances = new Map<string, CampBal>();
let seq = 1;

function seedPlan(name: string, over: Partial<Plan> = {}) {
  plans.set(name, { id: `plan_${name}`, name, minutesPerMonth: 999, audiosPerMonth: 500, priceBrl: 0, ...over });
}
function applyUpdate(obj: any, data: any) {
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val && typeof val === 'object' && 'increment' in val) obj[key] += val.increment;
    else if (val && typeof val === 'object' && 'decrement' in val) obj[key] -= val.decrement;
    else obj[key] = val;
  }
}

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const u = users.get(where.id)!; applyUpdate(u, data); return u; }),
    },
    plan: {
      findUnique: jest.fn(async ({ where }: any) => plans.get(where.name) ?? null),
    },
    subscription: {
      findUnique: jest.fn(async ({ where }: any) => subs.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const exists = subs.has(where.userId);
        const row = exists ? { ...subs.get(where.userId), ...update } : { id: `sub_${seq++}`, userId: where.userId, ...create };
        subs.set(where.userId, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = subs.get(where.userId)!;
        applyUpdate(row, data);
        return row;
      }),
    },
    minuteBalance: {
      findUnique: jest.fn(async ({ where }: any) => minuteBalances.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const exists = minuteBalances.has(where.userId);
        const row = exists ? { ...minuteBalances.get(where.userId), ...update } : { userId: where.userId, ...create };
        minuteBalances.set(where.userId, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = minuteBalances.get(where.userId)!;
        applyUpdate(row, data);
        return row;
      }),
    },
    entitlement: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.userId_productKey.userId}:${where.userId_productKey.productKey}`;
        const exists = ents.has(key);
        const row = exists ? { ...ents.get(key), ...update } : { id: `ent_${seq++}`, ...create };
        ents.set(key, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of ents.values()) {
          if (row.userId !== where.userId) continue;
          if (where.source && row.source !== where.source) continue;
          if (where.status?.in && !where.status.in.includes(row.status)) continue;
          if (where.productKey?.notIn && where.productKey.notIn.includes(row.productKey)) continue;
          applyUpdate(row, data);
          count++;
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) => [...ents.values()].filter((e) => e.userId === where.userId)),
    },
    campanhaBalance: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const exists = campBalances.has(where.userId);
        const row: CampBal = exists
          ? (() => { const b = campBalances.get(where.userId)!; applyUpdate(b, update); return b; })()
          : { id: `camp_${seq++}`, userId: where.userId, availableMessages: 0, freeMessages: 0, freeResetAt: null, paidMessages: 0, paidExpiresAt: null, plan: null, renewalDate: null, ...create };
        campBalances.set(where.userId, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = [...campBalances.values()].find((b) => b.id === where.id)!;
        applyUpdate(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of campBalances.values()) {
          if (row.userId !== where.userId) continue;
          if (where.plan && row.plan !== where.plan) continue;
          applyUpdate(row, data);
          count++;
        }
        return { count };
      }),
    },
    campanhaBalanceTransaction: {
      create: jest.fn(async ({ data }: any) => data),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const { prisma } = jest.requireMock('../lib/prisma') as any;
      return arg(prisma);
    }),
  },
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(import('../routes/admin'), { prefix: '/sys/g5r8t2' });
  await app.ready();
  return app;
}

const H = { 'x-admin-token': 'test-admin-token' };

describe('PATCH /sys/g5r8t2/users/:id — planos', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    users.clear(); plans.clear(); subs.clear(); minuteBalances.clear(); ents.clear(); campBalances.clear();
    seq = 1;
    users.set('u1', { id: 'u1', email: 'u1@x.com' });
    seedPlan('free', { priceBrl: 0, audiosPerMonth: 200 });
    seedPlan('profissional', { priceBrl: 49, audiosPerMonth: 500 });
    seedPlan('empresas', { priceBrl: 99, audiosPerMonth: 500 });
    subs.set('u1', { id: 'sub_u1', userId: 'u1', planId: 'plan_free', status: 'active', currentPeriodEnd: null, comboDiscountPct: null });
  });

  it('rejeita "ultra" — não é um plano válido', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/sys/g5r8t2/users/u1',
      headers: H, payload: { planName: 'ultra' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/plano inválido/i);
  });

  it('aceita "profissional" e sincroniza o módulo do bundle (atende)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/sys/g5r8t2/users/u1',
      headers: H, payload: { planName: 'profissional' },
    });
    expect(res.statusCode).toBe(200);
    expect(subs.get('u1')?.planId).toBe('plan_profissional');
    expect(subs.get('u1')?.status).toBe('active');
    expect(ents.get('u1:atende')?.status).toBe('active');
    expect(ents.get('u1:atende')?.source).toBe('bundle');
    expect(ents.get('u1:tarefas')?.status).toBe('active');
  });

  it('aceita "empresas" e inclui crm no bundle (além de atende/tarefas)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/sys/g5r8t2/users/u1',
      headers: H, payload: { planName: 'empresas' },
    });
    expect(res.statusCode).toBe(200);
    expect(ents.get('u1:crm')?.status).toBe('active');
  });

  it('downgrade pra "free" revoga os módulos do bundle', async () => {
    ents.set('u1:atende', { id: 'ent_1', userId: 'u1', productKey: 'atende', status: 'active', source: 'bundle', canceledAt: null });
    subs.set('u1', { id: 'sub_u1', userId: 'u1', planId: 'plan_profissional', status: 'active', currentPeriodEnd: new Date(), comboDiscountPct: null });

    const res = await app.inject({
      method: 'PATCH', url: '/sys/g5r8t2/users/u1',
      headers: H, payload: { planName: 'free' },
    });
    expect(res.statusCode).toBe(200);
    expect(subs.get('u1')?.planId).toBe('plan_free');
    expect(subs.get('u1')?.status).toBe('canceled');
    expect(ents.get('u1:atende')?.status).toBe('canceled');
  });
});

describe('POST /sys/g5r8t2/users/bulk-action — set-plan', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    users.clear(); plans.clear(); subs.clear(); minuteBalances.clear(); ents.clear(); campBalances.clear();
    seq = 1;
    users.set('u1', { id: 'u1', email: 'u1@x.com' });
    seedPlan('free', { priceBrl: 0 });
    seedPlan('profissional', { priceBrl: 49 });
    subs.set('u1', { id: 'sub_u1', userId: 'u1', planId: 'plan_free', status: 'active', currentPeriodEnd: null, comboDiscountPct: null });
  });

  it('set-plan em lote pra "profissional" sincroniza o bundle igual ao PATCH individual', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/bulk-action',
      headers: H, payload: { userIds: ['u1'], action: 'set-plan', value: 'profissional' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().affected).toBe(1);
    expect(subs.get('u1')?.planId).toBe('plan_profissional');
    expect(ents.get('u1:atende')?.status).toBe('active');
  });
});

describe('POST /sys/g5r8t2/users/:id/campanha-grant', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    users.clear(); campBalances.clear();
    seq = 1;
    users.set('u1', { id: 'u1', email: 'u1@x.com' });
  });

  it('type=messages credita o saldo pago com a validade informada', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/u1/campanha-grant',
      headers: H, payload: { type: 'messages', messages: 500, validityDays: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().balanceAfter).toBeGreaterThanOrEqual(500);
    const b = campBalances.get('u1')!;
    expect(b.paidMessages).toBe(500);
    expect(b.paidExpiresAt).not.toBeNull();
  });

  it('type=unlimited concede o Mensal Ilimitado por N dias', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/u1/campanha-grant',
      headers: H, payload: { type: 'unlimited', days: 45 },
    });
    expect(res.statusCode).toBe(200);
    expect(campBalances.get('u1')?.plan).toBe('monthly');
    expect(campBalances.get('u1')?.renewalDate).not.toBeNull();
  });

  it('type=revoke-unlimited limpa o plano concedido', async () => {
    campBalances.set('u1', {
      id: 'camp_1', userId: 'u1', availableMessages: 0,
      freeMessages: 0, freeResetAt: null, paidMessages: 0, paidExpiresAt: null,
      plan: 'monthly', renewalDate: new Date(),
    });
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/u1/campanha-grant',
      headers: H, payload: { type: 'revoke-unlimited' },
    });
    expect(res.statusCode).toBe(200);
    expect(campBalances.get('u1')?.plan).toBeNull();
  });

  it('type=messages sem "messages" retorna 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/u1/campanha-grant',
      headers: H, payload: { type: 'messages' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('usuário inexistente retorna 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sys/g5r8t2/users/nope/campanha-grant',
      headers: H, payload: { type: 'unlimited' },
    });
    expect(res.statusCode).toBe(404);
  });
});
