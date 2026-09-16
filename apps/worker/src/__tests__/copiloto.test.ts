/**
 * Testes das funções puras/simples do worker do Copiloto que sobraram depois
 * da v3.0 (Copiloto virou painel sob demanda — ver ESCOPO_COPILOTO.md §15):
 * enqueueCopilotoIngest (só persiste, não dispara mais IA) e hasCopiloto
 * (checagem de titularidade do módulo).
 *
 * O módulo importa Prisma/BullMQ no topo (registra o worker como side-effect),
 * então mockamos as dependências de infra — o alvo aqui é a lógica, não a fila.
 */

const mockQueueAdd = jest.fn();
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd })),
}));
jest.mock('../lib/queue', () => ({ redis: {} }));
jest.mock('../lib/prisma', () => ({
  prisma: { copilotoBriefing: { findMany: jest.fn(), update: jest.fn() }, entitlement: { findFirst: jest.fn() } },
}));
jest.mock('../services/evolution', () => ({ sendMessageViaEvolution: jest.fn() }));
jest.mock('../services/copiloto-agent', () => ({ triageConversation: jest.fn(), buildBriefing: jest.fn() }));

import { prisma } from '../lib/prisma';
import { enqueueCopilotoIngest, hasCopiloto } from '../copiloto';

/**
 * enqueueCopilotoIngest — cópia de enqueueCopilotoMessage (apps/api/src/
 * services/copiloto-commands.ts) que vive no worker porque quem chama isto é
 * processEvolutionJob (apps/worker/src/index.ts), depois de transcrever um
 * áudio de cliente — o texto só existe DEPOIS que o worker já rodou o
 * Whisper, então não dá pra passar pela rota normal do webhook.
 *
 * v3.0 — só enfileira 'ingest'. O job 'brief' virou sob demanda, disparado
 * pelo painel (POST /copiloto/inbox/refresh), não mais automaticamente aqui.
 */
describe('enqueueCopilotoIngest (v3.0 — só ingest, sem brief automático)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueAdd.mockResolvedValue(undefined);
  });

  it('enfileira só "ingest" quando direction é "in"', async () => {
    await enqueueCopilotoIngest({
      userId: 'user-1', numberId: 'number-1', contactPhone: '5511999999999',
      contactName: 'Maria', direction: 'in', content: 'transcrição do áudio', messageId: 'wamid-1',
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'ingest',
      expect.objectContaining({
        userId: 'user-1', numberId: 'number-1', contactPhone: '5511999999999',
        contactName: 'Maria', direction: 'in', content: 'transcrição do áudio', externalId: 'wamid-1',
      }),
      { jobId: 'copiloto-in-wamid-1' },
    );
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('enfileira só "ingest" quando direction é "out" (dono respondendo)', async () => {
    await enqueueCopilotoIngest({
      userId: 'user-1', numberId: 'number-1', contactPhone: '5511999999999',
      direction: 'out', content: 'resposta do dono', messageId: 'wamid-2',
    });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith('ingest', expect.anything(), { jobId: 'copiloto-in-wamid-2' });
  });

  it('contactName ausente vira null (não undefined) no job de ingest', async () => {
    await enqueueCopilotoIngest({
      userId: 'user-1', numberId: 'number-1', contactPhone: '5511999999999',
      direction: 'in', content: 'oi', messageId: 'wamid-3',
    });
    const [, data] = mockQueueAdd.mock.calls[0];
    expect(data.contactName).toBeNull();
  });
});

describe('hasCopiloto', () => {
  const mockFindFirst = prisma.entitlement.findFirst as jest.Mock;
  beforeEach(() => jest.clearAllMocks());

  it('true quando há entitlement ativo/trialing', async () => {
    mockFindFirst.mockResolvedValue({ id: 'ent-1' });
    expect(await hasCopiloto('user-1')).toBe(true);
  });

  it('false quando não há entitlement', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await hasCopiloto('user-1')).toBe(false);
  });

  it('false (não lança) quando a consulta falha', async () => {
    mockFindFirst.mockRejectedValue(new Error('db down'));
    expect(await hasCopiloto('user-1')).toBe(false);
  });
});
