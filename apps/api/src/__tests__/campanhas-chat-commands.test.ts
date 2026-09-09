/**
 * Testes do bot de comandos do Chatbot Campanhas (self-chat "campanha ...").
 * Mocka toda a infraestrutura reaproveitada (prisma, moduleGate, evolution,
 * campanhas.ts, campanha-credit.ts, billing.ts) — foco no roteamento de
 * estágios da CampanhaChatSession e nas decisões de negócio (saldo, limite
 * diário, cancelamento).
 */

const sessions = new Map<string, any>();
const campanhas = new Map<string, any>();
let campanhaSeq = 1;

jest.mock('../lib/prisma', () => ({
  prisma: {
    campanhaChatSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.phone) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const exists = sessions.has(where.phone);
        const row = exists ? { ...sessions.get(where.phone), ...update } : { phone: where.phone, ...create };
        sessions.set(where.phone, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...sessions.get(where.phone), ...data };
        sessions.set(where.phone, row);
        return row;
      }),
    },
    campanha: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `camp_${campanhaSeq++}`, status: 'draft', audienceCount: 0, ...data };
        campanhas.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...campanhas.get(where.id), ...data };
        campanhas.set(where.id, row);
        return row;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => campanhas.get(where.id)),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = campanhas.get(where.id);
        if (!row) return null;
        if (where.status && row.status !== where.status) return null;
        if (where.userId && row.userId !== where.userId) return null;
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const row = campanhas.get(where.id);
        if (row && (!where.status || row.status === where.status)) campanhas.delete(where.id);
        return { count: row ? 1 : 0 };
      }),
    },
    campanhaContato: { createMany: jest.fn(async () => ({ count: 0 })) },
    campanhaOptOut:  { findMany: jest.fn(async () => []) },
  },
}));

jest.mock('../services/evolution', () => ({ sendText: jest.fn(async () => ({ id: 'msg_1' })) }));
jest.mock('../lib/moduleGate', () => ({ getUserModules: jest.fn(async () => ['campanhas']) }));
jest.mock('../routes/modules/campanhas', () => ({
  warmContactsForNumber: jest.fn(async () => new Map([['5511999990001', 'Fulano'], ['5511999990002', null]])),
  enqueueCampanhaSend:    jest.fn(async () => 2),
}));
jest.mock('../lib/campanha-credit', () => {
  const actual = jest.requireActual('../lib/campanha-credit');
  return {
    InsufficientCampanhaBalanceError: actual.InsufficientCampanhaBalanceError,
    getOrCreateCampanhaBalance: jest.fn(async () => ({ availableMessages: 100, plan: null, renewalDate: null })),
    debitCampanhaMessages:      jest.fn(async () => ({ balanceAfter: 98 })),
  };
});
jest.mock('../routes/billing', () => ({
  CAMPANHA_MSG_PACKAGES: [{ id: 'pkg_camp_1k', messages: 1000, priceBrl: 200, label: '1.000 mensagens', desc: 'Pré-Pago 1' }],
  CAMPANHA_MONTHLY_MESSAGES: 2000,
  CAMPANHA_MONTHLY_PRICE_BRL: 299,
  buyCampanhaMessagesViaPix:      jest.fn(async () => ({ ok: true, data: { paymentId: 'pay_1', copyPaste: '00020126pix' } })),
  subscribeCampanhaMonthlyViaPix: jest.fn(async () => ({ ok: true, data: { paymentId: 'pay_2', copyPaste: '00020126pixsub' } })),
}));

import { sendText } from '../services/evolution';
import { getUserModules } from '../lib/moduleGate';
import { getOrCreateCampanhaBalance, debitCampanhaMessages } from '../lib/campanha-credit';
import {
  isCampanhaChatCommand, handleCampanhaChatCommand, handleCampanhaChatReply,
} from '../services/campanhas-chat-commands';

const ctx = (text: string) => ({ userId: 'u1', numberId: 'num1', instanceName: 'inst1', selfPhone: '5511900000000', text });

function lastReply(): string {
  const calls = (sendText as jest.Mock).mock.calls;
  return calls[calls.length - 1][2];
}

describe('campanhas-chat-commands', () => {
  beforeEach(() => {
    sessions.clear();
    campanhas.clear();
    campanhaSeq = 1;
    jest.clearAllMocks();
    (getUserModules as jest.Mock).mockResolvedValue(['campanhas']);
    (getOrCreateCampanhaBalance as jest.Mock).mockResolvedValue({ availableMessages: 100, plan: null, renewalDate: null });
  });

  it('isCampanhaChatCommand reconhece só o prefixo "campanha"', () => {
    expect(isCampanhaChatCommand('campanha nova')).toBe(true);
    expect(isCampanhaChatCommand('Campanha saldo')).toBe(true);
    expect(isCampanhaChatCommand('oi tudo bem?')).toBe(false);
  });

  it('handleCampanhaChatReply não trata nada quando não há sessão ativa', async () => {
    const handled = await handleCampanhaChatReply(ctx('qualquer coisa'));
    expect(handled).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('"campanha nova" sem o módulo contratado orienta a contratar', async () => {
    (getUserModules as jest.Mock).mockResolvedValueOnce([]);
    await handleCampanhaChatCommand(ctx('campanha nova'));
    expect(lastReply()).toMatch(/módulo Campanhas/i);
    expect(sessions.get('5511900000000')).toBeUndefined();
  });

  it('"campanha nova" no limite diário recusa', async () => {
    const { prisma } = jest.requireMock('../lib/prisma') as any;
    (prisma.campanha.count as jest.Mock).mockResolvedValueOnce(10);
    await handleCampanhaChatCommand(ctx('campanha nova'));
    expect(lastReply()).toMatch(/limite diário/i);
  });

  it('fluxo completo: nova → mensagem → preview → confirma → dispara e debita', async () => {
    await handleCampanhaChatCommand(ctx('campanha nova'));
    expect(sessions.get('5511900000000').stage).toBe('awaiting_message');

    await handleCampanhaChatReply(ctx('Aproveite 50% OFF!'));
    const session = sessions.get('5511900000000');
    expect(session.stage).toBe('previewing');
    expect(lastReply()).toMatch(/2 contatos/);

    await handleCampanhaChatReply(ctx('👍'));
    expect(debitCampanhaMessages).toHaveBeenCalledWith('u1', 2, expect.objectContaining({ referenceType: 'campanha' }));
    expect(campanhas.get(session.campanhaId).status).toBe('running');
    expect(sessions.get('5511900000000').stage).toBe('idle');
    expect(lastReply()).toMatch(/Disparo iniciado/);
  });

  it('preview: ❌ cancela e apaga o rascunho', async () => {
    await handleCampanhaChatCommand(ctx('campanha nova'));
    await handleCampanhaChatReply(ctx('promo'));
    const campanhaId = sessions.get('5511900000000').campanhaId;

    await handleCampanhaChatReply(ctx('❌'));
    expect(campanhas.has(campanhaId)).toBe(false);
    expect(sessions.get('5511900000000').stage).toBe('idle');
  });

  it('preview: ✏️ volta para aguardar nova mensagem, mantendo a campanha em rascunho', async () => {
    await handleCampanhaChatCommand(ctx('campanha nova'));
    await handleCampanhaChatReply(ctx('promo v1'));
    const campanhaId = sessions.get('5511900000000').campanhaId;

    await handleCampanhaChatReply(ctx('editar'));
    expect(sessions.get('5511900000000').stage).toBe('awaiting_message');

    await handleCampanhaChatReply(ctx('promo v2'));
    expect(campanhas.get(campanhaId).messageBody).toBe('promo v2');
    expect(sessions.get('5511900000000').campanhaId).toBe(campanhaId); // reaproveitou o rascunho, não criou outro
  });

  it('saldo insuficiente na confirmação oferece compra e não dispara', async () => {
    (getOrCreateCampanhaBalance as jest.Mock).mockResolvedValue({ availableMessages: 1, plan: null, renewalDate: null });
    await handleCampanhaChatCommand(ctx('campanha nova'));
    await handleCampanhaChatReply(ctx('promo'));

    await handleCampanhaChatReply(ctx('👍'));
    expect(debitCampanhaMessages).not.toHaveBeenCalled();
    expect(sessions.get('5511900000000').stage).toBe('awaiting_purchase');
    expect(lastReply()).toMatch(/Saldo insuficiente/);
  });

  it('sem contatos "quentes" cancela a criação e volta pra idle', async () => {
    const { warmContactsForNumber } = jest.requireMock('../routes/modules/campanhas') as any;
    (warmContactsForNumber as jest.Mock).mockResolvedValueOnce(new Map());
    await handleCampanhaChatCommand(ctx('campanha nova'));
    await handleCampanhaChatReply(ctx('promo'));
    expect(sessions.get('5511900000000').stage).toBe('idle');
    expect(lastReply()).toMatch(/Não encontrei ninguém/);
  });

  it('"campanha comprar" e escolha de pacote geram o Pix', async () => {
    await handleCampanhaChatCommand(ctx('campanha comprar'));
    expect(sessions.get('5511900000000').stage).toBe('awaiting_purchase');

    await handleCampanhaChatReply(ctx('1'));
    expect(lastReply()).toMatch(/00020126pix/);
  });

  it('"campanha cancelar" limpa a sessão e apaga rascunho pendente', async () => {
    await handleCampanhaChatCommand(ctx('campanha nova'));
    await handleCampanhaChatReply(ctx('promo'));
    const campanhaId = sessions.get('5511900000000').campanhaId;

    await handleCampanhaChatCommand(ctx('campanha cancelar'));
    expect(campanhas.has(campanhaId)).toBe(false);
    expect(sessions.get('5511900000000').stage).toBe('idle');
  });
});
