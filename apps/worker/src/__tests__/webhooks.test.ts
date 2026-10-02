/**
 * Entrega de webhook (item 2 do escopo ZapScript × Twilio).
 *
 * O webhook antigo era fire-and-forget: endpoint fora do ar naquele segundo =
 * evento perdido, sem registro e sem reentrega. Estes testes travam o que
 * substituiu isso — retry, histórico por entrega e circuit breaker.
 */

jest.mock('../lib/queue', () => ({
  redis:         { on: jest.fn(), options: {} },
  webhooksQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  Queue:  jest.fn().mockImplementation(() => ({ add: jest.fn() })),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    webhookDelivery: { findUnique: jest.fn(), update: jest.fn() },
    webhookEndpoint: { update: jest.fn() },
    $transaction:    jest.fn((ops: any[]) => Promise.all(ops)),
  },
}));

jest.mock('../lib/sentry', () => ({
  captureJobFailure: jest.fn(), captureWorkerError: jest.fn(),
}));
jest.mock('../lib/dlq', () => ({ recordFailedJob: jest.fn() }));

jest.mock('../lib/url-safety', () => ({
  isSafeWebhookUrl: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/events', () => ({
  ...jest.requireActual('../services/events'),
  revealWebhookSecret: jest.fn(() => 'segredo-em-claro'),
}));

import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { isSafeWebhookUrl } from '../lib/url-safety';
import { processWebhookDeliveryJob } from '../webhooks';

const db = prisma as any;

const entrega = (over: any = {}) => ({
  id: 'del-1', endpointId: 'ep-1', eventId: 'evt-1', status: 'pending', attempts: 0,
  endpoint: {
    id: 'ep-1', url: 'https://cliente.com/hook', active: true,
    signatureScheme: 'v1', secret: 'enc', consecutiveFailures: 0,
  },
  event: { id: 'evt-1', type: 'message.delivered', createdAt: new Date('2026-10-02T10:00:00Z'), data: { message: { id: 'm1' } } },
  ...over,
});

const job = (attemptsMade = 0, attempts = 6): any => ({
  id: 'job-1', attemptsMade, opts: { attempts }, data: { deliveryId: 'del-1' },
});

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  db.webhookDelivery.findUnique.mockResolvedValue(entrega());
  db.webhookDelivery.update.mockResolvedValue({});
  db.webhookEndpoint.update.mockResolvedValue({ consecutiveFailures: 1 });
  (isSafeWebhookUrl as jest.Mock).mockResolvedValue({ ok: true });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
  (global as any).fetch = fetchMock;
});

describe('entrega bem-sucedida', () => {
  it('faz POST assinado, com headers de correlação, e zera o contador de falhas', async () => {
    const out: any = await processWebhookDeliveryJob(job());
    expect(out.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cliente.com/hook');

    // Corpo é o envelope público do evento.
    expect(JSON.parse(init.body)).toEqual({
      id: 'evt-1', type: 'message.delivered',
      createdAt: '2026-10-02T10:00:00.000Z', data: { message: { id: 'm1' } },
    });

    // Headers que o cliente usa para deduplicar e validar.
    expect(init.headers['X-ZapScript-Event']).toBe('message.delivered');
    expect(init.headers['X-ZapScript-Event-Id']).toBe('evt-1');
    expect(init.headers['X-ZapScript-Delivery-Id']).toBe('del-1');
    expect(init.headers['X-ZapScript-Attempt']).toBe('1');

    // Assinatura v1 confere com t + '.' + body.
    const sig = init.headers['X-ZapScript-Signature'] as string;
    const [tPart, vPart] = sig.split(',');
    const t = tPart.replace('t=', '');
    const esperado = crypto.createHmac('sha256', 'segredo-em-claro').update(`${t}.${init.body}`).digest('hex');
    expect(vPart).toBe(`v1=${esperado}`);

    expect(db.webhookEndpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consecutiveFailures: 0 }),
    }));
  });

  it('usa o formato LEGADO quando o endpoint é o migrado do webhook antigo', async () => {
    db.webhookDelivery.findUnique.mockResolvedValueOnce(entrega({
      endpoint: { id: 'ep-1', url: 'https://cliente.com/hook', active: true, signatureScheme: 'legacy', secret: 'enc', consecutiveFailures: 0 },
    }));

    await processWebhookDeliveryJob(job());
    const init = fetchMock.mock.calls[0][1];
    const esperado = crypto.createHmac('sha256', 'segredo-em-claro').update(init.body).digest('hex');
    // Exatamente o que a integração em produção do cliente já valida.
    expect(init.headers['X-ZapScript-Signature']).toBe(`sha256=${esperado}`);
  });
});

describe('guardas', () => {
  it('entrega já concluída não é repetida', async () => {
    db.webhookDelivery.findUnique.mockResolvedValueOnce(entrega({ status: 'succeeded' }));
    const out: any = await processWebhookDeliveryJob(job());
    expect(out.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('endpoint desativado não recebe', async () => {
    db.webhookDelivery.findUnique.mockResolvedValueOnce(entrega({
      endpoint: { id: 'ep-1', url: 'https://x/h', active: false, signatureScheme: 'v1', secret: 'enc', consecutiveFailures: 0 },
    }));
    const out: any = await processWebhookDeliveryJob(job());
    expect(out.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL que passou a resolver para IP interno é bloqueada e desativa o endpoint', async () => {
    // DNS rebinding: o host era público no cadastro e passou a apontar para a
    // rede interna. Revalidar a cada entrega é o que impede o SSRF.
    (isSafeWebhookUrl as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'IP interno' });

    const out: any = await processWebhookDeliveryJob(job());
    expect(out.reason).toBe('webhook.url_blocked');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.webhookEndpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ active: false }),
    }));
  });
});

describe('falha e retry', () => {
  it('5xx do cliente relança para o BullMQ retentar, mantendo a entrega pendente', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'indisponível' });

    await expect(processWebhookDeliveryJob(job(0, 6))).rejects.toMatchObject({
      code: 'webhook.delivery_failed',
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'pending', attempts: 1, responseStatus: 503, responseBody: 'indisponível',
      }),
    }));
  });

  it('na última tentativa marca a entrega como failed sem relançar', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'erro' });
    const out: any = await processWebhookDeliveryJob(job(5, 6));
    expect(out.skipped).toBe(true);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', nextRetryAt: null }),
    }));
  });

  it('410 Gone desativa o endpoint sem insistir', async () => {
    // É o jeito padrão de dizer "não me mande mais" — retentar 6x seria insistir
    // contra um pedido explícito.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, text: async () => 'gone' });

    const out: any = await processWebhookDeliveryJob(job());
    expect(out.reason).toContain('410');
    expect(db.webhookEndpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ active: false, disabledReason: expect.stringContaining('410') }),
    }));
  });

  it('erro de rede é traduzido e contado como falha do endpoint', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout of 10000ms'), { code: 'ETIMEDOUT' }));
    await expect(processWebhookDeliveryJob(job(0, 6))).rejects.toMatchObject({ code: 'provider.timeout' });
    expect(db.webhookEndpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consecutiveFailures: { increment: 1 } }),
    }));
  });

  it('circuit breaker: ao bater o limite de falhas consecutivas, desativa', async () => {
    db.webhookEndpoint.update.mockResolvedValueOnce({ consecutiveFailures: 15 });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'erro' });

    await processWebhookDeliveryJob(job(5, 6));

    const desativacao = db.webhookEndpoint.update.mock.calls.find(
      ([arg]: any) => arg?.data?.active === false,
    );
    expect(desativacao).toBeDefined();
    expect(desativacao[0].data.disabledReason).toContain('15 falhas');
  });
});
