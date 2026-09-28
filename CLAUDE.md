# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. This is the architecture / design-decision reference. User-facing docs live in [`README.md`](./README.md) (setup) and [`docs/`](./docs/): `teacher-guide.md` (authoring & grading), `languages.md` (per-language I/O, limits, judging rules), `operations.md` (deployment, env vars, headers, judge, accounts, backup), `development.md` (layout, commands, tests, CI), `roadmap.md` (open items and deliberate non-goals). Keep them in sync when behavior changes. Docs describe the current state only — no dated changelogs.

## What this is

A browser-based coding exam / practice system for a programming course. Each task is answered in exactly one language chosen by its author (`task.language`); students have no language picker. Languages: **C**, **JavaScript**, **TypeScript**, **Python**, **Java**.

- **Preview ("実行")**: C/JS/TS/Python run in the student's browser (C via WASI/`@wasmer/sdk` clang, JS/TS in a Web Worker with sucrase type-stripping, Python via Pyodide). Java runs on the server-side `judge` container.
- **Grading** (final submit, deadline auto-finalize, regrade): runs on the `judge` for all five languages whenever `JUDGE_URL` is set, using the *same runtimes and limits as the browser* so preview and grading can't disagree. Without a judge, grading falls back to browser-reported outcomes (legacy mode).
- Two flows: timed **exams** (`Exam.mode = EXAM`, attempts + drafts + one final submit) and untimed **practice** (`mode = PRACTICE`, unlimited submissions, optional staged AI hints).

**Constraints (don't change without raising them with the user first):**
- **Personal data stays on institution-controlled infra.** That's why the backend is self-hosted Express + PostgreSQL; Firebase/Supabase-style BaaS was explicitly ruled out.
- **No in-browser Java.** The course wants Java 25 / JEP 512 (compact source files, previewed as JEP 495 in JDK 24); CheerpJ only supports Java ≤17. Java runs on the judge (JDK 24 + `--enable-preview`). Check `https://cheerpj.com/docs/changelog.html` before proposing an in-browser path.
- New major features get the user's sign-off before starting. Open items live in `docs/roadmap.md`.

`legacy/` holds the original single-file mock prototype, unused.

## Commands

See `docs/development.md` for the full tables. Essentials:

- Root (frontend): `npm run dev` (Vite :5173, needs the API at `VITE_API_BASE_URL`, default `http://localhost:4000`), `npm run build` (`tsc -b` + Vite), `npm run build:full` (+ server build), `npm start` (consolidated server), `npm run lint` (oxlint), `npm test` (frontend unit, then server unit), `npm run test:frontend`, `npm run test:integration` / `test:judge` (delegate to `server/`), `npm run test:e2e` (Playwright), `npm run docker:prod`.
- `server/`: `npm run dev` (`tsx watch`), `build` / `start`, `prisma:migrate` (dev), `prisma:deploy` (deployed envs), `prisma:generate`, `test` (unit), `test:integration`, `test:judge`, `test:all`, `typecheck:test`, `backup` / `restore`.
- Docker: `docker compose up -d db judge`. Rebuild the judge (`docker compose up -d --build judge`) after touching `judge/`, including `judge/runner/shared/`.

**Local Postgres port**: `docker-compose.yml` maps the container to **host port 5433**, because this machine runs a native Homebrew Postgres on 5432 — `localhost:5432` silently hits that one and fails with `P1010`. Check `lsof -nP -iTCP:5432 -sTCP:LISTEN` before changing the mapping.

**Node**: both `package.json`s declare `engines: >=22.12`. On older Node (≤22.11) `npm install` skips the native optional deps of Vite/oxlint (`@rolldown/binding-*`, `@oxlint/binding-*`) and `build`/`lint` crash with `MODULE_NOT_FOUND`. `server/` deliberately uses pure-JS deps (`bcryptjs`, not `bcrypt`).

### Tests

- **Frontend unit** (`vitest.config.ts`, `src/**/*.test.ts`, plain Node, no DOM): pure helpers only — `reorder`, `compileErrors`, `datetime`, `language`, `bulkTestCases`, `roster`, `localBackup`, `runner/jsRunner` (`prepareJs`), `runner/pyRunner` (`resolvePyodideBaseUrl`), `ai/aiHintContext` (asserts a hidden test's output never reaches the model). No React component tests; UI is covered by E2E.
- **Server unit** (`server/test/*.test.ts`, no DB): `compareOutput` (one shared case table, `test/fixtures/compareOutputCases.ts`, run against **both** the server and the frontend mirror — add a row whenever either changes), `judgeSubmission`, `attemptDeadline`, the CSP builder, the judge queue ordering, `runtimeParity.test.ts` (pinned browser↔judge runtime versions), `typeParity.test.ts` (compile-time equality of duplicated wire types — see below).
- **Integration** (`server/test/integration/`): the real Express app (`createApp()` from `src/app.ts`, ephemeral port) against a separate `wasm_exam_test` DB. `globalSetup.ts` creates + migrates it; `resetDb()` truncates before each test. Both **refuse any DB whose name doesn't end in `_test`**. `JUDGE_URL` is forced empty (legacy grading path), `UPLOADS_DIR` is a temp dir. Files run serially.
- **Judge** (`server/test/judge/`): real compile+run through the judge container (`TEST_JUDGE_URL`, default `http://localhost:4001`), own DB `wasm_exam_judge_test`. Covers Java previews, `check-solution`, server-side grading of every language, browser-equal TLE/RE/MLE, wasm32 type sizes, 差し戻し mid-grading, resume after restart, regrade.
- **E2E** (`playwright.config.ts`, `e2e/*.spec.ts`, Chromium): `webServer` builds `server/`, prepares `wasm_exam_e2e_test` (`server/scripts/e2e-prepare-db.ts`, same `_test` guard), builds the frontend into `.e2e-dist` (never `dist/`) with `VITE_API_BASE_URL=''`, and starts the consolidated server on 4173 with `CSP_MODE=enforce` — any CSP violation fails the spec. Specs seed through the real API (first signup = teacher). `E2E_WITH_C=1` adds C specs (clang download); `E2E_JUDGE_URL` enables judge grading and `e2e/server-grading.spec.ts` (browser↔judge parity: the same C/JS/Python programs, chosen to expose runtime differences, must be AC in both with byte-identical stored output).
- **CI** (`.github/workflows/ci.yml`, PRs + pushes to `main`, Node 22): `frontend` (lint, unit, build), `server` (build, `typecheck:test`, unit, integration on `postgres:16` at 5433), `judge` (`docker compose up -d --build judge` from the real `docker-compose.yml`, then `test:judge`), `e2e` (judge + `E2E_WITH_C=1` + `E2E_JUDGE_URL`; uploads the report on failure).
- `server/scripts/loadtest-grading.ts`: N students × a multi-language exam submitting at once against a guarded `*_test` DB; fails unless every attempt gets full marks.

**Monaco gotcha for browser-driven tests**: don't type into Monaco with `keyboard.type()` — auto-indent / auto-close corrupt the input. Set content via `window.monaco.editor.getModels()[0].setValue(code)` (flows through the normal `onChange`). In E2E use the retrying `setEditorCode` helper, since Monaco can overwrite a value set before it finishes loading. **Browser-automation gotcha**: after a navigation take a fresh screenshot before clicking by coordinate — the viewport scale can change.

## Architecture

Two independent npm projects, no shared `node_modules`:

- **Frontend** (repo root): React + Vite + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`, no config file), `react-router-dom`. Talks to the backend only through `src/api/*` (`fetch` wrappers, `credentials: 'include'`).
- **`server/`**: Express + TypeScript + Prisma + PostgreSQL. Owns persistence, auth, authoring/grading APIs, and orchestration of the judge. It never compiles or runs student code in-process.
- **`judge/`**: sandboxed Docker service that compiles/runs student code (Java previews + all grading).

### Consolidated serving

In operation `server` serves the frontend build itself (`express.static` + an `app.get('*')` fallback to `index.html` for client routes). API routes are registered first. `src/index.ts` only calls `createApp().listen()` plus the startup jobs; the app lives in `src/app.ts` so tests can mount it.

- `CLIENT_DIST_PATH` defaults to `path.resolve(__dirname, '../../dist')`, which works for both `tsx src/index.ts` and `node dist/index.js` because `server/src` and `server/dist` are at the same depth. It's intentionally depth-symmetric; don't "fix" it. `UPLOADS_DIR` uses the same reasoning.
- Build the frontend with **`VITE_API_BASE_URL` empty** (`.env.production`) so API calls are same-origin relative paths. `npm run build` picks `.env.production` automatically; `npm run dev` uses `.env`.
- Global middleware in `app.ts`: **COOP `same-origin` + COEP `require-corp`** (required — `@wasmer/sdk` needs `SharedArrayBuffer`, and Pyodide needs cross-origin isolation; `vite.config.ts` sets them for dev/preview; whatever serves the HTML must send them), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a **CSP** from `server/src/lib/csp.ts` (allow-list: jsDelivr for Monaco + Pyodide, `*.wasmer.io` for clang, Hugging Face / `*.hf.co` / GitHub raw for WebLLM; `'unsafe-eval'` for the JS runner's `new Function`, `'wasm-unsafe-eval'`). `CSP_MODE` = `report` (default: Report-Only + rate-capped `POST /api/csp-report` logging) / `enforce` / `off`; `CSP_EXTRA_SOURCES` appends origins. WebLLM under `enforce` is unverified, hence the report-only default.
- The two-terminal dev workflow (Vite :5173 + server :4000) remains the way to work with HMR.

### Deployment topologies

- **A (host-run)**: `npm start` on the host + `docker-compose.yml`'s judge, published on `127.0.0.1:4001`. The judge's egress **cannot** be blocked here: on Docker Desktop an `internal: true` network and a host-published port don't coexist.
- **B (containerized)**: `docker-compose.prod.yml` runs `server` (`server/Dockerfile`) and `judge`. `judge` is only on an `internal: true` network shared with `server` (reached as `http://judge:8080`, no published port, no egress — DNS and raw-IP connections both fail). `server` is dual-homed: also on a normal network for its published `4000` and the external managed PostgreSQL (no `db` service in this file). `JUDGE_URL` is forced by the compose file. Config: `server/.env.prod.docker` (from `.env.prod.docker.example`, sets `ALLOW_SIGNUP=false`, `TRUST_PROXY=1`). A named `uploads` volume persists statement images.
- `server/Dockerfile` is 3-stage: frontend build on `node:22.12-slim` (glibc, for Vite/oxlint native deps), server build on Alpine, Alpine runtime with `npm ci --omit=dev`. **`prisma generate` must run before `tsc`** (sources import generated types). The runtime image reproduces the repo's directory depth so `CLIENT_DIST_PATH`/`UPLOADS_DIR` defaults work unchanged.
- The two compose files are deliberately separate, self-contained files (not base + override), and must not be up at the same time in one project directory (same project name → the judge gets overwritten).

### Database backup / restore

`server/scripts/backup-db.sh` / `restore-db.sh` use host `pg_dump`/`pg_restore` against `DATABASE_URL`; `backup-db-docker.sh` / `restore-db-docker.sh` run them inside the dev `db` container so the client always matches the server version (a Homebrew `pg_dump` 14 can neither dump nor restore for `postgres:16`). Dumps go to `server/backups/` (gitignored — they contain personal data), pruned by `BACKUP_RETENTION_DAYS` (default 30, `0` off). Backup scripts delete a partial output file on failure. The docker variants must run from the repo root (Compose resolves the project by directory name; otherwise set `COMPOSE_PROJECT_NAME`). To verify a restore, compare real `SELECT COUNT(*)`s — `pg_stat_user_tables.n_live_tup` is only an estimate.

### Auth

Login/signup use **学籍番号 (student/staff ID) + password** only; there's no email anywhere.

- `server/src/routes/auth.ts`: `POST /signup`, `/login`, `/logout`, `GET /me` (incl. `mustChangePassword`), `POST /change-password` (clears `mustChangePassword` and NULLs `initialPassword`), `GET /signup-status` → `{ signupOpen }`.
- **Sessions** are DB-backed (`Session`, `server/src/lib/session.ts`), not JWT, so they can be revoked immediately. The token is 32 random bytes in an `httpOnly` `session_token` cookie; only its SHA-256 is stored. `purgeStaleSessions()` deletes expired or revoked rows; `startSessionCleanup()` runs it at startup and every `SESSION_CLEANUP_INTERVAL_HOURS` (default 6, `0` off) on an `unref()`'d timer — started from `index.ts` only, never `createApp()`, so tests don't start timers.
- `server/src/middleware/auth.ts`: `requireAuth` → `req.user`; `requireRole('TEACHER')`.
- **Login rate limiting** (`lib/loginRateLimit.ts`): in-memory fixed-window failure counters checked before bcrypt — per (studentNumber, IP) `LOGIN_MAX_FAILURES` (10), per IP `LOGIN_MAX_FAILURES_PER_IP` (100; a classroom may share one NAT address), window `LOGIN_LOCKOUT_MINUTES` (15) → `429` + `Retry-After`. Success clears only the per-account counter. Keys on `req.ip`, so behind a proxy set `TRUST_PROXY` (applied as Express `trust proxy`). Single-instance assumption; `resetDb()` also calls `resetLoginRateLimit()`.
- **Closing signup**: `ALLOW_SIGNUP=false` → `POST /signup` 403, except while the DB has zero users (bootstrap). Default `true`.
- **Bulk provisioning** (`routes/students.ts`, teacher-only): `POST /api/students/bulk` (`[{ studentNumber, displayName }]`, optional `courseId`) creates missing accounts with a random ~12-char `initialPassword` (`generateInitialPassword`, unambiguous alphabet) and `mustChangePassword: true`; existing numbers are `skipped`. `ProtectedRoute` forces `/change-password` for such accounts.
  - **Security note**: `users.initialPassword` is stored in **plaintext** — a deliberate, user-approved tradeoff so a teacher can re-print a credential slip. It exists only until the student's first password change and is returned only by teacher-gated course routes. The alternative is returning passwords once from `/bulk` with no column, plus a reset action.
- `POST /api/students/reset-password` (`{ studentNumber }`, STUDENT targets only): new initial password, `mustChangePassword: true`, revokes all that user's sessions in one transaction, clears the login lockout. `POST /api/students/force-logout`: revokes sessions without touching the password. These are the only places another user's sessions get revoked.

### Role assignment is server-side only

- Signup creates `STUDENT` — except when `prisma.user.count()` is 0, then `TEACHER` (the first account on a fresh deploy is the administrator). There's no role field in the request. The check-then-create isn't serialized; two simultaneous first signups could both become teachers — an accepted race.
- The only other path to `TEACHER` is `POST /api/admin/promote-to-teacher` (`{ targetStudentNumber }`), caller must be a teacher. `routes/admin.ts` also serves `GET /api/admin/service-health` → `{ db, judge }`.
- Never add a route that lets a user change their own `role`. Fallback if the bootstrap was missed: update `users.role` in SQL (column names are camelCase and need quoting, e.g. `"studentNumber"`).

### Database schema (`server/prisma/schema.prisma`)

```
users          studentNumber (unique), passwordHash, displayName, role, mustChangePassword,
               initialPassword (plaintext until the first password change; teacher routes only)
sessions       tokenHash (unique, sha256), userId, expiresAt, revoked
courses        name, term?, createdById
enrollments    courseId, userId — @@unique([courseId, userId])
exam_time_extensions  examId, studentId, extraMinutes — @@unique; added to that student's
               per-attempt time limit and their personal closesAt
exam_attempt_grants   examId, studentId, extraAttempts — @@unique; "もう1回受けさせる":
               added to maxAttempts for that student (effectiveMaxAttempts(); null stays unlimited)
exams          title, description?, status DRAFT|PUBLISHED, createdById,
               mode EXAM|PRACTICE (default EXAM),
               timeLimitMinutes? (required for EXAM, enforced by Zod not the DB),
               maxAttempts? (default 1, null = unlimited; EXAM only),
               opensAt? / closesAt? (scheduling window; EXAM only),
               courseId? (null = visible to every STUDENT; onDelete SetNull),
               defaultLanguage (initial language for new tasks; never retroactive)
exam_attempts  examId, studentId, attemptNumber (1-based), status IN_PROGRESS|GRADING|SUBMITTED,
               startedAt, submittedAt?, score? — @@unique([examId, studentId, attemptNumber]).
               Created only by POST /api/student/exams/:examId/attempts.
task_drafts    attemptId, taskId, code, keystrokeCount/pasteCount/pastedCharCount/timeSpentSeconds
               — @@unique([attemptId, taskId]); mutable, never graded directly
tasks          examId, order, title, statementMarkdown, language C|JAVA|JS|TS|PYTHON, starterCode?,
               points, comparisonMode EXACT|TRIM_TRAILING_WS|IGNORE_BLANK_LINES|FLOAT|IGNORE_CASE,
               floatTolerance (FLOAT only), tags String[], isPublic (task bank),
               allowPartialCredit, aiHintEnabled + aiHintMaxStage (1-3, Zod-validated; PRACTICE only)
test_cases     taskId, input, expectedOutput, isSample, order, timeLimitMs (2000), memoryLimitMb (256)
               — the two limits apply to Java only
solutions      taskId, language, code — teacher-only, @@unique([taskId, language])
submissions    examId, taskId, studentId, attemptId?, language, code, results (Json), overallStatus,
               score, editor metrics — one immutable row per (attempt, drafted task), written when an
               attempt is graded. Metrics are browser-reported (same trust as `code`).
               attemptId is nullable only for very old rows.
practice_submissions  taskId, studentId, language, code, results (Json), overallStatus, score,
               submittedAt — append-only practice history; deliberately separate from submissions
```

- `submissions` has flat `examId`/`taskId`/`studentId` FKs so the grade dashboard / CSV can query across students with plain SQL.
- `results` entries (`PerTestCaseResult`) may carry `timeMs` (measured wall-clock run time — never used for the verdict) and `hint` (see WA hints). Don't confuse `timeMs` with human time (`startedAt`, `timeSpentSeconds`, `elapsedSeconds`).
- **`PerTestCaseResult`-shaped types exist three times** (`server/src/lib/judge.ts`, `src/types/student.ts`, `src/types/exam.ts`'s `SubmissionDetailResult`), and `ComparisonMode` / `Language` / status unions are duplicated on the frontend. `server/test/typeParity.test.ts` checks them at compile time (`typecheck:test`) — update all copies together.

### Hidden test secrecy

Student-facing routes send every test case's `input` but `expectedOutput` only when `isSample`. `server/src/routes/student.ts` and `practice.ts` never touch `Solution`. Keep it that way.

### Teacher authoring API

`routes/exams.ts`, `tasks.ts`, `testCases.ts` (`/api/exams`, `/api/tasks`, `/api/test-cases`) are gated by `requireAuth, requireRole('TEACHER')` at the router level. There's no per-exam ownership check — any teacher can edit any exam, intentionally.

- Exams: CRUD (`GET /:examId` returns lightweight task rows; full task content only via `GET /api/tasks/:taskId`). `examInputSchema` (a `.superRefine` over `examInputBaseSchema`, split so PATCH can use `.partial()`) requires `timeLimitMinutes` unless `mode === 'PRACTICE'`. `POST /:examId/duplicate` copies metadata + every task (with test cases, solutions, tags) and always resets to `DRAFT` with no `opensAt`/`closesAt`.
- `GET /:examId/publish-check` → `{ issues: [{ level: 'error'|'warn', message }] }`: no tasks, no test cases / sample, 0 points, empty expected output, FLOAT with non-numeric expected output, a Java task without a judge (error per task), an EXAM with C/JS/TS/Python tasks without a judge (one warn), bad scheduling window (EXAM only). Advisory; never blocks publishing.
- Tasks: `POST /api/exams/:examId/tasks` (language defaults to `exam.defaultLanguage`), `GET/PATCH/DELETE /api/tasks/:taskId`, `POST /:taskId/duplicate` (`{ examId? }`), `GET /:taskId/export` / `POST /api/exams/:examId/tasks/import` (`wasm-exam-task/v1`, `server/src/lib/taskPortable.ts`; always an array; imports always arrive `isPublic: false`; a `.refine()` rejects duplicate solution languages).
- Test cases: `POST /api/tasks/:taskId/test-cases`, `.../bulk` (≤200), `PATCH/DELETE /api/test-cases/:id`. Reordering PATCHes only the rows whose `order` changed (`src/lib/reorder.ts`); there's no bulk-reorder endpoint and no uniqueness on `order`.
- Solutions: `PUT/DELETE /api/tasks/:taskId/solutions/:language`.
- `POST /api/tasks/:taskId/check-solution` (Java only; other languages verify in the browser via `runClientSide`): runs `{ code }` against every test case, or against ad-hoc `inputs` (≤50) for AI作問サポート drafts. Never persists.
- `POST /api/tasks/:taskId/regrade` (every language, needs a judge): re-runs every existing `Submission` for the task against current test cases/settings and recomputes affected attempt scores. A sanctioned mutation of immutable submissions, like 差し戻し.
- `POST /api/uploads` (teacher-only, multer **memory** storage so bad mimetypes are rejected before touching disk; PNG/JPEG/GIF/WebP allow-list; 5MB): saves `crypto.randomUUID()` + an extension from the allow-list (never the client filename) under `UPLOADS_DIR`, served **unauthenticated** at `/uploads/*` (statement images aren't personal data). Markdown is rendered with `react-markdown` without raw HTML — don't add `rehype-raw` without thinking through XSS.
- Courses (`routes/courses.ts`): CRUD, `POST /:courseId/enrollments` (`{ studentNumbers }`, ≤1000 → `{ added, alreadyEnrolled, notFound }`), unenroll. A course-scoped exam is visible only to its enrollees (`examVisible(courseId, enrolledCourseIds)`), and its results list only enrollees.
- **Task bank** (`routes/taskBank.ts`): `GET /api/task-bank?q=&language=&tags=&scope=all|mine|public` (lightweight rows only) and `GET /api/task-bank/tags`. Every task is a bank entry; `isPublic` controls **discovery only** (owner = `exam.createdById` sees their own; others see public ones) — it is not access control. Adding a result reuses `duplicate`.

**Frontend authoring notes**
- `TaskEditorPage` has three independently saved sections (基本情報 / each `TestCaseRow` / `SolutionEditor`), each with its own labeled button, `disabled` unless dirty, and a "● 未保存" badge; a sticky banner lists all dirty sections and `useUnsavedGuard` guards on the combined state. `SolutionEditor` compares against a local `savedCode` (`initialSavedCode` prop), not `initialCode`, or dirty would stay stuck after save. Each `TestCaseRow`'s `key` includes its `expectedOutput` so it remounts after "実際の出力を期待値にする".
- Starter code is pre-filled from `LANGUAGE_TEMPLATE[language]`; changing the language swaps the skeleton only while `isUntouchedTemplate()` holds.
- Time/memory inputs on `TestCaseRow` show only for Java and clamp to the judge's range ([100, 15000]ms / [16, 512]MB, kept in sync by hand).
- `TaskBankPicker`'s `onAdded` must use `ExamDetailPage`'s `reloadTasksQuietly()`, not `load()` — `load()` flips `loading` and unmounts the open modal.
- Setting explanations go in a `HelpPopover` ("?" button), not permanent caption text; don't say the same thing in both (`src/lib/examModeHelp.ts`, `TaskEditorPage`'s AI-hint help texts).

### Browser runners

`src/runner/clientRunner.ts` is the single entry point: `runClientSide(language, source, testCases, onProgress)` → `{ compileFailed, compileStderr, outcomes: [{ testCaseId, stage, stdout, timeMs }] }` (never a self-declared verdict). Also `prewarmClientRunner(language)`, `prewarmAllClientRunners()`, `getRuntimeReadiness()` (`{ c, python }`: `idle|loading|ready|error`).

- **C** (`cRunner.ts`): `compileC(source)` with clang from the Wasmer registry (`Wasmer.fromRegistry('clang/clang')`, ~106MB, memoized per page), then `runCompiledC(wasm, stdin)` in a dedicated module worker (`cRun.worker.ts`, its own `@wasmer/sdk`, reused across tests). On the 10s timeout the whole worker is `terminate()`d (the SDK has no kill API) → `tle`; the next run gets a fresh worker. Programs link with `C_COMPILE_FLAGS` incl. `--max-memory` 256MB, so oversized allocations fail inside the program (→ RE; indistinguishable from other crashes). `clangPromise` stays memoized on rejection, so the load-failure message tells the user to reload.
- **JS/TS** (`jsRunner.ts` + `js.worker.ts`): `prepareJs()` strips TS with sucrase (`transforms: ['typescript']` — type errors never fail; syntax errors → CE) or syntax-checks JS with `new Function()`; on failure it re-parses with sucrase only to append `(line:col)` (V8 stays the authority). One throwaway classic worker per test, killed at 10s. Harness: `readline()`/`read()`, `print()`/`console.*`/`write()`; no `process`/`require`; no top-level `await`.
- **Python** (`pyRunner.ts` + `py.worker.ts`): Pyodide from jsDelivr (v0.28.0) or `VITE_PYODIDE_BASE_URL` (resolved on the main thread and sent with each message, since the classic worker can't read `import.meta.env`). One worker reused across tests; recreated after the 15s timeout. **Requests carry an `id` and `call()` accepts only its own reply** — otherwise a prewarm's reply could be taken as a run result (a false WA on a cold cache). `MemoryError` → `mle`. A `fatal` reply (infrastructure failure) resets the worker.
- `apiFetch` rethrows network-layer failures as `ApiError('サーバーに接続できませんでした。…', 0)`; runtime-load failures surface as friendly messages (Python's arrive as `compileFailed` + message).
- `StudentDashboard` shows a readiness card, prewarms on mount, and disables 受験する / もう一度受験する until the exam's client runtimes (`languages` from `GET /api/student/exams`) are ready. It never gates 受験を再開する.
- `src/lib/language.ts` holds per-language metadata (`RUNNABLE_LANGUAGES`, `SERVER_EXEC_LANGUAGES` = Java); `server/src/lib/language.ts` is the server counterpart. `src/components/CodeEditor.tsx` wraps `@monaco-editor/react` and accepts `markers` (fed by `parseCompileErrors`, cleared on the next edit).

### Server-side judge (`judge/`)

`judge/Judge.java` (single-file HTTP server, `com.sun.net.httpserver` + Gson) plus a Node runner (`judge/runner/`) compile and run code **inside the container only**. The container is the sandbox: `cap_drop: ALL`, `read_only`, tmpfs `/work` + `/tmp` (`noexec` — nothing is exec()ed from them), `pids_limit`, `mem_limit`, `cpus`, `no-new-privileges`, non-root.

- Protocol: `POST /run { language?, code, tests: [{ id, stdin, timeLimitMs, memoryLimitMb }] }` → `{ compile: { ok, stderr }, results: [{ id, stdout, stderr, exitCode, timedOut, oom, timeMs }] }`; `language` defaults to `JAVA`. No verdicts — `judgeSubmission()` computes those.
- **Java**: in-process javac (`ToolProvider.getSystemJavaCompiler()`), then `java --enable-preview -cp … Main` per test with the test's time/memory limits (`-Xmx`; `OutOfMemoryError` → `oom`).
- **C / JS / TS / Python use the browser's runtimes**:
  - C: `clang-16 --target=wasm32-wasi --sysroot=/usr` (Ubuntu clang-16 + lld-16 + wasi-libc + libclang-rt wasm32 — the browser's clang is also 16; `sizeof(long) == 4`) + shared `C_COMPILE_FLAGS`, run with `node runner/runWasm.mjs` (Node WASI). Debian/Ubuntu lay wasi-libc out multiarch (`/usr/include/wasm32-wasi`), hence sysroot `/usr`, not `/usr/share/wasi-sysroot`.
  - JS/TS/Python: one `node runner/run.mjs` per request (JSON in/out). JS/TS via `shared/jsPrepare.js` + `shared/jsHarness.js` in a fresh `worker_threads` Worker per test (256MB heap cap as a judge-only safety net). Python via a reused Pyodide worker (`pyWorker.mjs`, pinned `pyodide` npm package = the browser's CDN version) running `shared/pyodideProgram.js`, with request ids like `pyRunner.ts`. It boots from a **memory snapshot** built at image build time (`runner/makeSnapshot.mjs`, before any student code, so every request starts pristine).
  - The request's per-test limits are ignored for these four: `Judge.java` reads `runner/shared/limits.js` once at startup.
  - A long-lived runner reusing warm isolates was **rejected**: student code (Python via `js`/`_pyodide`, JS via dynamic `import()`) could reach Node and affect other students' gradings. Per-request processes limit the blast radius to the submitter.
- **`judge/runner/shared/`** (plain ESM, `.d.ts` beside each file) is imported by both the browser runners (Vite bundles it) and the judge runner. Change behavior there, never fork a copy on one side; rebuild the judge image afterwards. Pinned versions are checked by `runtimeParity.test.ts`.
- Java/C process harness: per-request tmp dir, `ulimit -f/-t`, wall-clock timeout + `destroyForcibly`, cleanup in `finally`. Build tip: if BuildKit times out fetching base-image metadata on Docker Desktop, `docker pull eclipse-temurin:24-jdk` first.
- `server/src/lib/judgeClient.ts` (`JUDGE_URL`, empty = no judge; `JUDGE_REQUEST_TIMEOUT_MS` default 60000). `server/src/lib/executionQueue.ts`: global cap `JUDGE_CONCURRENCY` (default 2 = the judge's `JUDGE_MAX_CONCURRENT`); interactive calls (`withJudgeSlot`) have a per-user in-flight cap of 1 (→ 429) and are always served before background grading (`withJudgeCapacity`, global cap only, queues). In-memory, single-instance. `JUDGE_CPUS` / `JUDGE_MEM_LIMIT` / `JUDGE_MAX_CONCURRENT` are compose-interpolated (defaults 2.0 / 1g / 2); `docker-compose.prod.yml` derives `JUDGE_CONCURRENCY` from `JUDGE_MAX_CONCURRENT`.
- Stages: `timedOut` → `tle` → `TLE`; `oom` → `mle` → `MLE`; non-zero exit → `runtime_error` → per-test `RE`.

### Grading

**The server decides AC/WA/CE.** `server/src/lib/judge.ts`'s `judgeSubmission(testCases, points, { compileFailed, outcomes }, comparison?, allowPartialCredit?)` is the only place a verdict is computed.

- `compareOutput` modes: `EXACT` (trim, exact), `TRIM_TRAILING_WS`, `IGNORE_BLANK_LINES`, `FLOAT` (whitespace tokens, numeric within `floatTolerance`), `IGNORE_CASE` (trailing-ws normalization + lowercase). `src/lib/compareOutput.ts` is a client mirror for the teacher's verification panel; keep both switch statements in sync (shared test table).
- `computeOverall`: overall `TLE`/`MLE` only when every failing test agrees, else `WA`; per-test `RE` rolls into overall `WA` (`RE` isn't a `SubmissionStatus` — adding it needs a migration). `CE` scores 0 regardless of partial credit.
- `computeScore`: all-or-nothing by default; with `allowPartialCredit`, `round(points × passed / total)`.
- **WA hints** (`computeWaHint`): on an output mismatch only, try looser modes (`TRIM_TRAILING_WS` → `IGNORE_BLANK_LINES` → `IGNORE_CASE`, skipping the task's own mode) and report just the category; the line-count check comes last (blank-line differences change line counts). A genuinely wrong answer gets no hint. Only the live preview (`POST .../run`) returns per-test results to students; submit/result return summaries only. `StudentTaskPage` shows hints only for non-sample WA.
- Outcome sources: preview of client-exec languages → browser-reported `{ testCaseId, stage, stdout }`; Java → `resolveOutcomes()` (`server/src/lib/execution.ts`, shared by exam and practice routes) calls the judge. The client can change *what code runs*, never claim a match.

**Server-side grading** (`server/src/lib/grading.ts`, active when a judge is configured):
- `beginGrading(attemptId, submittedAt)`: guarded `IN_PROGRESS → GRADING` flip (submit time = the click or the deadline) + enqueue. The in-process queue (`GRADING_CONCURRENCY`, default 2 × `JUDGE_CONCURRENCY`) runs `gradeAttempt`: each drafted task's saved code through `gradeCodeOnJudge` → `judgeSubmission`, then one transaction that flips `GRADING → SUBMITTED` with the score and `createMany`s the Submissions — guarded, so a 差し戻し mid-grading writes nothing. Judge failures throw and retry every `GRADING_RETRY_MS` (default 15s). `resumePendingGrading()` (from `index.ts`) re-queues GRADING attempts after a restart. Tests use `waitForGradingIdle()` / `resetGradingQueue()`.
- "Finished" = `SUBMITTED` or `GRADING` wherever attempts are counted. No new attempt while one is GRADING (409); `latestScore` hidden while grading; results rows carry `grading` and keep showing the previous graded attempt.
- Without a judge, submit uses the legacy synchronous path (client-reported outcomes; Java → 503), and an expired attempt's client-exec drafts are graded WA/0. The integration suite covers this path.

### Student exam flow

`server/src/routes/student.ts` (`/api/student`, `requireAuth` only — teachers may preview). Every query filters `status: 'PUBLISHED'` **and `mode: 'EXAM'`** (a practice exam must 404 here — omitting the mode filter once leaked practice sets into the timed list).

- `GET /exams` — per-exam state: `taskCount`, `totalPoints`, `languages`, `maxAttempts` (effective, incl. grants), `opensAt`/`closesAt`, `notYetOpen`/`closed`, `attemptsUsed`, `hasInProgress`, `grading`, `canStart`, `latestScore` (**null while `hasInProgress`** — a retake must not show the previous score).
- `POST /exams/:examId/attempts` — start (or return the in-progress) attempt; 409 at the attempt cap, before `opensAt`, after `closesAt`, or while grading.
- `GET /exams/:examId` — task summaries + current attempt (`deadline` clamped to `closesAt`). `GET /tasks/:taskId` — statement, redacted test cases, current draft. `PUT /tasks/:taskId/draft` — upsert the draft (409 without an in-progress attempt). `POST /tasks/:taskId/run` — ephemeral preview (body has no language; the task fixes it).
- `GET /exams/:examId/attempt` — review data (`serverGraded`, per-task `hasDraft`/`draftCode`/inputs). `POST /exams/:examId/submit` — with a judge: `beginGrading` → **202**; without: legacy synchronous grading. `GET /exams/:examId/result` — latest finished attempt, `grading: true` with no score while grading.
- `lib/attempts.ts`: `attemptDeadline(startedAt, limit, closesAt?, extra?)` = `min(startedAt + limit + extra, closesAt + extra)`. `maybeSettleAttempt(id)` auto-finalizes an expired IN_PROGRESS attempt (hands it to `beginGrading(id, deadline)` with a judge); called opportunistically from student reads and `getExamResults`. The client also triggers the finalize at the deadline; the server settle covers a closed browser.
- Frontend: `StudentTaskPage` (statement + samples / Monaco / 実行 + 下書き保存, header 試験を提出する; failing samples render `SampleDiff`; saves the draft before in-app navigation), `StudentExamFinishedPage` (review → final submit; result view polls every 2s while grading), `StudentDashboard`.
- **Unsaved-code backup** (`src/lib/localBackup.ts`, `src/hooks/useCodeBackup.ts`): debounced `localStorage` copy of edits not yet saved server-side — exam key `exam:<userId>:<attemptId>:<taskId>`, practice key `practice:<userId>:<taskId>`. A differing stored copy on load offers 復元する / 破棄する (`RestoreBackupBanner`). Cleared after a draft save, after final submit (whole attempt), on logout (`UserDrawer`), and after 24h. **Gotcha**: the backup check and the write/clear effect must not both run for a new key in one commit (the clear branch would delete the backup being offered) — `useCodeBackup` keeps `{ key, pending }` in one state and doesn't touch storage while a backup is pending.

### Teacher results (`server/src/lib/examResults.ts`)

`getExamResults(examId)` is the single source for both the JSON dashboard and CSV — add result fields there. It lists every targeted student (course enrollees, else every STUDENT) and grades by the **latest SUBMITTED attempt** (not best); it settles expired attempts first.

- `GET /api/exams/:examId/results`, `GET .../results/csv` (UTF-8 BOM for Excel; both ASCII `filename=` and RFC 5987 `filename*=`).
- `GET .../students/:studentId/submission-detail[?attempt=N]` — submitted code + per-test input/expected/actual/status/time, plus every SUBMITTED attempt for drill-down.
- `PUT .../students/:studentId/time-extension` (`{ extraMinutes }`), `PUT .../extra-attempts` (`{ extraAttempts }` 0–100; 400 on unlimited exams).
- `DELETE .../students/:studentId/results` — **差し戻し**: deletes all that student's Submissions and ExamAttempts for the exam (drafts cascade) in one transaction. The only sanctioned break of submission immutability besides regrade.

### Practice mode

A `PRACTICE` exam reuses the whole Exam/Task/TestCase/authoring stack. There's no `ExamAttempt`, no time limit, no draft on the server; submissions go to append-only `PracticeSubmission` (kept separate so unlimited resubmission can't corrupt the exam grade semantics).

- `server/src/routes/practice.ts` at `/api/student/practice` (`requireAuth`): `GET /exams`, `GET /exams/:examId`, `GET /tasks/:taskId` (redacted test cases + `aiHintEnabled`/`aiHintMaxStage`), `POST /tasks/:taskId/run` (ephemeral), `POST /tasks/:taskId/submit` (judged, recorded; body always carries `code`), `GET /tasks/:taskId/submissions` (own history). Practice submits use browser-reported outcomes for client-exec languages.
- Teacher stats: `lib/practiceStats.ts` `getPracticeStats(examId)` (400 for EXAM) → `GET /api/exams/:examId/practice-stats` and `.../practice-stats/students/:studentId/tasks/:taskId`; `PracticeStatsPage`.
- Frontend: `PracticeSetPage`, `PracticeTaskPage` (実行（お試し） / 提出する / 提出履歴). Teacher forms hide time limit / attempts / schedule for PRACTICE and show 演習の状況 instead of 成績.

### AI features (in-browser LLM)

Both use `@mlc-ai/web-llm` (`CreateWebWorkerMLCEngine`, module worker `src/ai/aiAssist.worker.ts`) with one fixed model, `Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC` (~2.5GB, WebGPU). No server route or schema involvement beyond `check-solution` and the task's hint fields.

- **Opt-in is per browser** (`localStorage`), not per account — the thing opted into is a multi-GB download into that browser. Separate flags: `src/ai/aiAssistSettings.ts` (teacher, AI作問サポート) and `src/ai/aiHintSettings.ts` (student, AIヒント), so one role's opt-in never enables the other's feature. They share the model cache (deleting from either panel affects both — accepted). Turning off doesn't delete the model; deletion is a separate `ConfirmDialog`-gated action. Panels: `AiAssistSettings` / `AiHintSettings` on `SettingsPage`.
- **Bundle size**: web-llm is several MB of JS. It must only load via `React.lazy` — `SettingsPage` lazy-loads the settings panels, `TaskEditorPage` lazy-loads `AiAssistPanel` only when `isAiAssistEnabled()` (dependency-free module), `PracticeTaskPage` lazy-loads `HintPanel`. A static import from a shared component pulls it into every page's bundle.
- **AI作問サポート** (`src/ai/aiAssist.ts` `generateTaskDraft`, `AiAssistPanel`): the model generates statement / starter / solution / test **inputs** only (JSON-schema constrained) — **never expected outputs**. Expected outputs come from executing the generated solution (`runClientSide` for C/JS/TS/Python, `check-solution` with `inputs` for Java); inputs the solution fails on are dropped. Only if the Java call fails do cases arrive with empty expected output and a warning. Applying reuses existing persistence: basic-info form state (unsaved), `bulkCreateTestCases`, and `SolutionEditor` via `initialSavedCode` (so it starts dirty).
- **AIヒント** (`src/ai/aiHint.ts` + pure `src/ai/aiHintContext.ts`, `HintPanel`): PRACTICE tasks only, when both `task.aiHintEnabled` and the student's opt-in are true. Three fixed stages (着眼点 → 疑わしい箇所 → 修正方針), stage 1 unlocks after a non-AC run, each later stage after the previous; stages above `aiHintMaxStage` aren't rendered. `buildStageContext` grows what the model sees by stage — sample tests' input + actual output, hidden tests' status + the non-revealing `hint` only; never hidden expected output. `NO_CODE_RULE` on every stage, `temperature: 0.4`, `looksLikeCode` regex guard with up to 2 attempts (escalating retry nudge).
  - **Known limitation, verified with the real model**: for a simple one-line bug, stage 3 reliably tends toward the literal fix, and stages 1–2 can be very specific in prose (which the regex can't catch). Prompt tightening didn't fix it; it's a 3B-model ceiling. The mitigation is policy — `aiHintMaxStage`. Don't claim a prompt change fixes this without re-running a real-model test against a real bug.

### Frontend routing & layout

- `src/App.tsx`: public `/login`, `/signup`; protected `/change-password`, `/settings`, `/` (`RoleHome` dispatcher), `/student`, `/student/exams/:examId/tasks/:taskId`, `/student/exams/:examId/finished`, `/student/practice/exams/:examId[/tasks/:taskId]`, `/teacher`, `/teacher/exams/:examId`, `.../tasks/:taskId`, `.../results`, `.../practice-stats`, `/teacher/courses`, `/teacher/admin`, `/teacher/sandbox`. Every page except Login/Signup/ChangePassword/RoleHome is `React.lazy`-loaded per route under one `<Suspense fallback={<PageSkeleton />}>`; pages keep named exports (adapted with `.then((m) => ({ default: m.X }))`).
- `ProtectedRoute` redirects to `/login` without a profile, to `/change-password` when `mustChangePassword` (unless `allowPasswordChangePending`), and to `/` on a role mismatch. This is UX only — real authorization is the Express middleware. Never add a data-bearing route without `requireAuth`/`requireRole`.
- Contexts are split so each module exports only components or only non-components (Fast Refresh / oxlint `only-export-components`): `AuthContext.tsx` / `useAuth.ts` / `authContextValue.ts`, likewise for theme.
- **Hamburger drawer** (`src/components/UserDrawer.tsx`): user card → role-based `NAV_ITEMS` (teacher: ダッシュボード, クラス管理, 管理者メニュー; student: ダッシュボード) → settings (`ThemeToggle`, `/settings`, `/change-password`) → logout (also clears local backups). Add destinations to `NAV_ITEMS` / `SETTINGS_ITEMS`, not header buttons. Always mounted (so the slide animates); closes on backdrop / ✕ / Escape / navigation. `beforeNavigate` (async → boolean) lets a page with unsaved state save or confirm first: `StudentTaskPage` passes `saveDraftBeforeLeaving`, editor pages pass `confirmLeaveIfDirty(dirty)` from `useUnsavedGuard.ts` — wire this on any new page that uses `useUnsavedGuard`.
- `AppHeader` (dashboards, `PracticeSetPage`) and `BackHeader` (detail/editor/results/courses/settings/admin pages) render the drawer; other pages render it inline. Never render both headers on one page (two ☰ buttons). Login/Signup keep a standalone `ThemeToggle`.
- `AdminPage` (`/teacher/admin`): service health (30s poll), password reset by 学籍番号 (works for course-less students), force logout, promote to teacher, sandbox link. `SandboxPage` is a standalone manual-verification harness; keep it.
- Confirmations for irreversible actions use `ConfirmDialog`, not `window.confirm`.
