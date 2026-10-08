const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.cjs'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'worker/**/*.cjs',
    '!**/*.d.ts',
    '!**/*.config.*',
  ],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'cjs', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: false,
    }],
    '^.+\\.cjs$': 'ts-jest',
  },
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
};

module.exports = createJestConfig(config);
