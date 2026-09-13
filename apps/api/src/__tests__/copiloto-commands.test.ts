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
    copilotoBriefing: { findFirst: jest.fn(), update: jest.fn() },
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
