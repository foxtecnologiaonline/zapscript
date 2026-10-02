/**
 * Fila de saída da API pública (item 1 do escopo ZapScript × Twilio).
 *
 * As duas garantias que importam aqui:
 *  1. mensagem já enviada NÃO sai de novo (job reprocessado = duplicata no
 *     celular do contato final);
 *  2. erro definitivo não vira retry (3 tentativas para colher o mesmo
 *     template.param_mismatch só queimam quota e poluem o DLQ).
 */

jest.mock('../lib/queue', () => ({
  redis:            { on: jest.fn(), options: {} },
  messagesOutQueue: { add: jest.fn().mockResolvedValue({}) },
  webhooksQueue:    { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  Queue:  jest.fn().mockImplementation(() => ({ add: jest.fn() })),
}));

jest.mock('../lib/prisma', () => ({
  prisma: { messageLog: { findUnique: jest.fn(), update: jest.fn() } },
}));

jest.mock('../lib/sentry', () => ({
  captureJobFailure: jest.fn(), captureWorkerError: jest.fn(), initSentry: jest.fn(), flushSentry: jest.fn(),
}));

jest.mock('../lib/dlq', () => ({ recordFailedJob: jest.fn() }));

jest.mock('../services/message-gateway', () => ({ sendOutbound: jest.fn() }));

jest.mock('../services/message-log', () => ({
  markMessageSent:   jest.fn().mockResolvedValue({}),
  markMessageFailed: jest.fn().mockResolvedValue({}),
}));

import { prisma } from '../lib/prisma';
import { sendOutbound } from '../services/message-gateway';
import { markMessageSent, markMessageFailed } from '../services/message-log';
import { ApiError } from '../lib/apiErrors';
import { processOutboundMessageJob } from '../messages-out';

const db = prisma as any;

const job = (data: any = {}, attemptsMade = 0, attempts = 3): any => ({
  id: 'job-1',
  attemptsMade,
  opts: { attempts },
  data: {
    messageLogId: 'msg-1', userId: 'u1', numberId: 'num-1',
    to: '5511999999999', type: 'text', text: 'oi', ...data,
  },
});

const linha = (over: any = {}) => ({
  id: 'msg-1', userId: 'u1', status: 'queued', providerMessageId: null, attempts: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.messageLog.update.mockResolvedValue({});
  db.messageLog.findUnique.mockResolvedValue(linha());
  (sendOutbound as jest.Mock).mockResolvedValue({ providerMessageId: 'wamid.1', channel: 'meta' });
});

describe('guardas de duplicidade', () => {
  it('não reenvia quando já existe providerMessageId', async () => {
    db.messageLog.findUnique.mockResolvedValueOnce(linha({ providerMessageId: 'wamid.ja-enviado' }));
    const out = await processOutboundMessageJob(job());
    expect(out).toMatchObject({ skipped: true });
    expect(sendOutbound).not.toHaveBeenCalled();
  });

  it('não envia quando o log não está mais em queued', async () => {
    db.messageLog.findUnique.mockResolvedValueOnce(linha({ status: 'failed' }));
    const out: any = await processOutboundMessageJob(job());
    expect(out.skipped).toBe(true);
    expect(out.reason).toContain('failed');
    expect(sendOutbound).not.toHaveBeenCalled();
  });

  it('log apagado (retenção/exclusão de conta) é ignorado sem erro', async () => {
    db.messageLog.findUnique.mockResolvedValueOnce(null);
    const out: any = await processOutboundMessageJob(job());
    expect(out.skipped).toBe(true);
    expect(sendOutbound).not.toHaveBeenCalled();
  });
});

describe('envio', () => {
  it('envia e marca como sent com o id do provedor', async () => {
    const out: any = await processOutboundMessageJob(job());
    expect(out.providerMessageId).toBe('wamid.1');
    expect(markMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.1', { attempts: 1 });
  });

  it('repassa o spec completo ao gateway (template com header de mídia)', async () => {
    await processOutboundMessageJob(job({
      type: 'template', text: null,
      template: { name: 'promo', language: 'pt_BR', header: { type: 'image', link: 'https://x/a.jpg' } },
    }));
    expect(sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template',
      template: { name: 'promo', language: 'pt_BR', header: { type: 'image', link: 'https://x/a.jpg' } },
    }));
  });
});

describe('tratamento de falha', () => {
  it('erro RETRYABLE relança para o BullMQ agendar o backoff, mantendo queued', async () => {
    (sendOutbound as jest.Mock).mockRejectedValueOnce(new ApiError('message.throttled'));

    await expect(processOutboundMessageJob(job({}, 0, 3)))
      .rejects.toMatchObject({ code: 'message.throttled' });

    // Segue em queued, com o motivo visível para o cliente.
    expect(db.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attempts: 1, errorCode: 'message.throttled' }),
    }));
    expect(markMessageFailed).not.toHaveBeenCalled();
  });

  it('erro DEFINITIVO não relança — marca failed e encerra o job', async () => {
    (sendOutbound as jest.Mock).mockRejectedValueOnce(new ApiError('template.param_mismatch'));

    const out: any = await processOutboundMessageJob(job());
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('template.param_mismatch');
    expect(markMessageFailed).toHaveBeenCalled();
  });

  it('erro retryable na ÚLTIMA tentativa marca failed em vez de relançar', async () => {
    (sendOutbound as jest.Mock).mockRejectedValueOnce(new ApiError('provider.unavailable'));
    const out: any = await processOutboundMessageJob(job({}, 2, 3)); // 3ª de 3
    expect(out.skipped).toBe(true);
    expect(markMessageFailed).toHaveBeenCalledWith('msg-1', expect.anything(), { attempts: 3 });
  });

  it('erro cru do provedor é traduzido para código do catálogo', async () => {
    (sendOutbound as jest.Mock).mockRejectedValueOnce({
      response: { status: 400, data: { error: { code: 131047, message: 'Re-engagement message' } } },
    });
    const out: any = await processOutboundMessageJob(job());
    expect(out.reason).toBe('message.outside_window');
  });
});
