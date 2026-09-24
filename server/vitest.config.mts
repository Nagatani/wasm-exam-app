import os from 'node:os';
import path from 'node:path';
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
// The `judge` project (real Java/C execution through the judge container)
// gets its own database so it can run alongside `integration`.
process.env.TEST_JUDGE_DATABASE_URL ??= TEST_DATABASE_URL.replace(/\/([^/?]+)_test(\?|$)/, '/$1_judge_test$2');
process.env.TEST_JUDGE_URL ??= 'http://localhost:4001';
// Image uploads written by the tests go to a temp dir, not server/uploads.
const TEST_UPLOADS_DIR = path.join(os.tmpdir(), 'wasm-exam-test-uploads');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/integration/**', 'test/judge/**'],
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
            UPLOADS_DIR: TEST_UPLOADS_DIR,
          },
        },
      },
      {
        test: {
          name: 'judge',
          include: ['test/judge/**/*.test.ts'],
          globalSetup: ['test/judge/globalSetup.ts'],
          fileParallelism: false,
          // javac/gcc + JVM start-up per submission; a TLE case waits out
          // its time limit.
          testTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_JUDGE_DATABASE_URL,
            JUDGE_URL: process.env.TEST_JUDGE_URL,
            NODE_ENV: 'test',
            UPLOADS_DIR: TEST_UPLOADS_DIR,
          },
        },
      },
    ],
  },
});
