/**
 * Testes de sendCopilotoSuggestion / dismissCopilotoBriefing (copiloto-actions.ts)
 * — o único ponto de envio ao CLIENTE no Copiloto desde a v3.0 (painel sob
 * demanda, ver ESCOPO_COPILOTO.md §15). Substituiu handleCopilotoChoice
 * (resposta "1"/"2"/"3"/"0" no self-chat), removido nesta versão.
 */
import { prisma } from '../lib/prisma';
import { sendText } from '../services/evolution';

jest.mock('../lib/prisma', () => ({
  prisma: {
    copilotoSuggestion: { findFirst: jest.fn(), update: jest.fn() },
    copilotoBriefing: { findFirst: jest.fn(), update: jest.fn() },
    copilotoMessage: { create: jest.fn() },
    whatsappNumber: { findUnique: jest.fn() },
    task: { create: jest.fn() },
  },
}));

jest.mock('../services/evolution', () => ({ sendText: jest.fn() }));

import { sendCopilotoSuggestion, dismissCopilotoBriefing } from '../services/copiloto-actions';

const mockSendText = sendText as jest.Mock;
const CUSTOMER_PHONE = '5511888888888';

function mockSuggestion(overrides: Partial<any> = {}) {
  return {
    id: 'sug-1',
    rank: 1,
    status: 'offered',
    draft: 'Oi Maria, garanto entrega quinta.',
    commitmentTitle: null,
    commitmentDueAt: null,
    briefing: {
      id: 'briefing-1',
      numberId: 'number-1',
      conversation: { id: 'conv-1', contactPhone: CUSTOMER_PHONE, contactName: 'Maria' },
    },
    ...overrides,
  };
}

describe('sendCopilotoSuggestion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendText.mockResolvedValue({ id: 'wamid-123' });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValue({ zapiInstanceId: 'instance-1', status: 'connected' });
  });

  it('envia o rascunho original quando nenhum texto editado é passado', async () => {
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(mockSuggestion());

    const result = await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-1' });

    expect(result.ok).toBe(true);
    expect(mockSendText).toHaveBeenCalledWith('instance-1', CUSTOMER_PHONE, 'Oi Maria, garanto entrega quinta.');
    expect(prisma.copilotoSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sent', sentText: 'Oi Maria, garanto entrega quinta.' }) }),
    );
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'acted' }) }),
    );
  });

  it('marca como "edited" quando o dono altera o texto antes de enviar', async () => {
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(mockSuggestion());

    await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-1', finalText: 'Oi Maria, confirmo pra sexta.' });

    expect(mockSendText).toHaveBeenCalledWith('instance-1', CUSTOMER_PHONE, 'Oi Maria, confirmo pra sexta.');
    expect(prisma.copilotoSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'edited', sentText: 'Oi Maria, confirmo pra sexta.' }) }),
    );
  });

  it('cria Task quando a sugestão tem compromisso embutido', async () => {
    const dueAt = new Date('2026-09-20T17:00:00-03:00');
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(
      mockSuggestion({ commitmentTitle: 'Confirmar entrega', commitmentDueAt: dueAt }),
    );
    (prisma.task.create as jest.Mock).mockResolvedValue({ id: 'task-1' });

    const result = await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-1' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.taskId).toBe('task-1');
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', title: 'Confirmar entrega', dueAt },
    });
  });

  it('não envia (404) quando a sugestão não existe ou não é do usuário', async () => {
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-inexistente' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('não envia de novo (409) uma sugestão que já foi enviada', async () => {
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(mockSuggestion({ status: 'sent' }));

    const result = await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('não envia (409) quando o número não está conectado', async () => {
    (prisma.copilotoSuggestion.findFirst as jest.Mock).mockResolvedValue(mockSuggestion());
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValue({ zapiInstanceId: 'instance-1', status: 'disconnected' });

    const result = await sendCopilotoSuggestion({ userId: 'user-1', suggestionId: 'sug-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(mockSendText).not.toHaveBeenCalled();
  });
});

describe('dismissCopilotoBriefing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marca o briefing como dismissed, sem dismissReason quando noise=false', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue({ id: 'briefing-1' });

    const result = await dismissCopilotoBriefing({ userId: 'user-1', briefingId: 'briefing-1' });

    expect(result.ok).toBe(true);
    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', dismissReason: null },
    });
  });

  it('grava dismissReason="ruido" quando noise=true (equivalente ao antigo "0!")', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue({ id: 'briefing-1' });

    await dismissCopilotoBriefing({ userId: 'user-1', briefingId: 'briefing-1', noise: true });

    expect(prisma.copilotoBriefing.update).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { status: 'dismissed', dismissReason: 'ruido' },
    });
  });

  it('404 quando o briefing não existe ou não é do usuário', async () => {
    (prisma.copilotoBriefing.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await dismissCopilotoBriefing({ userId: 'user-1', briefingId: 'briefing-x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(prisma.copilotoBriefing.update).not.toHaveBeenCalled();
  });
});
