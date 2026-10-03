/**
 * Métricas de plataforma (item 7 do escopo ZapScript × Twilio), lendo as
 * tabelas que a API pública v1 de fato produz.
 *
 * O que estes testes travam, acima de tudo: a AUSÊNCIA de taxa de entrega. O
 * envio da v1 sai pela Evolution, que confirma "aceitei para envio" e não "o
 * aparelho recebeu". Publicar um deliveryRate calculado sobre `sent` seria
 * apresentar uma coisa como a outra — exatamente a confusão que o item 7 existe
 * para desfazer.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    outboundMessage: { groupBy: jest.fn(), count: jest.fn() },
    inboundMessage:  { groupBy: jest.fn() },
    webhookDelivery: { groupBy: jest.fn() },
    $queryRaw:       jest.fn(),
  },
}));

import { prisma } from '../lib/prisma';
import {
  resolveWindow, getOutboundMetrics, getInboundMetrics, getWebhookMetrics,
  getMessageSeries, getPlatformMetrics, renderPrometheusMetrics,
} from '../services/metrics';

const db = prisma as any;

const janela = () => resolveWindow({
  since: '2026-09-25T00:00:00Z', until: '2026-10-02T00:00:00Z',
});

/** groupBy devolve um registro por valor do campo pedido. */
const grupos = (field: string, pares: Record<string, number>) =>
  Object.entries(pares).map(([k, v]) => ({
    [field]: k === 'true' ? true : k === 'false' ? false : k,
    _count: { _all: v },
  }));

beforeEach(() => {
  jest.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.outboundMessage.groupBy.mockResolvedValue([]);
  db.outboundMessage.count.mockResolvedValue(0);
  db.inboundMessage.groupBy.mockResolvedValue([]);
  db.webhookDelivery.groupBy.mockResolvedValue([]);
});

describe('resolveWindow', () => {
  it('sem parâmetros usa os últimos 7 dias, por dia', () => {
    const w = resolveWindow({});
    expect(w.granularity).toBe('day');
    expect(Math.round((w.until.getTime() - w.since.getTime()) / 86_400_000)).toBe(7);
  });

  it('só aceita hour|day — nada do cliente chega cru na query', () => {
    expect(resolveWindow({ granularity: 'hour' }).granularity).toBe('hour');
    expect(resolveWindow({ granularity: "day'; DROP TABLE" }).granularity).toBe('day');
  });

  it('recusa data inválida, intervalo invertido e período longo demais', () => {
    expect(() => resolveWindow({ since: 'ontem' })).toThrow(/ISO 8601/);
    expect(() => resolveWindow({ since: '2026-10-02T00:00:00Z', until: '2026-10-01T00:00:00Z' })).toThrow(/anterior/);
    expect(() => resolveWindow({ since: '2025-01-01T00:00:00Z', until: '2026-01-01T00:00:00Z' })).toThrow(/92 dias/);
    expect(() => resolveWindow({
      since: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z', granularity: 'hour',
    })).toThrow(/8 dias/);
  });
});

describe('getOutboundMetrics', () => {
  it('calcula envio/falha sobre o que chegou a um estado terminal', async () => {
    db.outboundMessage.groupBy
      .mockResolvedValueOnce(grupos('status', { sent: 90, failed: 10, queued: 5 }))
      .mockResolvedValueOnce(grupos('source', { public_api: 95, dashboard: 10 }))
      .mockResolvedValueOnce([{ errorCode: 'message.invalid_recipient', _count: { _all: 6 } }]);

    const m = await getOutboundMetrics('u1', janela());

    // `queued` fica FORA da base: ainda vai ser tentada, contá-la como falha
    // mostraria uma taxa pior que a real a cada pico de volume.
    expect(m.sentRate).toBe(90);
    expect(m.failureRate).toBe(10);
    expect(m.total).toBe(105);
    expect(m.topErrorCodes).toEqual([{ code: 'message.invalid_recipient', count: 6 }]);
  });

  it('NÃO expõe taxa de entrega — a Evolution não confirma entrega', async () => {
    db.outboundMessage.groupBy
      .mockResolvedValueOnce(grupos('status', { sent: 10 }))
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const m: any = await getOutboundMetrics('u1', janela());
    expect(m.deliveryRate).toBeUndefined();
    expect(m.readRate).toBeUndefined();
  });

  it('sem envio terminal as taxas são null, não 0 nem NaN', async () => {
    db.outboundMessage.groupBy
      .mockResolvedValueOnce(grupos('status', { queued: 3 }))
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const m = await getOutboundMetrics('u1', janela());
    // null = "não há base para calcular", diferente de 0% = "nada foi enviado".
    expect(m.sentRate).toBeNull();
    expect(m.failureRate).toBeNull();
  });

  it('agrupa erro só de quem falhou', async () => {
    db.outboundMessage.groupBy
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await getOutboundMetrics('u1', janela());
    const chamadaErro = db.outboundMessage.groupBy.mock.calls[2][0];
    expect(chamadaErro.where.errorCode).toEqual({ not: null });
  });
});

describe('getInboundMetrics', () => {
  it('soma por tipo e por canal', async () => {
    db.inboundMessage.groupBy
      .mockResolvedValueOnce(grupos('type', { text: 40, audio: 12 }))
      .mockResolvedValueOnce(grupos('channel', { evolution: 50, meta: 2 }));

    const m = await getInboundMetrics('u1', janela());
    expect(m.total).toBe(52);
    expect(m.byType).toEqual({ text: 40, audio: 12 });
    expect(m.byChannel).toEqual({ evolution: 50, meta: 2 });
  });
});

describe('getWebhookMetrics', () => {
  it('conta tentativas (uma linha por tentativa) e a taxa de sucesso', async () => {
    db.webhookDelivery.groupBy
      .mockResolvedValueOnce(grupos('success', { true: 90, false: 10 }))
      .mockResolvedValueOnce(grupos('event', { 'message.received': 70, 'message.status': 30 }))
      .mockResolvedValueOnce([{ httpStatus: 200, _count: { _all: 90 } }, { httpStatus: 500, _count: { _all: 10 } }]);

    const w = await getWebhookMetrics('u1', janela());
    expect(w.attempts).toBe(100);
    expect(w.succeeded).toBe(90);
    expect(w.failed).toBe(10);
    expect(w.successRate).toBe(90);
    expect(w.byHttpStatus).toEqual({ '200': 90, '500': 10 });
  });

  it('sem entrega a taxa é null', async () => {
    const w = await getWebhookMetrics('u1', janela());
    expect(w.successRate).toBeNull();
    expect(w.attempts).toBe(0);
  });
});

describe('série temporal', () => {
  it('converte bucket para ISO e BigInt do COUNT para number', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { bucket: new Date('2026-10-01T00:00:00Z'), queued: 1n, sent: 2n, failed: 3n, received: 4n },
    ]);
    // BigInt precisa virar number — senão JSON.stringify estoura na resposta.
    expect(await getMessageSeries('u1', janela())).toEqual([
      { bucket: '2026-10-01T00:00:00.000Z', queued: 1, sent: 2, failed: 3, received: 4 },
    ]);
  });

  it('bucket presente só na entrada não some (FULL JOIN, não costura no Node)', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { bucket: new Date('2026-10-01T00:00:00Z'), queued: 0, sent: 0, failed: 0, received: 7 },
    ]);
    const serie = await getMessageSeries('u1', janela());
    expect(serie[0].received).toBe(7);
    expect(serie[0].sent).toBe(0);
  });
});

describe('getPlatformMetrics', () => {
  it('devolve o período e as quatro seções', async () => {
    const m = await getPlatformMetrics('u1', janela());
    expect(m.period).toMatchObject({ granularity: 'day', numberId: null });
    expect(m.outbound).toBeDefined();
    expect(m.inbound).toBeDefined();
    expect(m.webhooks).toBeDefined();
    expect(Array.isArray(m.series)).toBe(true);
  });
});

describe('exposição Prometheus (operação)', () => {
  it('rende sem identificador de usuário e com o sinal de fila parada', async () => {
    db.outboundMessage.groupBy
      .mockResolvedValueOnce(grupos('status', { sent: 5, failed: 1 }))
      .mockResolvedValueOnce([{ errorCode: 'number.disconnected', _count: { _all: 1 } }]);
    db.webhookDelivery.groupBy.mockResolvedValueOnce(grupos('success', { true: 4 }));
    db.inboundMessage.groupBy.mockResolvedValueOnce(grupos('channel', { evolution: 9 }));
    db.outboundMessage.count.mockResolvedValueOnce(3);

    const texto = await renderPrometheusMetrics();

    expect(texto).toContain('zapscript_outbound_24h{status="sent"} 5');
    expect(texto).toContain('zapscript_outbound_errors_24h{code="number.disconnected"} 1');
    expect(texto).toContain('zapscript_inbound_24h{channel="evolution"} 9');
    expect(texto).toContain('zapscript_webhook_attempts_24h{success="true"} 4');
    // O sinal mais acionável: envio aceito que não saiu = fila parada.
    expect(texto).toContain('zapscript_outbound_stuck_queued 3');
    // Cardinalidade por tenant explodiria o Prometheus — e seria dado de cliente
    // num sistema de observabilidade.
    expect(texto).not.toMatch(/user|tenant/i);
  });
});
