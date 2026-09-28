import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const integration = process.env.SMCL_INTEGRATION === '1'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: integration ? ['tests/integration/**/*.test.ts'] : ['tests/unit/**/*.test.ts'],
    testTimeout: integration ? 1_800_000 : 20_000,
    hookTimeout: integration ? 1_800_000 : 20_000,
    fileParallelism: !integration,
  },
})
