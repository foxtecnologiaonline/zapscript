/**
 * Guarda de divergência entre as duas cópias da matemática de data do ZapMonney.
 *
 * `routes/zapmonney.ts` (API, consumida pelo MonneyHub) e
 * `apps/worker/src/services/zapmonney-executor.ts` (conversa no WhatsApp) têm
 * cópias gêmeas de todayBrt/occurredAtFrom/fechamento de mês, porque API e
 * worker são imagens Docker separadas e não compartilham código de aplicação.
 *
 * As fixtures abaixo são as MESMAS de
 * `apps/worker/src/__tests__/zapmonney-executor.test.ts`. Se uma cópia mudar de
 * comportamento, este arquivo quebra — que é o ponto. Sem isso a divergência
 * apareceria como "o app mostra um mês diferente do que o WhatsApp responde",
 * que é um bug caro de diagnosticar e fácil de introduzir.
 */

jest.mock('../lib/prisma', () => ({ prisma: {} }));
jest.mock('../services/queue', () => ({ redis: {} }));
jest.mock('../services/evolution', () => ({ sendText: jest.fn() }));
jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { todayBrt, occurredAtFrom, monthRange } from '../routes/zapmonney';

describe('todayBrt — dia de São Paulo, não de UTC', () => {
  it('02/10 01:00 UTC ainda é 01/10 em São Paulo', () => {
    expect(todayBrt(new Date('2026-10-02T01:00:00Z'))).toBe('2026-10-01');
  });

  it('02/10 04:00 UTC já é 02/10 em São Paulo', () => {
    expect(todayBrt(new Date('2026-10-02T04:00:00Z'))).toBe('2026-10-02');
  });
});

describe('occurredAtFrom — 12:00 BRT = 15:00 UTC', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('grava meio-dia BRT da data informada', () => {
    expect(occurredAtFrom('2026-09-20', now).toISOString()).toBe('2026-09-20T15:00:00.000Z');
  });

  it('cai em hoje quando a data vem no futuro', () => {
    expect(occurredAtFrom('2027-01-05', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('cai em hoje quando a data vem ausente ou inválida', () => {
    expect(occurredAtFrom(undefined, now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(occurredAtFrom('ontem', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('rejeita data com formato certo mas que não existe no calendário', () => {
    // 30/02 casa o regex e o Date.UTC rolaria para 02/03 — o lançamento mudaria
    // de mês calado e sumiria do saldo que a pessoa está olhando.
    expect(occurredAtFrom('2026-02-30', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(occurredAtFrom('2026-04-31', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(occurredAtFrom('2026-13-01', now).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('aceita 29/02 em ano bissexto', () => {
    expect(occurredAtFrom('2024-02-29', now).toISOString()).toBe('2024-02-29T15:00:00.000Z');
  });
});

describe('monthRange — mês fechado em São Paulo', () => {
  it('abre o mês às 00:00 BRT (03:00 UTC)', () => {
    const r = monthRange('2026-10', new Date('2026-10-15T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(r.label).toBe('outubro de 2026');
  });

  it('sem mês informado, usa o corrente em São Paulo', () => {
    const r = monthRange(undefined, new Date('2026-10-15T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.label).toBe('outubro de 2026');
  });

  it('vira o ano corretamente em dezembro', () => {
    const r = monthRange('2025-12', new Date('2026-01-10T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2025-12-01T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(r.label).toBe('dezembro de 2025');
  });

  it('o fim de um mês é exatamente o início do seguinte — nenhum instante fica fora', () => {
    const out = monthRange('2026-10', new Date('2026-10-15T12:00:00Z'));
    const nov = monthRange('2026-11', new Date('2026-10-15T12:00:00Z'));
    expect(out.end.toISOString()).toBe(nov.start.toISOString());
  });
});
