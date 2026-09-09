/**
 * Testes do ledger de saldo de mensagens do Chatbot Campanhas
 * (CampanhaBalance/CampanhaBalanceTransaction) — lib/campanha-credit.ts.
 */

const balanceStore = new Map<string, { id: string; userId: string; availableMessages: number }>();
let nextId = 1;

function balanceFor(userId: string) {
  let b = balanceStore.get(userId);
  if (!b) {
    b = { id: `bal_${nextId++}`, userId, availableMessages: 0 };
    balanceStore.set(userId, b);
  }
  return b;
}

jest.mock('../lib/prisma', () => ({
  prisma: {
    campanhaBalance: {
      upsert: jest.fn(async ({ where }: any) => balanceFor(where.userId)),
      update: jest.fn(async ({ where, data }: any) => {
        const b = [...balanceStore.values()].find(x => x.id === where.id)!;
        if (data.availableMessages?.increment !== undefined) b.availableMessages += data.availableMessages.increment;
        return b;
      }),
      findUnique: jest.fn(async ({ where }: any) => balanceStore.get(where.userId) ?? null),
    },
    campanhaBalanceTransaction: {
      create: jest.fn(async ({ data }: any) => data),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    $transaction: jest.fn(async (fn: any) => fn({
      campanhaBalance: (jest.requireMock('../lib/prisma') as any).prisma.campanhaBalance,
      campanhaBalanceTransaction: (jest.requireMock('../lib/prisma') as any).prisma.campanhaBalanceTransaction,
    })),
  },
}));

import {
  creditCampanhaMessages,
  debitCampanhaMessages,
  refundCampanhaMessages,
  InsufficientCampanhaBalanceError,
} from '../lib/campanha-credit';

describe('campanha-credit', () => {
  beforeEach(() => {
    balanceStore.clear();
    nextId = 1;
    jest.clearAllMocks();
  });

  it('credita mensagens e acumula saldo', async () => {
    const r1 = await creditCampanhaMessages('u1', 1000, { referenceType: 'asaas_payment', referenceId: 'pay_1' });
    expect(r1.balanceAfter).toBe(1000);
    const r2 = await creditCampanhaMessages('u1', 500);
    expect(r2.balanceAfter).toBe(1500);
  });

  it('débito reduz o saldo e registra o lançamento', async () => {
    await creditCampanhaMessages('u1', 1000);
    const { balanceAfter } = await debitCampanhaMessages('u1', 234, { referenceType: 'campanha', referenceId: 'c1' });
    expect(balanceAfter).toBe(766);
  });

  it('lança InsufficientCampanhaBalanceError quando não há saldo suficiente', async () => {
    await creditCampanhaMessages('u1', 100);
    await expect(debitCampanhaMessages('u1', 101)).rejects.toBeInstanceOf(InsufficientCampanhaBalanceError);
    // saldo não deve ter sido alterado pela tentativa de débito
    const balance = balanceFor('u1');
    expect(balance.availableMessages).toBe(100);
  });

  it('débito de valor inválido lança erro sem tocar o saldo', async () => {
    await creditCampanhaMessages('u1', 100);
    await expect(debitCampanhaMessages('u1', 0)).rejects.toThrow('Quantidade inválida.');
    await expect(debitCampanhaMessages('u1', -5)).rejects.toThrow('Quantidade inválida.');
  });

  it('estorno devolve mensagens ao saldo', async () => {
    await creditCampanhaMessages('u1', 1000);
    await debitCampanhaMessages('u1', 300);
    const { balanceAfter } = await refundCampanhaMessages('u1', 300, { referenceType: 'campanha', referenceId: 'c1' });
    expect(balanceAfter).toBe(1000);
  });

  it('saldos de usuários diferentes não se misturam', async () => {
    await creditCampanhaMessages('u1', 1000);
    await creditCampanhaMessages('u2', 50);
    expect(balanceFor('u1').availableMessages).toBe(1000);
    expect(balanceFor('u2').availableMessages).toBe(50);
  });
});
