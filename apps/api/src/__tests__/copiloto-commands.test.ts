/**
 * Testes de handleCopilotoChoice — a resposta do dono a um briefing no
 * self-chat ("1"/"2"/"3", "1e", "0", "0!").
 *
 * Foco: "0!"/"0x" (feedback explícito de ruído, v2.1) tem que se comportar
 * IGUAL a "0" em todo estado possível — nunca pode cair no caminho de
 * "texto livre vira mensagem pro cliente" (estado awaiting_edit). Um bug
 * exatamente nesse ponto foi encontrado e corrigido nesta revisão: "0!"
 * não batia com o `raw === '0'` do bloco de awaiting_edit e seria enviado
 * como texto literal ao cliente.
 */
import { prisma } from '../lib/prisma';
import { sendText } from '../services/evolution';

jest.mock('../lib/prisma', () => ({
  prisma: {
    copilotoBriefing: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    copilotoSuggestion: { update: jest.fn() },
    copilotoMessage: { create: jest.fn() },
    task: { create: jest.fn() },
  },
}));

jest.mock('../services/evolution', () => ({
  sendText: jest.fn(),
  deleteMessageForEveryone: jest.fn(),
}));

jest.mock('../services/queue', () => ({ copilotoQueue: { add: jest.fn() } }));
jest.mock('../services/copiloto-backfill', () => ({ backfillUnreadConversations: jest.fn() }));
jest.mock('../services/ai-fallback', () => ({ buildModelChain: jest.fn(() => []), callAiWithFallback: jest.fn() }));

import { handleCopilotoChoice } from '../services/copiloto-commands';

const mockSendText = sendText as jest.Mock;

const baseParams = {
  userId: 'user-1',
  numberId: 'number-1',
  instanceName: 'instance-1',
  selfPhone: '5511999999999',
};
const CUSTOMER_PHONE = '5511888888888';

/** sendText também é usado pra responder o DONO no próprio self-chat (confirmações
 * tipo "Ok, ignorado") — o que nunca pode acontecer é uma mensagem pro CLIENTE. */
function expectNothingSentToCustomer() {
  const callsToCustomer = mockSendText.mock.calls.filter((c) => c[1] === CUSTOMER_PHONE);
  expect(callsToCustomer).toHaveLength(0);
}

function mockBriefing(overrides: Partial<any> = {}) {
  return {
    id: 'briefing-1',
    status: 'pending',
    awaitingRank: null,
    awaitingSince: null,
    conversation: { id: 'conv-1', contactPhone: CUSTOMER_PHONE, contactName: 'Maria' },
    suggestions: [
      { id: 'sug-1', rank: 1, status: 'offered', draft: 'Oi Maria', commitmentTitle: null, commitmentDueAt: null },
    ],
    ...overrides,
  };
}

describe('handleCopilotoChoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendText.mockResolvedValue({ id: 'wamid-123' });
  });

  it('"0" ignora sem marcar dismissReason (sem sinal explícito)', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(mockBriefing());
    await handleCopilotoChoice({ ...baseParams, text: '0' });
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', dismissReason: null },
    });
    expectNothingSentToCustomer();
  });

  it('"0!" ignora E marca dismissReason="ruido"', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(mockBriefing());
    await handleCopilotoChoice({ ...baseParams, text: '0!' });
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', dismissReason: 'ruido' },
    });
    expectNothingSentToCustomer();
  });

  it('"0x" tem o mesmo efeito que "0!"', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(mockBriefing());
    await handleCopilotoChoice({ ...baseParams, text: '0x' });
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', dismissReason: 'ruido' },
    });
  });

  it('REGRESSÃO: em awaiting_edit, "0" cancela sem enviar nada ao cliente', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(
      mockBriefing({ status: 'awaiting_edit', awaitingRank: 1, awaitingSince: new Date() }),
    );
    await handleCopilotoChoice({ ...baseParams, text: '0' });
    expectNothingSentToCustomer();
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', awaitingRank: null, awaitingSince: null, dismissReason: null },
    });
  });

  it('REGRESSÃO: em awaiting_edit, "0!" cancela SEM enviar "0!" como texto ao cliente', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(
      mockBriefing({ status: 'awaiting_edit', awaitingRank: 1, awaitingSince: new Date() }),
    );
    await handleCopilotoChoice({ ...baseParams, text: '0!' });
    // A falha original: "0!" não batia com `raw === '0'` e caía em
    // dispatch(chosen, raw, true) → sendText ao CLIENTE com o texto "0!".
    expectNothingSentToCustomer();
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', awaitingRank: null, awaitingSince: null, dismissReason: 'ruido' },
    });
  });

  it('em awaiting_edit, texto normal ainda vira mensagem pro cliente (comportamento preservado)', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(
      mockBriefing({ status: 'awaiting_edit', awaitingRank: 1, awaitingSince: new Date() }),
    );
    await handleCopilotoChoice({ ...baseParams, text: 'Oi Maria, entrego amanhã 10h' });
    expect(mockSendText).toHaveBeenCalledWith('instance-1', CUSTOMER_PHONE, 'Oi Maria, entrego amanhã 10h');
  });

  it('"1" fora de awaiting_edit envia a sugestão escolhida ao cliente', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(mockBriefing());
    await handleCopilotoChoice({ ...baseParams, text: '1' });
    expect(mockSendText).toHaveBeenCalledWith('instance-1', CUSTOMER_PHONE, 'Oi Maria');
  });
});

/**
 * Testes de desambiguação por letra (v2.1 — "Opção B"): quando há 2+ briefings
 * pendentes pro mesmo número ao mesmo tempo, "1"/"2"/"3"/"0" sozinho não pode
 * mais adivinhar silenciosamente o mais recente — precisa da letra (A1, B0...)
 * ou, sem letra, o dono é avisado da ambiguidade em vez de arriscar agir na
 * conversa errada. Ver pendingLabel no schema e assignPendingLabel no worker.
 */
describe('handleCopilotoChoice — desambiguação por letra (v2.1)', () => {
  const mockFindFirst = prisma.copilotoBriefing.findFirst as jest.Mock;
  const mockFindMany = prisma.copilotoBriefing.findMany as jest.Mock;

  const briefingA = mockBriefing({
    id: 'briefing-A',
    pendingLabel: 'A',
    conversation: { id: 'conv-a', contactPhone: '5511111111111', contactName: 'Victor' },
  });
  const briefingB = mockBriefing({
    id: 'briefing-B',
    pendingLabel: 'B',
    conversation: { id: 'conv-b', contactPhone: '5511222222222', contactName: 'Diogo Borges' },
    suggestions: [{ id: 'sug-b1', rank: 1, status: 'offered', draft: 'Oi Diogo', commitmentTitle: null, commitmentDueAt: null }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendText.mockResolvedValue({ id: 'wamid-123' });
  });

  /** awaiting_edit tem prioridade absoluta e é buscado sempre primeiro. */
  function mockNoAwaitingEdit() {
    mockFindFirst.mockImplementation((args: any) =>
      args.where.status === 'awaiting_edit' ? Promise.resolve(null) : Promise.resolve(null),
    );
  }

  it('letra explícita resolve o briefing certo mesmo com outro mais recente pendente', async () => {
    mockFindFirst.mockImplementation((args: any) => {
      if (args.where.status === 'awaiting_edit') return Promise.resolve(null);
      if (args.where.pendingLabel === 'A') return Promise.resolve(briefingA);
      return Promise.resolve(null);
    });
    await handleCopilotoChoice({ ...baseParams, text: 'A1' });
    expect(mockSendText).toHaveBeenCalledWith('instance-1', '5511111111111', 'Oi Maria');
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'briefing-A' } }),
    );
  });

  it('"b0!" (minúscula) resolve pela letra, ignora maiúsculas/minúsculas', async () => {
    mockFindFirst.mockImplementation((args: any) => {
      if (args.where.status === 'awaiting_edit') return Promise.resolve(null);
      if (args.where.pendingLabel === 'B') return Promise.resolve(briefingB);
      return Promise.resolve(null);
    });
    await handleCopilotoChoice({ ...baseParams, text: 'b0!' });
    expectNothingSentToCustomer();
    const callsToDiogo = mockSendText.mock.calls.filter((c) => c[1] === '5511222222222');
    expect(callsToDiogo).toHaveLength(0);
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-B' },
      data: { status: 'dismissed', dismissReason: 'ruido' },
    });
  });

  it('letra sem briefing pendente correspondente avisa e não age', async () => {
    mockNoAwaitingEdit();
    await handleCopilotoChoice({ ...baseParams, text: 'C1' });
    expect(mockSendText).toHaveBeenCalledWith(
      'instance-1',
      baseParams.selfPhone,
      expect.stringContaining('letra "C"'),
    );
    expect(prisma.copilotoBriefing.update).not.toHaveBeenCalled();
  });

  it('sem letra e com 2+ pendentes, pergunta ao dono em vez de adivinhar o mais recente', async () => {
    mockNoAwaitingEdit();
    mockFindMany.mockResolvedValue([briefingA, briefingB]);
    const handled = await handleCopilotoChoice({ ...baseParams, text: '1' });
    expect(handled).toBe(true);
    expect(prisma.copilotoBriefing.update).not.toHaveBeenCalled();
    expectNothingSentToCustomer();
    const [, , msg] = mockSendText.mock.calls[0];
    expect(msg).toContain('2 conversas pendentes');
    expect(msg).toContain('A — Victor');
    expect(msg).toContain('B — Diogo Borges');
  });

  it('sem letra e com só 1 pendente, age normalmente nele (comportamento v1 preservado)', async () => {
    mockNoAwaitingEdit();
    mockFindMany.mockResolvedValue([briefingA]);
    await handleCopilotoChoice({ ...baseParams, text: '1' });
    expect(mockSendText).toHaveBeenCalledWith('instance-1', '5511111111111', 'Oi Maria');
  });

  it('sem letra e nenhum pendente, retorna false sem responder nada', async () => {
    mockNoAwaitingEdit();
    mockFindMany.mockResolvedValue([]);
    const handled = await handleCopilotoChoice({ ...baseParams, text: '1' });
    expect(handled).toBe(false);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('nota pessoal que não parece comando nunca dispara a checagem de ambiguidade', async () => {
    mockNoAwaitingEdit();
    const handled = await handleCopilotoChoice({ ...baseParams, text: 'Vou chegar mais tarde hoje' });
    expect(handled).toBe(false);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('texto que começa com letra mas não é seguido de dígito não é tratado como comando com letra', async () => {
    mockNoAwaitingEdit();
    const handled = await handleCopilotoChoice({ ...baseParams, text: 'Ok vou confirmar amanhã' });
    expect(handled).toBe(false);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
