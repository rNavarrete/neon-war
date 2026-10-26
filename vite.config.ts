import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', globals: true, include: ['tests/**/*.test.ts'] },
});
