/**
 * Testes do ledger de saldo de mensagens do módulo Campanhas
 * (CampanhaBalance/CampanhaBalanceTransaction) — lib/campanha-credit.ts.
 *
 * Política: 30 mensagens grátis por mês (não cumulativas) + saldo pago com
 * validade (extendida pra frente a cada compra) + assinatura Mensal Ilimitado
 * (plan === 'monthly', débito sempre passa e não mexe no saldo).
 */

type Balance = {
  id: string; userId: string;
  availableMessages: number;
  freeMessages: number; freeResetAt: Date | null;
  paidMessages: number; paidExpiresAt: Date | null;
  plan: string | null;
};

const balanceStore = new Map<string, Balance>();
let nextId = 1;

function balanceFor(userId: string): Balance {
  let b = balanceStore.get(userId);
  if (!b) {
    b = {
      id: `bal_${nextId++}`, userId,
      availableMessages: 0,
      freeMessages: 0, freeResetAt: null,
      paidMessages: 0, paidExpiresAt: null,
      plan: null,
    };
    balanceStore.set(userId, b);
  }
  return b;
}

function applyUpdate(b: Balance, data: any) {
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val && typeof val === 'object' && 'increment' in val) {
      (b as any)[key] += val.increment;
    } else if (val && typeof val === 'object' && 'decrement' in val) {
      (b as any)[key] -= val.decrement;
    } else {
      (b as any)[key] = val;
    }
  }
}

/** Aplica os filtros suportados de `where` (id exato + campos numéricos `{gte}`) contra um Balance. */
function matchesWhere(b: Balance, where: any): boolean {
  for (const key of Object.keys(where)) {
    if (key === 'id') { if (b.id !== where.id) return false; continue; }
    const cond = where[key];
    if (cond && typeof cond === 'object' && 'gte' in cond) {
      if ((b as any)[key] < cond.gte) return false;
    }
  }
  return true;
}

jest.mock('../lib/prisma', () => ({
  prisma: {
    campanhaBalance: {
      upsert: jest.fn(async ({ where }: any) => balanceFor(where.userId)),
      update: jest.fn(async ({ where, data }: any) => {
        const b = [...balanceStore.values()].find(x => x.id === where.id)!;
        applyUpdate(b, data);
        return b;
      }),
      // Espelha o UPDATE guardado real (WHERE id = ? AND col >= N): só aplica e conta
      // como sucesso (count:1) se o saldo atual satisfizer o `where`.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const b = [...balanceStore.values()].find(x => x.id === where.id);
        if (!b || !matchesWhere(b, where)) return { count: 0 };
        applyUpdate(b, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => balanceStore.get(where.userId) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const b = [...balanceStore.values()].find(x => x.id === where.id);
        if (!b) throw new Error('not found');
        return b;
      }),
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
  getOrCreateCampanhaBalance,
  InsufficientCampanhaBalanceError,
  CAMPANHA_FREE_MESSAGES_PER_MONTH,
} from '../lib/campanha-credit';

describe('campanha-credit', () => {
  beforeEach(() => {
    balanceStore.clear();
    nextId = 1;
    jest.clearAllMocks();
  });

  it('credita mensagens pagas e acumula saldo, com validade estendida', async () => {
    const r1 = await creditCampanhaMessages('u1', 1000, { referenceType: 'asaas_payment', referenceId: 'pay_1', validityDays: 90 });
    expect(r1.balanceAfter).toBe(1000);
    const r2 = await creditCampanhaMessages('u1', 500, { validityDays: 90 });
    expect(r2.balanceAfter).toBe(1500);
    const b = balanceFor('u1');
    expect(b.paidMessages).toBe(1500);
    expect(b.paidExpiresAt).not.toBeNull();
  });

  it('getOrCreateCampanhaBalance concede a cota grátis do mês na primeira leitura', async () => {
    const b = await getOrCreateCampanhaBalance('u1');
    expect(b.freeMessages).toBe(CAMPANHA_FREE_MESSAGES_PER_MONTH);
    expect(b.availableMessages).toBe(CAMPANHA_FREE_MESSAGES_PER_MONTH);
    expect(b.freeResetAt).not.toBeNull();

    // segunda leitura no mesmo mês não concede de novo
    const b2 = await getOrCreateCampanhaBalance('u1');
    expect(b2.freeMessages).toBe(CAMPANHA_FREE_MESSAGES_PER_MONTH);
  });

  it('débito consome primeiro a cota grátis, depois o saldo pago', async () => {
    await creditCampanhaMessages('u1', 1000, { validityDays: 90 });
    // saldo pago: 1000. + 30 grátis concedidos no débito = 1030 disponíveis.
    const { balanceAfter } = await debitCampanhaMessages('u1', 234, { referenceType: 'campanha', referenceId: 'c1' });
    expect(balanceAfter).toBe(1030 - 234);
    const b = balanceFor('u1');
    expect(b.freeMessages).toBe(0); // 30 grátis consumidas primeiro
    expect(b.paidMessages).toBe(1000 - 204); // resto (204) veio do saldo pago
  });

  it('débito só com saldo grátis (sem compra) funciona até o limite de 30', async () => {
    const { balanceAfter } = await debitCampanhaMessages('u1', 30);
    expect(balanceAfter).toBe(0);
    await expect(debitCampanhaMessages('u1', 1)).rejects.toBeInstanceOf(InsufficientCampanhaBalanceError);
  });

  it('lança InsufficientCampanhaBalanceError quando não há saldo suficiente (grátis + pago)', async () => {
    await creditCampanhaMessages('u1', 50, { validityDays: 90 });
    // 30 grátis + 50 pagas = 80 disponíveis
    await expect(debitCampanhaMessages('u1', 81)).rejects.toBeInstanceOf(InsufficientCampanhaBalanceError);
    // saldo não deve ter sido alterado pela tentativa de débito
    const balance = balanceFor('u1');
    expect(balance.availableMessages).toBe(80);
  });

  it('saldo pago vencido não é usável no débito (só a cota grátis conta)', async () => {
    await creditCampanhaMessages('u1', 1000, { validityDays: 90 });
    const b = balanceFor('u1');
    b.paidExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // já venceu
    await expect(debitCampanhaMessages('u1', 100)).rejects.toBeInstanceOf(InsufficientCampanhaBalanceError);
    // a cota grátis (30) sozinha ainda cobre um débito pequeno
    const { balanceAfter } = await debitCampanhaMessages('u1', 10);
    expect(balanceAfter).toBe(1000 + 30 - 10); // pago vencido continua intacto (não descontado)
  });

  it('plano Mensal Ilimitado nunca debita do saldo', async () => {
    const b = balanceFor('u1');
    b.plan = 'monthly';
    const { balanceAfter } = await debitCampanhaMessages('u1', 999999);
    expect(balanceAfter).toBe(b.availableMessages); // não mexeu em nada
    expect(b.availableMessages).toBe(0);
  });

  it('débito de valor inválido lança erro sem tocar o saldo', async () => {
    await creditCampanhaMessages('u1', 100, { validityDays: 90 });
    await expect(debitCampanhaMessages('u1', 0)).rejects.toThrow('Quantidade inválida.');
    await expect(debitCampanhaMessages('u1', -5)).rejects.toThrow('Quantidade inválida.');
  });

  it('estorno devolve mensagens ao saldo pago', async () => {
    await creditCampanhaMessages('u1', 1000, { validityDays: 90 });
    await debitCampanhaMessages('u1', 300); // usa 30 grátis + 270 pagas
    const { balanceAfter } = await refundCampanhaMessages('u1', 300, { referenceType: 'campanha', referenceId: 'c1' });
    expect(balanceAfter).toBe(1000 + 30 - 300 + 300);
  });

  it('saldos de usuários diferentes não se misturam', async () => {
    await creditCampanhaMessages('u1', 1000, { validityDays: 90 });
    await creditCampanhaMessages('u2', 50, { validityDays: 90 });
    expect(balanceFor('u1').paidMessages).toBe(1000);
    expect(balanceFor('u2').paidMessages).toBe(50);
  });

  it('débito concorrente (outra transação consome saldo entre a leitura e a escrita) nunca fica negativo', async () => {
    // Simula a corrida de verdade: duas requisições concorrentes (ex.: duplo-clique em
    // "Iniciar") leem o MESMO saldo (30 pagas) antes de qualquer uma escrever. Sem o
    // decremento guardado (WHERE ... >= N, ver debitCampanhaMessages), a 2ª escrita usaria
    // {decrement} sobre o valor JÁ debitado pela 1ª e produziria saldo negativo sem erro
    // nenhum — é exatamente isso que este teste prova que não acontece.
    const { prisma } = jest.requireMock('../lib/prisma') as any;
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    balanceStore.set('u1', {
      id: 'bal_race', userId: 'u1', availableMessages: 30,
      freeMessages: 0, freeResetAt: future, // cota grátis já concedida este mês — não interfere
      paidMessages: 30, paidExpiresAt: future,
      plan: null,
    });

    // upsert é o 1º read de cada chamada — na primeira vez que rodar, simula a "outra
    // transação" comitando um débito concorrente de 30 mensagens ANTES desta continuar.
    let firstCall = true;
    (prisma.campanhaBalance.upsert as jest.Mock).mockImplementationOnce(async ({ where }: any) => {
      const snapshot = { ...balanceFor(where.userId) };
      if (firstCall) {
        firstCall = false;
        const real = balanceFor(where.userId);
        real.paidMessages -= 30;
        real.availableMessages -= 30; // saldo real já foi pra 0 por uma transação concorrente
      }
      return snapshot; // esta chamada só sabe do saldo de ANTES da corrida (30)
    });

    await expect(debitCampanhaMessages('u1', 30)).rejects.toBeInstanceOf(InsufficientCampanhaBalanceError);
    // Saldo real (pós corrida) permanece o que a "outra transação" deixou — nunca vai a -30.
    expect(balanceFor('u1').availableMessages).toBe(0);
    expect(balanceFor('u1').availableMessages).toBeGreaterThanOrEqual(0);
  });
});
