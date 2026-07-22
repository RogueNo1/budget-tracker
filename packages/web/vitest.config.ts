import { defineConfig } from 'vite';
import { defineConfig as defineVitestConfig, mergeConfig } from 'vitest/config';

const viteConfig = defineConfig({});

export default mergeConfig(
  viteConfig,
  defineVitestConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
    },
  }),
);
