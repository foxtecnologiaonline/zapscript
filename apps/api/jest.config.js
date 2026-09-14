/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Algumas rotas (auth.ts → onboarding-whatsapp.ts → support-intake.ts) importam
  // `{ io }` de `../index`, o que cria (como side-effect do import, fora do guard
  // de entrypoint) conexões reais de BullMQ/ioredis. Sem Redis disponível (ex.:
  // ambiente local sem Docker Compose), essas conexões ficam retentando
  // indefinidamente e travam a saída do Jest. forceExit garante que o processo
  // encerra assim que os testes terminam, mesmo com esses handles ainda abertos.
  forceExit: true,
  moduleNameMapper: {
    '^@zapscript/database$': '<rootDir>/../../packages/database/src',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false } }],
  },
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
};
