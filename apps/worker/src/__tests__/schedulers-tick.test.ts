/**
 * Contrato dos dois agendadores com o poller adaptativo (lib/poller.ts): o tick
 * devolve `worked` (houve disparo neste tick?) e `nextAt` (quando é o próximo
 * agendamento — o horizonte que o poller usa para acordar na hora).
 *
 * Nenhum dos dois tinha teste antes desta mudança, e é esta função que decide
 * tanto a pontualidade do disparo quanto a cadência do poller.
 *
 * fireCampanha()/fireMission() começam com um findUnique e retornam de imediato
 * se não encontram o registro — é o que permite exercitar o caminho "venceu,
 * dispara" sem montar o mundo inteiro de envio.
 */
jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    mission:  { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  },
}));
jest.mock('../lib/queue', () => ({
  campanhasQueue: { add: jest.fn(async () => ({ id: 'j1' })), addBulk: jest.fn(async () => []) },
  mktfastQueue:   { add: jest.fn(async () => ({ id: 'j2' })), addBulk: jest.fn(async () => []) },
}));
jest.mock('../services/mailer', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { runCampanhaSchedulerTick } from '../campanhas-scheduler';
import { runMissionSchedulerTick } from '../mktfast-scheduler';

const MIN = 60 * 1000;

/** Cada cenário roda igual nos dois agendadores — só muda a tabela e o tick. */
const casos = [
  { nome: 'campanhas-scheduler', tick: runCampanhaSchedulerTick, tabela: () => (prisma as any).campanha },
  { nome: 'mktfast-scheduler',   tick: runMissionSchedulerTick,  tabela: () => (prisma as any).mission },
];

describe.each(casos)('$nome — contrato do tick', ({ tick, tabela }) => {
  beforeEach(() => jest.clearAllMocks());

  it('sem agendamentos: worked false e sem horizonte (poller desacelera)', async () => {
    tabela().findMany.mockResolvedValueOnce([]);
    await expect(tick()).resolves.toEqual({ worked: false, nextAt: null });
  });

  it('só agendamentos futuros: não dispara nada e devolve o mais próximo como horizonte', async () => {
    const em5min  = new Date(Date.now() + 5 * MIN);
    const em30min = new Date(Date.now() + 30 * MIN);
    tabela().findMany.mockResolvedValueOnce([
      { id: 'futura-1', scheduledAt: em5min },
      { id: 'futura-2', scheduledAt: em30min },
    ]);

    await expect(tick()).resolves.toEqual({ worked: false, nextAt: em5min });
    // Nada vencido → nenhum fire foi tentado.
    expect(tabela().findUnique).not.toHaveBeenCalled();
  });

  it('vencidos + futuros: dispara os vencidos e aponta o horizonte para o próximo futuro', async () => {
    const venceu1 = new Date(Date.now() - 2 * MIN);
    const venceu2 = new Date(Date.now() - 1 * MIN);
    const futuro  = new Date(Date.now() + 10 * MIN);
    tabela().findMany.mockResolvedValueOnce([
      { id: 'venceu-1', scheduledAt: venceu1 },
      { id: 'venceu-2', scheduledAt: venceu2 },
      { id: 'futuro-1', scheduledAt: futuro },
    ]);

    await expect(tick()).resolves.toEqual({ worked: true, nextAt: futuro });
    // Os dois vencidos foram para o fire (que retorna cedo com findUnique null).
    expect(tabela().findUnique).toHaveBeenCalledTimes(2);
  });

  it('tudo vencido: worked true e sem horizonte', async () => {
    tabela().findMany.mockResolvedValueOnce([
      { id: 'venceu-1', scheduledAt: new Date(Date.now() - MIN) },
    ]);
    await expect(tick()).resolves.toEqual({ worked: true, nextAt: null });
  });

  it('consulta em ordem crescente e com lote limitado — vencido nunca fica atrás de futuro', async () => {
    tabela().findMany.mockResolvedValueOnce([]);
    await tick();

    const args = tabela().findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ scheduledAt: 'asc' });
    expect(args.take).toBe(50);
    expect(args.where.status).toBe('scheduled');
    expect(args.where.scheduledAt).toEqual({ not: null });
  });

  it('falha na query: worked false (o poller aplica backoff em vez de martelar o banco)', async () => {
    tabela().findMany.mockRejectedValueOnce(new Error('banco fora'));
    await expect(tick()).resolves.toEqual({ worked: false });
  });
});
