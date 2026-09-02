import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/**/*.test.ts'],
      include: ['src/**/*.ts'],
      thresholds: {
        '100': true,
        perFile: true,
      },
    },
  },
});
