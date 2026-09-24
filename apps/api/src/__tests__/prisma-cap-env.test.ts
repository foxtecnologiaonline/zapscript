process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

/**
 * O teto entra como `take` em TODA query sem take da API. Um
 * PRISMA_FIND_MANY_CAP mal digitado viraria `take: NaN` (erro no Prisma) ou
 * `take: 0` (zero linhas em tudo) — a API inteira quebraria em silêncio por
 * causa de uma variável de ambiente. Estes testes garantem que valor inválido
 * cai no default em vez de derrubar.
 */
const warn = jest.fn();
jest.mock('../lib/logger', () => ({ logger: { warn: (...a: any[]) => warn(...a), info: jest.fn(), error: jest.fn() } }));

const QUEUE = 'test-cap-env';

async function comCap(valor: string | undefined) {
  jest.resetModules();
  warn.mockReset();
  // lib/prisma guarda o client em global.__prisma fora de produção (padrão de
  // hot-reload). resetModules limpa o registro de módulos, mas NÃO o global —
  // sem apagar aqui, todo reimport reusaria o client do primeiro teste e o
  // teto novo nunca valeria.
  delete (global as any).__prisma;
  if (valor === undefined) delete process.env.PRISMA_FIND_MANY_CAP;
  else process.env.PRISMA_FIND_MANY_CAP = valor;
  return (await import('../lib/prisma')).prisma;
}

afterAll(async () => {
  delete process.env.PRISMA_FIND_MANY_CAP;
  const { prisma } = await import('../lib/prisma');
  await prisma.failedJob.deleteMany({ where: { queue: QUEUE } });
});

const semear = async (prisma: any, n: number) => {
  await prisma.failedJob.deleteMany({ where: { queue: QUEUE } });
  for (let i = 0; i < n; i++) {
    await prisma.failedJob.create({
      data: { queue: QUEUE, jobName: 'j', bullJobId: `env-${i}-${Date.now()}`, payload: {}, errorMessage: 'e', attempts: 1 },
    });
  }
};

test('valor não numérico cai no default e avisa — não vira take:NaN', async () => {
  const prisma = await comCap('abc');
  await semear(prisma, 3);
  const rows = await prisma.failedJob.findMany({ where: { queue: QUEUE } });
  expect(rows).toHaveLength(3);                       // funcionou, não quebrou
  expect(warn).toHaveBeenCalled();
  expect(String(warn.mock.calls[0][1])).toContain('inválido');
});

test('zero cai no default — não zera o resultado de toda query', async () => {
  const prisma = await comCap('0');
  await semear(prisma, 3);
  expect(await prisma.failedJob.findMany({ where: { queue: QUEUE } })).toHaveLength(3);
  expect(warn).toHaveBeenCalled();
});

test('negativo e decimal também caem no default', async () => {
  for (const v of ['-10', '2.5']) {
    const prisma = await comCap(v);
    await semear(prisma, 3);
    expect(await prisma.failedJob.findMany({ where: { queue: QUEUE } })).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
  }
});

test('valor válido é respeitado e não avisa', async () => {
  const prisma = await comCap('2');
  await semear(prisma, 3);
  const rows = await prisma.failedJob.findMany({ where: { queue: QUEUE } });
  expect(rows).toHaveLength(2);                       // teto aplicado
  expect(warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('inválido'));
});

test('sem a variável usa o default e não avisa', async () => {
  const prisma = await comCap(undefined);
  await semear(prisma, 3);
  expect(await prisma.failedJob.findMany({ where: { queue: QUEUE } })).toHaveLength(3);
  expect(warn).not.toHaveBeenCalled();
});
