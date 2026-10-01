/**
 * Testes do fluxo conversacional do ZapMonney: fechamento de mês no fuso de
 * São Paulo, onboarding com consentimento, ciclo pendente → confirmado e as
 * duas ações destrutivas (apagar último, apagar conta).
 *
 * O que estes testes protegem, em ordem de dano: lançamento que entra no saldo
 * sem a pessoa confirmar, despesa que cai no mês errado, e exclusão de conta
 * disparada por uma frase solta.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    zmUser: {
      findUnique: jest.fn(),
      create:     jest.fn(),
      update:     jest.fn().mockResolvedValue({}),
      delete:     jest.fn().mockResolvedValue({}),
    },
    zmTransaction: {
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      create:     jest.fn(),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy:    jest.fn(),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Evita construir os clients dos SDKs no module load do agente.
jest.mock('../services/ai-fallback', () => ({
  buildModelChain:    jest.fn(() => []),
  callAiWithFallback: jest.fn(),
}));

jest.mock('../services/zapmonney-agent', () => ({
  ...jest.requireActual('../services/zapmonney-agent'),
  classifyZapMonneyMessage: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { classifyZapMonneyMessage } from '../services/zapmonney-agent';
import {
  handleZapMonneyMessage, todayBrt, occurredAtFrom, monthRangeBrt,
} from '../services/zapmonney-executor';

const classify = classifyZapMonneyMessage as jest.Mock;
const PHONE = '5511988887777';

function activeUser(over: Record<string, unknown> = {}) {
  (prisma.zmUser.findUnique as jest.Mock).mockResolvedValueOnce({
    id: 'zm1', phone: PHONE, name: 'Maria Souza', stage: 'active', userId: null, ...over,
  });
}

function noPending() {
  (prisma.zmTransaction.findFirst as jest.Mock).mockResolvedValueOnce(null);
}

function withPending(over: Record<string, unknown> = {}) {
  (prisma.zmTransaction.findFirst as jest.Mock).mockResolvedValueOnce({
    id: 'tx1', type: 'expense', amount: '50.00', category: 'Alimentação',
    description: 'mercado', occurredAt: new Date('2026-10-01T15:00:00Z'), ...over,
  });
}

function intent(name: string, data: Record<string, unknown> = {}) {
  classify.mockResolvedValueOnce({ intent: name, confidence: 90, data });
}

beforeEach(() => jest.clearAllMocks());

describe('datas no fuso de São Paulo', () => {
  it('todayBrt usa o dia de São Paulo, não o de UTC', () => {
    // 02/10 01:00 UTC ainda é 01/10 22:00 em São Paulo.
    expect(todayBrt(new Date('2026-10-02T01:00:00Z'))).toBe('2026-10-01');
    expect(todayBrt(new Date('2026-10-02T04:00:00Z'))).toBe('2026-10-02');
  });

  it('occurredAtFrom grava meio-dia BRT (15:00 UTC) da data informada', () => {
    expect(occurredAtFrom('2026-09-20', new Date('2026-10-01T12:00:00Z')).toISOString())
      .toBe('2026-09-20T15:00:00.000Z');
  });

  it('occurredAtFrom cai em hoje quando a data vem no futuro', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(occurredAtFrom('2027-01-05', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('occurredAtFrom cai em hoje quando a data vem inválida', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(occurredAtFrom(undefined, now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(occurredAtFrom('ontem', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('monthRangeBrt abre o mês às 00:00 BRT (03:00 UTC)', () => {
    const r = monthRangeBrt('mes_atual', new Date('2026-10-15T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(r.label).toBe('outubro de 2026');
  });

  it('monthRangeBrt vira o ano ao pedir o mês passado em janeiro', () => {
    const r = monthRangeBrt('mes_passado', new Date('2026-01-10T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2025-12-01T03:00:00.000Z');
    expect(r.label).toBe('dezembro de 2025');
  });
});

describe('onboarding', () => {
  it('cria ZmUser e pede consentimento na primeira mensagem', async () => {
    (prisma.zmUser.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.zmUser.create as jest.Mock).mockResolvedValueOnce({
      id: 'zm1', phone: PHONE, name: 'Maria Souza', stage: 'awaiting_consent',
    });

    const reply = await handleZapMonneyMessage({ phone: PHONE, pushName: 'Maria Souza', text: 'oi' });

    expect(prisma.zmUser.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ phone: PHONE, stage: 'awaiting_consent' }),
    }));
    expect(reply).toContain('ZapMonney');
    expect(reply).toContain('Maria');
    expect(classify).not.toHaveBeenCalled();
  });

  it('vincula a conta ZapScript quando o telefone já existe no produto', async () => {
    (prisma.zmUser.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'user-zs-1' });
    (prisma.zmUser.create as jest.Mock).mockResolvedValueOnce({ id: 'zm1', name: null, stage: 'awaiting_consent' });

    await handleZapMonneyMessage({ phone: PHONE, text: 'oi' });

    expect(prisma.zmUser.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-zs-1' }),
    }));
  });

  it('ativa a conta no "sim" sem gastar chamada de IA', async () => {
    activeUser({ stage: 'awaiting_consent' });

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'sim' });

    expect(prisma.zmUser.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: 'active' }),
    }));
    expect(reply).toContain('Como usar');
    expect(classify).not.toHaveBeenCalled();
  });

  it('repete o pedido de consentimento quando a resposta não é sim nem não', async () => {
    activeUser({ stage: 'awaiting_consent' });

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'quem é você?' });

    expect(reply).toContain('Posso começar?');
    expect(prisma.zmUser.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'active' }) }),
    );
  });

  it('não responde nada a usuário bloqueado', async () => {
    activeUser({ stage: 'blocked' });

    expect(await handleZapMonneyMessage({ phone: PHONE, text: 'oi' })).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });
});

describe('ciclo pendente → confirmado', () => {
  it('cria lançamento pendente e pede confirmação, sem salvar no saldo', async () => {
    activeUser();
    noPending();
    intent('add_expense', { valor: 50, categoria: 'Alimentação', descricao: 'mercado', data: '2026-10-01' });
    (prisma.zmTransaction.create as jest.Mock).mockResolvedValueOnce({
      type: 'expense', amount: '50.00', category: 'Alimentação',
      description: 'mercado', occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    const reply = await handleZapMonneyMessage({
      phone: PHONE, text: 'gastei 50 no mercado', sourceMsgId: 'MSG1',
    });

    expect(prisma.zmTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        zmUserId: 'zm1', type: 'expense', amount: '50.00',
        category: 'Alimentação', status: 'pending', sourceMsgId: 'MSG1',
      }),
    }));
    expect(reply).toContain('Confirma?');
  });

  it('descarta o pendente anterior antes de abrir um novo', async () => {
    activeUser();
    withPending();
    intent('add_expense', { valor: 20, categoria: 'Transporte' });
    (prisma.zmTransaction.create as jest.Mock).mockResolvedValueOnce({
      type: 'expense', amount: '20.00', category: 'Transporte',
      description: null, occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    await handleZapMonneyMessage({ phone: PHONE, text: 'uber 20' });

    expect(prisma.zmTransaction.updateMany).toHaveBeenCalledWith({
      where: { zmUserId: 'zm1', status: 'pending' },
      data:  { status: 'discarded' },
    });
  });

  it('pede o valor de novo quando a extração não traz valor', async () => {
    activeUser();
    noPending();
    intent('add_expense', { categoria: 'Outros' });

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'gastei no mercado' });

    expect(prisma.zmTransaction.create).not.toHaveBeenCalled();
    expect(reply).toContain('valor');
  });

  it('confirma com "sim" sem chamar a IA', async () => {
    activeUser();
    withPending();

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'sim' });

    expect(classify).not.toHaveBeenCalled();
    expect(prisma.zmTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' }, data: { status: 'confirmed' },
    });
    expect(reply).toMatch(/50,00/);
  });

  it('descarta com "não" sem chamar a IA', async () => {
    activeUser();
    withPending();

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'não' });

    expect(classify).not.toHaveBeenCalled();
    expect(prisma.zmTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' }, data: { status: 'discarded' },
    });
    expect(reply).toContain('Descartado');
  });

  it('corrige só os campos citados e repergunta', async () => {
    activeUser();
    withPending();
    intent('correct', { valor: 80 });
    (prisma.zmTransaction.update as jest.Mock).mockResolvedValueOnce({
      type: 'expense', amount: '80.00', category: 'Alimentação',
      description: 'mercado', occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'era 80' });

    expect(prisma.zmTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' }, data: { amount: '80.00' },
    });
    expect(reply).toContain('Confirma?');
  });

  it('não duplica lançamento quando o mesmo job é reprocessado', async () => {
    activeUser();
    noPending();
    intent('add_expense', { valor: 50, categoria: 'Alimentação' });
    (prisma.zmTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'tx1', status: 'pending', type: 'expense', amount: '50.00',
      category: 'Alimentação', description: null, occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    const reply = await handleZapMonneyMessage({
      phone: PHONE, text: 'gastei 50 no mercado', sourceMsgId: 'MSG1',
    });

    expect(prisma.zmTransaction.create).not.toHaveBeenCalled();
    expect(prisma.zmTransaction.updateMany).not.toHaveBeenCalled();
    expect(reply).toContain('Confirma?');
  });

  it('fica calado no reprocesso quando a conversa já seguiu adiante', async () => {
    activeUser();
    noPending();
    intent('add_expense', { valor: 50, categoria: 'Alimentação' });
    (prisma.zmTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'tx1', status: 'discarded', type: 'expense', amount: '50.00',
      category: 'Alimentação', description: null, occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    const reply = await handleZapMonneyMessage({
      phone: PHONE, text: 'gastei 50 no mercado', sourceMsgId: 'MSG1',
    });

    expect(prisma.zmTransaction.create).not.toHaveBeenCalled();
    expect(reply).toBeNull();
  });

  it('avisa quando confirmam sem ter nada pendente', async () => {
    activeUser();
    noPending();
    intent('confirm');

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'confirmado então' });

    expect(prisma.zmTransaction.update).not.toHaveBeenCalled();
    expect(reply).toContain('aguardando confirmação');
  });
});

describe('consultas', () => {
  it('monta o balanço do mês com entradas, saídas e saldo', async () => {
    activeUser();
    noPending();
    intent('query_balance', { periodo: 'mes_atual' });
    (prisma.zmTransaction.groupBy as jest.Mock).mockResolvedValueOnce([
      { type: 'income',  _sum: { amount: '3000.00' } },
      { type: 'expense', _sum: { amount: '1250.50' } },
    ]);

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'qual meu saldo' });

    expect(reply).toMatch(/3\.000,00/);
    expect(reply).toMatch(/1\.250,50/);
    expect(reply).toMatch(/1\.749,50/);
  });

  it('só conta lançamentos confirmados no balanço', async () => {
    activeUser();
    noPending();
    intent('query_balance', {});
    (prisma.zmTransaction.groupBy as jest.Mock).mockResolvedValueOnce([]);

    await handleZapMonneyMessage({ phone: PHONE, text: 'saldo' });

    expect(prisma.zmTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'confirmed' }),
    }));
  });

  it('filtra o resumo por categoria quando a pessoa cita uma', async () => {
    activeUser();
    noPending();
    intent('query_summary', { periodo: 'mes_atual', filtroCategoria: 'transporte' });
    (prisma.zmTransaction.groupBy as jest.Mock).mockResolvedValueOnce([
      { category: 'Transporte', _sum: { amount: '320.00' }, _count: { _all: 8 } },
    ]);

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'quanto gastei de transporte' });

    expect(prisma.zmTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ category: 'Transporte', type: 'expense' }),
    }));
    expect(reply).toMatch(/320,00/);
    expect(reply).toContain('8 lançamento');
  });

  it('lista os últimos lançamentos confirmados', async () => {
    activeUser();
    noPending();
    intent('list_recent');
    (prisma.zmTransaction.findMany as jest.Mock).mockResolvedValueOnce([
      { type: 'expense', amount: '50.00', category: 'Alimentação', description: 'mercado', occurredAt: new Date('2026-10-01T15:00:00Z') },
    ]);

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'extrato' });

    expect(reply).toContain('01/10');
    expect(reply).toContain('Alimentação');
  });
});

describe('ações destrutivas', () => {
  it('apaga o último lançamento confirmado marcando como deleted', async () => {
    activeUser();
    noPending();
    intent('delete_last');
    (prisma.zmTransaction.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'tx9', amount: '50.00', category: 'Lazer', occurredAt: new Date('2026-10-01T15:00:00Z'),
    });

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'apaga o último' });

    expect(prisma.zmTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx9' }, data: { status: 'deleted' },
    });
    expect(reply).toContain('Apaguei');
  });

  it('exige frase exata antes de apagar a conta', async () => {
    activeUser();
    noPending();
    intent('delete_account');

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'quero apagar meus dados' });

    expect(prisma.zmUser.delete).not.toHaveBeenCalled();
    expect(reply).toContain('APAGAR TUDO');
  });

  it('apaga a conta na frase exata, sem passar pela IA', async () => {
    activeUser();

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'APAGAR TUDO' });

    expect(classify).not.toHaveBeenCalled();
    expect(prisma.zmUser.delete).toHaveBeenCalledWith({ where: { id: 'zm1' } });
    expect(reply).toContain('apaguei');
  });
});

describe('fallback', () => {
  it('responde com ajuda quando não entende, nunca com silêncio', async () => {
    activeUser();
    noPending();
    intent('none');

    const reply = await handleZapMonneyMessage({ phone: PHONE, text: 'asdasd' });

    expect(reply).toContain('Não entendi');
    expect(reply).toContain('Como usar');
  });
});
