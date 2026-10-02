/**
 * Métricas de plataforma (item 7 do escopo ZapScript × Twilio).
 *
 * O detalhe que mais erra numa implementação ingênua: `status` no MessageLog é
 * o ESTADO ATUAL, não um acumulado. Uma mensagem lida conta só em `read` — se a
 * taxa de entrega dividir por `sent`, dá absurdo (ou divisão por zero) assim
 * que os status avançam.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    messageLog:      { groupBy: jest.fn(), count: jest.fn() },
    platformEvent:   { groupBy: jest.fn() },
    webhookEndpoint: { findMany: jest.fn() },
    webhookDelivery: { groupBy: jest.fn() },
    $queryRaw:       jest.fn(),
  },
}));

jest.mock('../services/queue', () => ({
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import {
  resolveWindow, getMessageMetrics, getWebhookMetrics, getEventMetrics,
  getMessageSeries, getTopErrorCodes, renderPrometheusMetrics,
} from '../services/metrics';

const db = prisma as any;

const janela = () => resolveWindow({
  since: '2026-09-25T00:00:00Z', until: '2026-10-02T00:00:00Z',
});

/** groupBy devolve um formato por campo pedido — este helper monta isso. */
const grupos = (field: string, pares: Record<string, number>) =>
  Object.entries(pares).map(([k, v]) => ({ [field]: k, _count: { _all: v } }));

beforeEach(() => {
  jest.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.messageLog.groupBy.mockResolvedValue([]);
  db.messageLog.count.mockResolvedValue(0);
  db.platformEvent.groupBy.mockResolvedValue([]);
  db.webhookEndpoint.findMany.mockResolvedValue([]);
  db.webhookDelivery.groupBy.mockResolvedValue([]);
});

describe('resolveWindow', () => {
  it('sem parâmetros usa os últimos 7 dias por dia', () => {
    const w = resolveWindow({});
    expect(w.granularity).toBe('day');
    const dias = (w.until.getTime() - w.since.getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(7);
  });

  it('aceita granularity=hour e rejeita qualquer outro valor silenciosamente', () => {
    expect(resolveWindow({ granularity: 'hour' }).granularity).toBe('hour');
    // Nunca chega SQL cru vindo do cliente: só 'hour' | 'day' passam.
    expect(resolveWindow({ granularity: "day'; DROP TABLE" }).granularity).toBe('day');
  });

  it('recusa data inválida, intervalo invertido e período longo demais', () => {
    expect(() => resolveWindow({ since: 'ontem' })).toThrow(/ISO 8601/);
    expect(() => resolveWindow({ since: '2026-10-02T00:00:00Z', until: '2026-10-01T00:00:00Z' }))
      .toThrow(/anterior/);
    expect(() => resolveWindow({ since: '2025-01-01T00:00:00Z', until: '2026-01-01T00:00:00Z' }))
      .toThrow(/92 dias/);
    expect(() => resolveWindow({
      since: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z', granularity: 'hour',
    })).toThrow(/8 dias/);
  });
});

describe('getMessageMetrics', () => {
  it('calcula entrega/falha/leitura tratando status como estado atual', async () => {
    db.messageLog.groupBy
      // byStatus
      .mockResolvedValueOnce(grupos('status', { sent: 10, delivered: 30, read: 50, failed: 10, queued: 5 }))
      .mockResolvedValueOnce(grupos('direction', { outbound: 100, inbound: 5 }))
      .mockResolvedValueOnce(grupos('channel', { meta: 90, evolution: 15 }))
      .mockResolvedValueOnce(grupos('source', { api: 60, campanha: 45 }))
      // topErrorCodes
      .mockResolvedValueOnce([{ errorCode: 'message.outside_window', _count: { _all: 7 } }]);

    const m = await getMessageMetrics('u1', janela());

    // base terminal = sent+delivered+read+failed = 100 (queued fica fora: ainda vai sair)
    expect(m.deliveryRate).toBe(80);  // (30+50)/100
    expect(m.failureRate).toBe(10);   // 10/100
    expect(m.readRate).toBe(62.5);    // 50/(30+50)
    expect(m.total).toBe(105);
    expect(m.topErrorCodes).toEqual([{ code: 'message.outside_window', count: 7 }]);
  });

  it('sem mensagem terminal as taxas são null, não 0 nem NaN', async () => {
    db.messageLog.groupBy
      .mockResolvedValueOnce(grupos('status', { queued: 3 }))
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const m = await getMessageMetrics('u1', janela());
    // null = "não há base para calcular", diferente de 0% = "nada foi entregue".
    expect(m.deliveryRate).toBeNull();
    expect(m.failureRate).toBeNull();
    expect(m.readRate).toBeNull();
  });
});

describe('série temporal', () => {
  it('agrega no banco e converte o bucket para ISO', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { bucket: new Date('2026-10-01T00:00:00Z'), queued: 1n, sent: 2n, delivered: 3n, read: 4n, failed: 5n, received: 6n },
    ]);
    const serie = await getMessageSeries('u1', janela());
    // BigInt do COUNT do Postgres precisa virar number — senão o JSON.stringify quebra.
    expect(serie).toEqual([{
      bucket: '2026-10-01T00:00:00.000Z',
      queued: 1, sent: 2, delivered: 3, read: 4, failed: 5, received: 6,
    }]);
  });

  it('filtra por numberId quando informado', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    await getMessageSeries('u1', { ...janela(), numberId: 'num-1' });
    expect(db.$queryRaw).toHaveBeenCalled();
  });
});

describe('getTopErrorCodes', () => {
  it('agrupa por código do catálogo, ignorando quem não falhou', async () => {
    db.messageLog.groupBy.mockResolvedValueOnce([
      { errorCode: 'message.undeliverable', _count: { _all: 9 } },
      { errorCode: 'template.param_mismatch', _count: { _all: 2 } },
    ]);
    const top = await getTopErrorCodes('u1', janela());
    expect(top).toEqual([
      { code: 'message.undeliverable', count: 9 },
      { code: 'template.param_mismatch', count: 2 },
    ]);
    expect(db.messageLog.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ errorCode: { not: null } }),
    }));
  });
});

describe('getWebhookMetrics', () => {
  it('conta endpoints ativos/desativados e a taxa de entrega', async () => {
    db.webhookEndpoint.findMany.mockResolvedValueOnce([
      { id: 'ep-1', active: true }, { id: 'ep-2', active: false },
    ]);
    db.webhookDelivery.groupBy.mockResolvedValueOnce(
      grupos('status', { succeeded: 90, failed: 10, pending: 5 }),
    );

    const w = await getWebhookMetrics('u1', janela());
    expect(w.endpoints).toEqual({ total: 2, active: 1, disabled: 1 });
    expect(w.deliveries).toEqual({ total: 105, succeeded: 90, failed: 10, pending: 5 });
    // Pendentes ficam FORA da base: ainda vão ser tentadas, contá-las como
    // falha mostraria uma taxa pior que a real a cada pico de volume.
    expect(w.successRate).toBe(90);
  });

  it('sem endpoint não consulta entregas', async () => {
    const w = await getWebhookMetrics('u1', janela());
    expect(db.webhookDelivery.groupBy).not.toHaveBeenCalled();
    expect(w.successRate).toBeNull();
  });
});

describe('getEventMetrics', () => {
  it('soma por tipo', async () => {
    db.platformEvent.groupBy.mockResolvedValueOnce(
      grupos('type', { 'message.sent': 12, 'message.delivered': 10 }),
    );
    const e = await getEventMetrics('u1', janela());
    expect(e.total).toBe(22);
    expect(e.byType).toEqual({ 'message.sent': 12, 'message.delivered': 10 });
  });
});

describe('exposição Prometheus (operação)', () => {
  it('rende sem identificador de usuário e com o sinal de fila parada', async () => {
    db.messageLog.groupBy
      .mockResolvedValueOnce(grupos('status', { sent: 5, failed: 1 }))
      .mockResolvedValueOnce(grupos('channel', { meta: 6 }))
      .mockResolvedValueOnce([{ errorCode: 'message.throttled', _count: { _all: 1 } }]);
    db.webhookDelivery.groupBy.mockResolvedValueOnce(grupos('status', { succeeded: 4 }));
    db.messageLog.count.mockResolvedValueOnce(3);

    const texto = await renderPrometheusMetrics();

    expect(texto).toContain('zapscript_messages_24h{status="sent"} 5');
    expect(texto).toContain('zapscript_messages_by_channel_24h{channel="meta"} 6');
    expect(texto).toContain('zapscript_message_errors_24h{code="message.throttled"} 1');
    expect(texto).toContain('zapscript_webhook_deliveries_24h{status="succeeded"} 4');
    // O sinal mais acionável: mensagem aceita que não saiu = fila parada.
    expect(texto).toContain('zapscript_messages_stuck_queued 3');
    // Cardinalidade por tenant explodiria o Prometheus — e seria dado de cliente
    // num sistema de observabilidade.
    expect(texto).not.toMatch(/user|tenant/i);
  });
});
