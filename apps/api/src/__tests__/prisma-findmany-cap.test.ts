// Precisa vir ANTES do import de lib/prisma: o teto é lido no carregamento do módulo.
process.env.PRISMA_FIND_MANY_CAP = '3';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

const warn = jest.fn();
jest.mock('../lib/logger', () => ({ logger: { warn: (...a: any[]) => warn(...a), info: jest.fn(), error: jest.fn() } }));

import { prisma } from '../lib/prisma';

const QUEUE = 'test-cap';

beforeAll(async () => {
  await prisma.failedJob.deleteMany({ where: { queue: QUEUE } });
  // 5 linhas com o teto em 3 → prova truncagem e warn
  for (let i = 0; i < 5; i++) {
    await prisma.failedJob.create({
      data: { queue: QUEUE, jobName: 'j', bullJobId: `cap-${i}`, payload: {}, errorMessage: 'e', attempts: 1 },
    });
  }
});
afterAll(async () => { await prisma.failedJob.deleteMany({ where: { queue: QUEUE } }); });
beforeEach(() => warn.mockReset());

test('findMany SEM take é limitado ao teto e avisa (nunca trunca em silêncio)', async () => {
  const rows = await prisma.failedJob.findMany({ where: { queue: QUEUE } });
  expect(rows).toHaveLength(3);                      // truncado no teto
  expect(warn).toHaveBeenCalledTimes(1);             // e avisado
  expect(String(warn.mock.calls[0][1])).toContain('precisa de paginação explícita');
});

test('findMany COM take explícito é respeitado e não avisa', async () => {
  const rows = await prisma.failedJob.findMany({ where: { queue: QUEUE }, take: 2 });
  expect(rows).toHaveLength(2);
  expect(warn).not.toHaveBeenCalled();
});

test('take explícito ACIMA do teto continua valendo — o teto não é um limite de verdade', async () => {
  const rows = await prisma.failedJob.findMany({ where: { queue: QUEUE }, take: 100 });
  expect(rows).toHaveLength(5);                      // todas as 5, teto não se aplica
  expect(warn).not.toHaveBeenCalled();
});

test('resultado abaixo do teto não dispara aviso', async () => {
  const rows = await prisma.failedJob.findMany({ where: { queue: 'nao-existe-nada' } });
  expect(rows).toHaveLength(0);
  expect(warn).not.toHaveBeenCalled();
});
