import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/core': path.resolve(__dirname, 'src/core'),
      '@/config': path.resolve(__dirname, 'src/config'),
      '@/infrastructure': path.resolve(__dirname, 'src/infrastructure'),
      '@/agents': path.resolve(__dirname, 'src/agents'),
      '@/backends': path.resolve(__dirname, 'src/backends'),
      '@/cli': path.resolve(__dirname, 'src/cli'),
      '@/streaming': path.resolve(__dirname, 'src/streaming'),
      '@/plugins': path.resolve(__dirname, 'src/plugins'),
    },
  },
})
