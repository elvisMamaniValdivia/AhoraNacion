import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://agenda:agenda@localhost:5433/agenda_test',
      DIRECT_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://agenda:agenda@localhost:5433/agenda_test',
      BCRYPT_COST: '4',
      EMAIL_PROVIDER: 'console',
      ENABLE_WORKER: 'false',
      WORKER_SECRET: 'secreto-de-prueba-0123456789',
    },
  },
});
