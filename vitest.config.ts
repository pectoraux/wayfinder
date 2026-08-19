import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Default test timeout. DB-backed integration tests that legitimately need
    // more time specify their own per-test timeout (e.g. `, 15000`).
    // Do NOT globally expand this to mask slow/failing tests — investigate
    // the root cause instead.
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
