/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@zapscript/database$': '<rootDir>/../../packages/database/src',
  },
  setupFilesAfterFramework: [],
  globals: {
    'ts-jest': { tsconfig: { strict: false } },
  },
};
