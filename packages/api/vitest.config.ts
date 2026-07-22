import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://app_user:app_user_pw@localhost:5432/budget_tracker_test',
      TEST_ADMIN_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/budget_tracker_test',
      JWT_ACCESS_SECRET: 'test-access-secret-not-for-production-0000',
      JWT_REFRESH_SECRET: 'test-refresh-secret-not-for-production-0000',
      NODE_ENV: 'test',
    },
    testTimeout: 15000,
    fileParallelism: false, // shared DB — tests reset it between runs, must not race
  },
});
