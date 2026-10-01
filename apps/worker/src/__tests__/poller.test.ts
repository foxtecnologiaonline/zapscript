/**
 * Testes do poller adaptativo (lib/poller.ts) — o mecanismo que substituiu os
 * setInterval fixos de 30s/60s dos agendadores.
 *
 * O que estes testes travam são os critérios de aceite da mudança: a cadência
 * com trabalho em mão continua igual à de antes, a ociosidade desacelera até o
 * teto, e um trabalho agendado conhecido (horizonte) nunca é dormido além da
 * hora. `jitterPct: 0` em todos os casos — a dispersão aleatória existe para
 * produção, não para asserção.
 */
jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { startPoller, envMs } from '../lib/poller';

/** Avança os fake timers e deixa as microtasks do tick assíncrono drenarem. */
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const MIN = 1_000;
const MAX = 16_000;

describe('startPoller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('roda o primeiro tick imediatamente (mesmo comportamento do boot anterior)', async () => {
    const tick = jest.fn(async () => ({ worked: false }));
    const p = startPoller({ name: 't1', minMs: MIN, maxMs: MAX, jitterPct: 0, tick });

    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it('mantém o intervalo mínimo enquanto acha trabalho', async () => {
    const tick = jest.fn(async () => ({ worked: true }));
    const p = startPoller({ name: 't2', minMs: MIN, maxMs: MAX, jitterPct: 0, tick });

    await advance(0);
    for (let i = 0; i < 5; i++) await advance(MIN);

    expect(p.currentDelayMs()).toBe(MIN);
    expect(tick).toHaveBeenCalledTimes(6);
    p.stop();
  });

  it('dobra o intervalo em ociosidade e para no teto', async () => {
    const tick = jest.fn(async () => ({ worked: false }));
    const p = startPoller({ name: 't3', minMs: MIN, maxMs: MAX, jitterPct: 0, tick });

    await advance(0);
    expect(p.currentDelayMs()).toBe(2_000);   // 1s → 2s
    await advance(2_000);
    expect(p.currentDelayMs()).toBe(4_000);
    await advance(4_000);
    expect(p.currentDelayMs()).toBe(8_000);
    await advance(8_000);
    expect(p.currentDelayMs()).toBe(MAX);     // 16s = teto
    await advance(MAX);
    expect(p.currentDelayMs()).toBe(MAX);     // não passa do teto
    p.stop();
  });

  it('volta ao mínimo no primeiro tick que acha trabalho (sem atraso de UX)', async () => {
    let worked = false;
    const p = startPoller({
      name: 't4', minMs: MIN, maxMs: MAX, jitterPct: 0,
      tick: async () => ({ worked }),
    });

    await advance(0);
    await advance(2_000);
    await advance(4_000);
    expect(p.currentDelayMs()).toBe(8_000);   // já desacelerado

    worked = true;
    await advance(8_000);
    expect(p.currentDelayMs()).toBe(MIN);     // voltou na hora
    p.stop();
  });

  it('o horizonte encurta o sono para não dormir além do próximo agendamento', async () => {
    // Ocioso, mas com trabalho conhecido daqui 3s: o backoff pediria 2s e
    // depois 4s — o horizonte corta em 3s para acordar na hora.
    const p = startPoller({
      name: 't5', minMs: MIN, maxMs: MAX, jitterPct: 0,
      tick: async () => ({ worked: false, nextAt: new Date(Date.now() + 3_000) }),
    });

    await advance(0);
    expect(p.currentDelayMs()).toBe(2_000);   // backoff < horizonte → vence o backoff
    await advance(2_000);
    expect(p.currentDelayMs()).toBe(3_000);   // backoff pediria 4s; horizonte corta em 3s
    p.stop();
  });

  it('o horizonte nunca acorda antes do intervalo mínimo', async () => {
    const p = startPoller({
      name: 't6', minMs: MIN, maxMs: MAX, jitterPct: 0,
      // Agendamento no passado (já vencido) não pode virar sono de 0ms em loop.
      tick: async () => ({ worked: false, nextAt: new Date(Date.now() - 60_000) }),
    });

    await advance(0);
    expect(p.currentDelayMs()).toBe(MIN);
    p.stop();
  });

  it('tick que lança não derruba o poller e aplica backoff', async () => {
    const tick = jest.fn(async () => { throw new Error('banco fora'); });
    const p = startPoller({ name: 't7', minMs: MIN, maxMs: MAX, jitterPct: 0, tick });

    await advance(0);
    expect(p.currentDelayMs()).toBe(2_000);   // falha = backoff, não martela o banco
    await advance(2_000);
    expect(tick).toHaveBeenCalledTimes(2);    // continua vivo
    p.stop();
  });

  it('stop() cancela o próximo tick', async () => {
    const tick = jest.fn(async () => ({ worked: true }));
    const p = startPoller({ name: 't8', minMs: MIN, maxMs: MAX, jitterPct: 0, tick });

    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    p.stop();
    await advance(MIN * 10);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('tick que devolve void é tratado como ociosidade', async () => {
    const p = startPoller({
      name: 't9', minMs: MIN, maxMs: MAX, jitterPct: 0,
      tick: async () => { /* sem retorno */ },
    });

    await advance(0);
    expect(p.currentDelayMs()).toBe(2_000);
    p.stop();
  });
});

describe('envMs', () => {
  const KEY = 'POLLER_TEST_MS';
  afterEach(() => { delete process.env[KEY]; });

  it('usa o default quando a variável não existe', () => {
    expect(envMs(KEY, 5_000)).toBe(5_000);
  });

  it('lê o valor da variável quando válido', () => {
    process.env[KEY] = '45000';
    expect(envMs(KEY, 5_000)).toBe(45_000);
  });

  it('cai no default quando a variável é inválida ou não positiva', () => {
    process.env[KEY] = 'abc';
    expect(envMs(KEY, 5_000)).toBe(5_000);
    process.env[KEY] = '0';
    expect(envMs(KEY, 5_000)).toBe(5_000);
    process.env[KEY] = '-10';
    expect(envMs(KEY, 5_000)).toBe(5_000);
  });
});
