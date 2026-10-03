/**
 * Testes do entregador de webhooks (apps/worker/src/webhooks.ts) — o único
 * lugar que assina e faz o POST de um evento de saída.
 *
 * O que está sendo travado aqui:
 *  1. assina com o secret DESCRIPTOGRAFADO (o bug que existia assinava com o
 *     blob criptografado, e nenhum receptor conseguia validar);
 *  2. a política de retry: erro de rede e 5xx pedem reentrega (lança), 4xx
 *     permanente não (não lança), porque retry em 4xx só queima tentativa;
 *  3. respeita a assinatura de eventos e a revalidação anti-SSRF no disparo.
 */
jest.mock('../lib/queue', () => ({
  redis: {},
  webhooksQueue: { add: jest.fn() },
}));
jest.mock('bullmq', () => ({
  // Evita abrir conexão real de Redis só por importar o módulo.
  Worker: class { on() { return this; } },
  Queue:  class { add() { return Promise.resolve({}); } },
}));
jest.mock('../lib/prisma', () => ({
  prisma: {
    webhookConfig:   { findUnique: jest.fn() },
    webhookDelivery: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock('../services/encryption', () => ({
  // Simula o formato iv:tag:data → devolve o secret em claro.
  decryptStr: jest.fn((v: string) => (v?.startsWith('enc:') ? v.slice(4) : v)),
}));
jest.mock('../lib/webhook-url-guard', () => ({
  isSafeWebhookUrl: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { isSafeWebhookUrl } from '../lib/webhook-url-guard';
import { processWebhookJob } from '../webhooks';

const findUnique  = (prisma as any).webhookConfig.findUnique as jest.Mock;
const logCreate   = (prisma as any).webhookDelivery.create as jest.Mock;
const urlGuard    = isSafeWebhookUrl as jest.Mock;

const PLAIN_SECRET = 'a'.repeat(64);
const URL = 'https://mindmanager.example.com/api/webhooks/zapscript';

function job(overrides: any = {}) {
  const { attemptsMade, id, ...dataOverrides } = overrides;
  return {
    id: id ?? 'job_1',
    data: {
      userId:     'u1',
      event:      'message.received',
      occurredAt: '2026-10-02T14:30:00Z',
      data:       { contactPhone: '5511999999999', text: 'sim' },
      deliveryId: 'd1e11ve1-0000-4000-8000-000000000001',
      ...dataOverrides,
    },
    attemptsMade: attemptsMade ?? 0,
  } as any;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  findUnique.mockReset();
  logCreate.mockReset().mockResolvedValue({});
  urlGuard.mockReset().mockResolvedValue({ ok: true });
  // Secret guardado "criptografado" (prefixo enc:) — o dispatcher precisa
  // descriptografar antes de assinar.
  findUnique.mockResolvedValue({
    active: true, events: ['message.received'], url: URL, secret: 'enc:' + PLAIN_SECRET,
  });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (global as any).fetch = fetchMock;
});

describe('assinatura', () => {
  it('assina com o secret EM CLARO, validável por um receptor externo', async () => {
    await processWebhookJob(job());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);

    // Exatamente o cálculo que o integrador faz do outro lado.
    const expected = 'sha256=' + crypto.createHmac('sha256', PLAIN_SECRET).update(opts.body).digest('hex');
    expect(opts.headers['X-ZapScript-Signature']).toBe(expected);
  });

  it('REGRESSÃO: não assina com o blob criptografado', async () => {
    await processWebhookJob(job());
    const [, opts] = fetchMock.mock.calls[0];
    const wrong = 'sha256=' + crypto.createHmac('sha256', 'enc:' + PLAIN_SECRET).update(opts.body).digest('hex');
    expect(opts.headers['X-ZapScript-Signature']).not.toBe(wrong);
  });

  it('envia os headers de evento, entrega e timestamp', async () => {
    await processWebhookJob(job());
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['X-ZapScript-Event']).toBe('message.received');
    expect(opts.headers['X-ZapScript-Timestamp']).toBe('2026-10-02T14:30:00Z');
    expect(opts.headers['X-ZapScript-Delivery']).toBe('d1e11ve1-0000-4000-8000-000000000001');
  });

  it('REGRESSÃO: X-ZapScript-Delivery é ESTÁVEL entre as tentativas', async () => {
    // A documentação manda o integrador deduplicar por este header. Se ele
    // mudasse a cada tentativa, uma reentrega (nosso POST chegou mas a
    // resposta se perdeu) viraria processamento duplicado da mesma resposta do
    // contato — a deduplicação prometida simplesmente não funcionaria.
    await processWebhookJob(job({ attemptsMade: 0 }));
    await processWebhookJob(job({ attemptsMade: 1 }));
    await processWebhookJob(job({ attemptsMade: 4 }));

    const ids = fetchMock.mock.calls.map(([, o]: any) => o.headers['X-ZapScript-Delivery']);
    expect(new Set(ids).size).toBe(1);

    // O número da tentativa, por outro lado, avança no log de entregas.
    const attempts = logCreate.mock.calls.map(([a]: any) => a.data.attempt);
    expect(attempts).toEqual([1, 2, 5]);
  });

  it('job antigo sem deliveryId (em voo no deploy) cai num id derivado do job', async () => {
    await processWebhookJob(job({ deliveryId: undefined, id: 'job_42' }));
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['X-ZapScript-Delivery']).toBe('job-job_42');
  });

  it('o corpo tem o envelope { event, timestamp, data } esperado pelo integrador', async () => {
    await processWebhookJob(job());
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      event:     'message.received',
      timestamp: '2026-10-02T14:30:00Z',
      data:      { contactPhone: '5511999999999', text: 'sim' },
    });
  });
});

describe('assinatura de eventos e guardas', () => {
  it('descarta (sem POST) se a config ficou inativa após o enfileiramento', async () => {
    findUnique.mockResolvedValue({ active: false, events: ['message.received'], url: URL, secret: PLAIN_SECRET });
    await expect(processWebhookJob(job())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descarta se o evento não está mais assinado', async () => {
    findUnique.mockResolvedValue({ active: true, events: ['transcription.completed'], url: URL, secret: PLAIN_SECRET });
    await processWebhookJob(job());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não faz POST se a URL falha na revalidação anti-SSRF (DNS rebinding)', async () => {
    urlGuard.mockResolvedValue({ ok: false, error: 'IP interno' });
    await expect(processWebhookJob(job())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    // Registra a recusa para o dono conseguir diagnosticar.
    expect(logCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ success: false }),
    }));
  });
});

describe('política de retry', () => {
  it('erro de rede/timeout LANÇA (fila reentrega)', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(processWebhookJob(job())).rejects.toThrow(/ETIMEDOUT/);
  });

  it('5xx LANÇA (indisponibilidade temporária do receptor)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(processWebhookJob(job())).rejects.toThrow(/503/);
  });

  it('4xx permanente NÃO lança (retry não conserta payload recusado)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(processWebhookJob(job())).resolves.toBeUndefined();
  });

  it('408 e 429 LANÇAM (são os 4xx que valem retry)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(processWebhookJob(job())).rejects.toThrow(/429/);
    fetchMock.mockResolvedValue({ ok: false, status: 408 });
    await expect(processWebhookJob(job())).rejects.toThrow(/408/);
  });

  it('2xx não lança e registra entrega bem-sucedida', async () => {
    await expect(processWebhookJob(job())).resolves.toBeUndefined();
    expect(logCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ success: true, httpStatus: 200, attempt: 1 }),
    }));
  });

  it('falha ao gravar o log NÃO derruba a entrega', async () => {
    logCreate.mockRejectedValue(new Error('banco caiu'));
    await expect(processWebhookJob(job())).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });
});
