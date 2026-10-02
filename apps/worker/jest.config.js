/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Importar um módulo que registra Worker/cron (ex.: src/messages-out.ts) traz
  // os handles de intervalo/conexão do próprio módulo. Os intervalos já usam
  // unref(), mas o mock de bullmq/ioredis pode deixar handle aberto conforme a
  // suíte — forceExit garante que o processo encerra quando os testes terminam,
  // mesmo padrão já adotado em apps/api/jest.config.js.
  forceExit: true,
  globals: {
    'ts-jest': { tsconfig: { strict: false } },
  },
};
