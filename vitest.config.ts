import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests use explicit fixtures and inherited process variables; do not load local secrets.
  envDir: false,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
