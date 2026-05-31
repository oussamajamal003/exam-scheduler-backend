/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup/testEnv.cjs'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/testProcessTeardown.js'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  testTimeout: 180000,
  transform: {},
  verbose: true,
  // Force serial execution: tests share the single test database.
  maxWorkers: 1,
};
