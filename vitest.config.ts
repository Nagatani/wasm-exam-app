import { defineConfig } from 'vitest/config'

// Frontend unit tests: pure helpers under src/ (parsers, reordering, the AI
// hint context builder, ...). Runs in plain Node — no DOM, no Vite plugins —
// since nothing tested here touches React or the browser. The server has its
// own suites (server/vitest.config.mts), including the parity test that runs
// src/lib/compareOutput.ts against the server's judge.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
