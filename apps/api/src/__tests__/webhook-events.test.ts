/**
 * Testes do filtro de assinatura de eventos (lib/webhook-events.ts).
 *
 * O comportamento crítico aqui é a retrocompatibilidade: quem já tinha webhook
 * configurado antes da API pública v1 assinava implicitamente só
 * 'transcription.completed'. Essas configs não podem começar a receber
 * 'message.received' de surpresa — seria uma enxurrada de POSTs numa URL que
 * não espera isso.
 */
jest.mock('../lib/prisma', () => ({
  prisma: { webhookConfig: { findUnique: jest.fn() } },
}));
jest.mock('../services/queue', () => ({
  webhooksQueue: { add: jest.fn().mockResolvedValue({ id: 'job_1' }) },
}));
jest.mock('../lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { webhooksQueue } from '../services/queue';
import { enqueueWebhook, WEBHOOK_EVENTS, ALL_WEBHOOK_EVENTS } from '../lib/webhook-events';

const findUnique = (prisma as any).webhookConfig.findUnique as jest.Mock;
const add = (webhooksQueue as any).add as jest.Mock;

beforeEach(() => {
  findUnique.mockReset();
  add.mockReset();
  add.mockResolvedValue({ id: 'job_1' });
});

describe('catálogo de eventos', () => {
  it('expõe os três eventos da v1', () => {
    expect(ALL_WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining(['message.received', 'message.status', 'transcription.completed']),
    );
    expect(ALL_WEBHOOK_EVENTS).toHaveLength(3);
  });
});

describe('enqueueWebhook', () => {
  it('enfileira quando o usuário assinou o evento', async () => {
    findUnique.mockResolvedValue({ active: true, events: ['message.received'] });

    const ok = await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, { text: 'sim' });

    expect(ok).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    const [, job] = add.mock.calls[0];
    expect(job).toMatchObject({ userId: 'u1', event: 'message.received', data: { text: 'sim' } });
    expect(typeof job.occurredAt).toBe('string');
  });

  it('NÃO enfileira evento que o usuário não assinou', async () => {
    findUnique.mockResolvedValue({ active: true, events: ['transcription.completed'] });

    const ok = await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, { text: 'sim' });

    expect(ok).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('NÃO enfileira se a config está inativa', async () => {
    findUnique.mockResolvedValue({ active: false, events: ['message.received'] });
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('NÃO enfileira se o usuário não tem webhook (caso da maioria)', async () => {
    findUnique.mockResolvedValue(null);
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('RETROCOMPAT: config sem `events` vale como só transcription.completed', async () => {
    // Linha criada antes da migration que adicionou a coluna.
    findUnique.mockResolvedValue({ active: true, events: null });

    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).toBe(false);
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.TRANSCRIPTION_COMPLETED, {})).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('RETROCOMPAT: `events` vazio também vale como só transcription.completed', async () => {
    findUnique.mockResolvedValue({ active: true, events: [] });
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).toBe(false);
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.TRANSCRIPTION_COMPLETED, {})).toBe(true);
  });

  it('assinatura múltipla recebe os dois eventos', async () => {
    findUnique.mockResolvedValue({ active: true, events: ['message.received', 'message.status'] });
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).toBe(true);
    expect(await enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_STATUS, {})).toBe(true);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('NUNCA lança — é chamada em caminho fire-and-forget do webhook da Evolution', async () => {
    // Se isso lançasse, derrubaria o processamento da mensagem (resposta do bot
    // do Atende, ingestão do Copiloto) por causa de um webhook de terceiro.
    findUnique.mockRejectedValue(new Error('banco caiu'));
    await expect(enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).resolves.toBe(false);

    findUnique.mockResolvedValue({ active: true, events: ['message.received'] });
    add.mockRejectedValue(new Error('redis caiu'));
    await expect(enqueueWebhook('u1', WEBHOOK_EVENTS.MESSAGE_RECEIVED, {})).resolves.toBe(false);
  });
});
