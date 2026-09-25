import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Browser E2E tests (e2e/*.spec.ts): the real app — production frontend build
// served by the real server, on a throwaway `*_e2e_test` database — driven by
// Chromium. `npm run test:e2e`; needs the dev `db` container (host port 5433).
//
// The webServer command builds the server and a frontend bundle into
// .e2e-dist (never touching dist/), empties the E2E database, then runs the
// consolidated server on PORT, so page + API are same-origin like production.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://wasm_exam:wasm_exam@localhost:5433/wasm_exam_e2e_test';
const DIST = path.resolve('.e2e-dist');

export default defineConfig({
  testDir: 'e2e',
  // One shared database, and the specs build on each other's data.
  workers: 1,
  fullyParallel: false,
  // No retries: the specs run serially and seed a fresh database once in
  // beforeAll, so a retry would re-run the seeding against existing rows.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'npm --prefix server run build',
      '(cd server && npx tsx scripts/e2e-prepare-db.ts)',
      `npx vite build --outDir ${DIST} --emptyOutDir`,
      'node server/dist/index.js',
    ].join(' && '),
    url: `http://localhost:${PORT}/api/auth/signup-status`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    env: {
      PORT: String(PORT),
      DATABASE_URL,
      CLIENT_DIST_PATH: DIST,
      // Same-origin build: API calls are relative (like .env.production).
      VITE_API_BASE_URL: '',
      JUDGE_URL: '',
      ALLOW_SIGNUP: 'true',
      SESSION_CLEANUP_INTERVAL_HOURS: '0',
      // Run the real CSP (not report-only) so the specs prove the allow-list
      // is enough for Monaco / the JS runner / Pyodide; each spec also fails
      // on any securitypolicyviolation event (see e2e/exam-flow.spec.ts).
      CSP_MODE: 'enforce',
      UPLOADS_DIR: path.join(os.tmpdir(), 'wasm-exam-e2e-uploads'),
    },
  },
});
