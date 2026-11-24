// Cada arquivo de teste tem seu próprio PrismaClient (global isolado pelo Jest): desconecta ao final para não acumular
// conexões abertas no Postgres ao rodar a suíte inteira com --runInBand.
afterAll(async () => {
  const p = (globalThis as { __prisma?: { $disconnect: () => Promise<void> } }).__prisma;
  if (p) await p.$disconnect().catch(() => undefined);
});
