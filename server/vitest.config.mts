import { defineConfig } from 'vitest/config';

// Separate throwaway database for the integration suite — never the dev DB.
// Defaults to a sibling database on the same docker-compose `db` service
// (host port 5433). Set on process.env here (the main vitest process) so
// test/integration/globalSetup.ts — which runs in this process, not in a
// test worker, and so doesn't see the project `env` below — reads the same
// value. globalSetup refuses any database whose name doesn't end in `_test`,
// creates it if missing, and applies every migration before the suite starts.
process.env.TEST_DATABASE_URL ??= 'postgresql://wasm_exam:wasm_exam@localhost:5433/wasm_exam_test';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/integration/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/globalSetup.ts'],
          // Every file truncates the same database — run them one at a time.
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            // Java execution goes through the judge container; the
            // integration suite covers the client-exec path only and keeps
            // the judge out of the loop (empty ⇒ "not configured").
            JUDGE_URL: '',
            NODE_ENV: 'test',
          },
        },
      },
    ],
  },
});
