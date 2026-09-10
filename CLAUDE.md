# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the developer/architecture reference; user-facing docs live in [`README.md`](./README.md) and [`docs/`](./docs/) (`languages.md` = per-language I/O & limits, `teacher-guide.md` = authoring & grading, `operations.md` = deployment & headers & judge, `roadmap.md` = Phase 6+ backlog / teacher- & student-experience outlook). Keep those in sync when behavior changes.

## What this is

A browser-based online coding exam/judge system (LMS) for a programming course. Each task is answered in exactly one language, chosen by its author (`task.language`); the student has no language picker. Supported: **C** (client-side, WASI/Wasmer), **JavaScript / TypeScript** (client-side, Web Worker; TS type-stripped with sucrase), **Python** (client-side, Pyodide in a Web Worker), and **Java** (server-side, sandboxed `judge` Docker container — it couldn't be done in-browser, see below). Only Java sends source to the server for execution. Teachers author exams, tasks, and test cases and review student results.

**Java-in-browser is on hold; Java runs server-side instead**: the course teaches Java 25 and wants JEP 512 ("Compact Source Files and Instance Main Methods") — previewed as JEP 495 in JDK 24 — available to students, but CheerpJ's latest shipped release (4.3, April 2026) only supports Java up to 17, a platform ceiling in CheerpJ itself. So (2026-09-09, user sign-off) Java was added as a **server-side** judge: JDK 24 + `--enable-preview`, compiled and run inside the `judge` container, never on the host. Don't build an *in-browser* Java path until CheerpJ (or an alternative) ships Java 21+/25 — check `https://cheerpj.com/docs/changelog.html` first. See "Server-side Java judge" below.

Personal data (student IDs, names, scores) must stay on infrastructure the institution controls — this is *why* the backend is a self-hosted Node/Express + PostgreSQL server rather than a third-party BaaS (Firebase/Supabase were explicitly ruled out for this reason; don't suggest moving auth/data to an external cloud provider without raising this constraint first).

The original single-file mock prototype (`index.html` + `app.js`, a fake `mockWasmRun` that just summed two integers) has been moved to `legacy/` for reference and superseded by the app under `src/` + `server/`.

Being built in explicit phases (see project memory / prior conversation for the full roadmap): Phase 1 (auth + roles), Phase 2 (teacher exam/task/test-case authoring), Phase 3 (Monaco Editor + in-browser C compile/run sandbox — C only), Phase 4 (student exam-taking UI + judge wired into a real submission flow), and Phase 5 (teacher grade dashboard + CSV export) are done, along with post-Phase-5 follow-ups: client-reported editor-integrity metrics on `Submission` (`keystrokeCount` / `pasteCount` / `pastedCharCount`), `ExamAttempt`-anchored exam timing, and the per-student "差し戻し" reset.

**The attempt/draft submission model (Phase 6 lead item, 2026-09-10) is done** — per-task "送信" is gone; a per-task action is now "下書き保存" (a mutable `TaskDraft` per attempt), and the exam has one **final submit** that grades every drafted task into immutable `Submission` rows. Exams carry `maxAttempts` (teacher-set: 1 default / `null` = unlimited); a student's grade is the score of their **latest SUBMITTED attempt** (latest, not best). Time-up auto-finalizes the attempt. See "Attempt lifecycle, drafts & final submission" below.

**The rest of Phase 6 (hardening) has not started** — real `TLE`/`MLE` verdicts, friendlier compile/WA feedback, a C execution timeout, extending the sandboxed judge past Java, output-comparison modes, roster/scheduling — plus the broader teacher- and student-experience backlog is enumerated in [`docs/roadmap.md`](./docs/roadmap.md). Don't jump ahead to a later phase's code without the user's sign-off.

**Multi-language work (separate track from the phases above, 2026-09-09):** adding more answer languages. All three increments are done: Increment 1 (per-task single language: `Task.language` + `Task.starterCode`, teacher picks it, no student picker), Increment 2 (the server-side Java `judge`), Increment 3 (client-side JS / TS / Python runners — `Language` enum gained `JS`/`TS`/`PYTHON` in migration `20260909030000_add_client_languages`). C/JS/TS/Python all run in the browser; only Java is server-side, and the `judge` executor is built language-agnostic so moving C server-side later (Phase 6) would be a config change, not a rewrite. (Historical note: Increment 1 briefly shipped a multi-language `allowedLanguages[]` + `task_starter_codes` child table; migration `20260909020000_task_single_language` collapsed it back to one language per task.)

## Commands

Frontend (repo root):
- `npm run dev` — start the Vite dev server (expects the API server from `VITE_API_BASE_URL` in `.env`, default `http://localhost:4000`).
- `npm run build` — typecheck (`tsc -b`) then production build (uses `.env`/`.env.production` per Vite's mode rules — see "Consolidated serving" below).
- `npm run build:full` — the above, then also builds `server/`. Use this before `npm start`.
- `npm start` — runs `server/`'s compiled output (`npm --prefix server run start`), which serves both the API and the built frontend from one process/port. This is the *operational* run mode; `npm run dev` (two terminals) is still the *development* workflow.
- `npm run lint` — run oxlint over the frontend.
- `npm run preview` — preview a production build locally.

Backend (`server/`):
- `docker compose up -d db` (from repo root) — start local PostgreSQL. **Maps to host port 5433, not 5432** — see the Postgres port note below before changing this.
- `docker compose up -d judge` (from repo root) — start the sandboxed Java compile/run service (published on `127.0.0.1:4001`). Needed for Java tasks; set `JUDGE_URL=http://localhost:4001` in `server/.env`. C tasks don't need it.
- `npm run dev` — run the Express server with `tsx watch` (needs `server/.env`, copy from `server/.env.example`).
- `npm run build` / `npm run start` — compile to `dist/` and run compiled output.
- `npm run prisma:migrate` — create/apply a dev migration after editing `prisma/schema.prisma`.
- `npm run prisma:deploy` — apply pending migrations in a deployed environment (no schema drift prompts).
- `npm run prisma:generate` — regenerate the Prisma Client after a schema change (also runs automatically after migrate).

**Local Postgres port note**: `docker-compose.yml` maps the container's 5432 to **host port 5433**, not 5432, because this machine already runs a native Homebrew Postgres listening on `127.0.0.1:5432` / `[::1]:5432` — connecting to `localhost:5432` silently hits that instead of the Docker container and fails with `P1010: User was denied access`. If you ever change this mapping back to `5432:5432`, check `lsof -nP -iTCP:5432 -sTCP:LISTEN` first.

**Node version note**: this repo currently runs on Node 22.11.0, but Vite 8 / oxlint declare an engine requirement of `20.19+` or `22.12+`. On this Node version, `npm install` silently skips the platform-specific native binding optional dependencies (`@rolldown/binding-*`, `@oxlint/binding-*`), which makes `build`/`lint` crash with `MODULE_NOT_FOUND` until those exact packages are installed manually (e.g. `npm install --no-save @rolldown/binding-darwin-arm64@<version>`). The `server/` package deliberately avoids this class of problem by using pure-JS deps (`bcryptjs`, not native `bcrypt`). Upgrading Node to 22.12+ avoids the frontend issue entirely.

## Architecture

Two independent npm projects in one repo, no shared `node_modules`:

- **Frontend** (repo root): React + Vite + TypeScript + Tailwind CSS v4 (via `@tailwindcss/vite`, no `tailwind.config.js` needed). Routing is `react-router-dom`. Talks to the backend only through `src/api/*` (plain `fetch` wrappers, `credentials: 'include'` so the session cookie rides along) — there is no ORM/DB access from the frontend.
- **`server/`**: Express + TypeScript + Prisma + PostgreSQL. Owns all persistence and all auth. Deployed and run independently of the frontend (e.g. behind a reverse proxy on institution-controlled infra).

There is no third-party BaaS anywhere in this stack. **C** judging happens in the student's browser (WASI/Wasmer); **Java** judging happens in the self-hosted `judge` Docker container (still institution-controlled infra — see "Server-side Java judge"). The `server/` process itself does auth, data storage, authoring/grading APIs, and orchestrating the judge — it never compiles or runs student code in-process.

### Consolidated serving: one process instead of two terminals

For actual day-to-day operation (not active development), `server/src/index.ts` also serves the frontend's production build itself via `express.static`, plus a catch-all `app.get('*', ...)` that falls back to `index.html` so React Router's client-side routes survive a hard refresh. This was added specifically because running two separate dev-server terminals (frontend + backend) every time was operational friction the user didn't want during regular use (e.g. running this during a class).

- `CLIENT_DIST_PATH` (server env, optional) resolves to `path.resolve(__dirname, '../../dist')` by default — this works unchanged whether the server is running via `tsx watch src/index.ts` (dev) or compiled `node dist/index.js` (prod), because `server/src` and `server/dist` sit at the same depth under `server/`, one level below the repo-root `dist/` the frontend builds into. Don't "fix" this path assuming it's dev-only; it's intentionally depth-symmetric.
- The Express routes register the API (`/api/*`) *before* `express.static`/the catch-all, so API paths always resolve first — the static/catch-all block only sees requests nothing else matched.
- **Build the frontend with `VITE_API_BASE_URL` empty** (`.env.production`, copy from `.env.production.example`) when targeting consolidated serving, so `src/api/client.ts`'s `apiFetch` produces same-origin relative paths (`fetch("/api/...")`) instead of a hardcoded dev URL — this is what makes the same build work regardless of what host/port the operational deployment actually runs on. `npm run build` picks `.env.production` over `.env` automatically because Vite defaults to production mode for builds; `npm run dev` still uses `.env` (pointing at `http://localhost:4000`) since it defaults to development mode. Verified by grepping the built bundle for the dev URL (absent) and for a bare `/api/...` path (present) after a `.env.production`-driven build.
- The COOP/COEP headers Phase 3's C sandbox needs (see below) are now set as global Express middleware, not just in `vite.config.ts` — because this server can be the one serving the HTML document in operational mode, and cross-origin isolation has to come from whatever origin actually serves that document.
- This doesn't replace the two-terminal dev workflow — `npm run dev` (Vite, port 5173) + `server`'s `npm run dev` (port 4000) is still how you'd want to work on the frontend with HMR. Consolidated serving is for running the finished app, not editing it.

### Auth: student-ID + password, custom sessions

Login/signup only ever ask for **学籍番号 (student/staff ID) + password** — there is no email concept anywhere in this stack (that was a Firebase-era workaround and no longer applies; `users.studentNumber` is just the primary human-facing identifier now).

- `server/src/routes/auth.ts`: `POST /api/auth/signup` (bcryptjs-hashes the password, always creates the user with `role: STUDENT`), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Sessions are DB-backed (`server/src/lib/session.ts`, `Session` model in `prisma/schema.prisma`), not JWT — a session token is a random 32-byte value; only its SHA-256 hash is stored, so a DB dump can't be replayed as a valid cookie. The token is delivered as an `httpOnly` cookie (`session_token`). This was a deliberate choice over stateless JWT specifically so a session can be revoked immediately (`Session.revoked`) instead of waiting out a token's expiry — relevant for a teacher needing to force-logout a student during an exam in a later phase.
- `server/src/middleware/auth.ts`: `requireAuth` resolves the cookie to a `req.user`; `requireRole('TEACHER')` gates admin-only routes.

### Role assignment is server-side only

A client can never set or escalate its own role:

- Signup always creates `role: STUDENT` (`server/src/routes/auth.ts`) — there's no request field for role.
- The only way a user becomes `TEACHER` is `POST /api/admin/promote-to-teacher` (`server/src/routes/admin.ts`), which requires the *caller* to already have `role: TEACHER`. The very first teacher account has to be promoted directly in the database (see "Bootstrapping the first teacher" below) — there's no signup-time backdoor for this by design.
- There is no Firestore-style security-rules layer here; this invariant is enforced entirely by what the Express routes allow, so don't add a route that lets a user PATCH their own `role`.

**Bootstrapping the first teacher** (no UI for this yet): sign up a normal account, then run
`docker exec <postgres-container> psql -U wasm_exam -d wasm_exam -c 'update users set role='"'"'TEACHER'"'"' where "studentNumber"='"'"'<id>'"'"';'`
(Prisma model fields are camelCase, so the actual column name needs quoting in raw SQL.)

### Database schema (`server/prisma/schema.prisma`)

```
users          studentNumber (unique), passwordHash, displayName, role
sessions       tokenHash (unique, sha256), userId, expiresAt, revoked
exams          title, description?, timeLimitMinutes, status: DRAFT|PUBLISHED, createdById,
               maxAttempts (Int?, default 1; null = unlimited retakes)
exam_attempts  examId, studentId, attemptNumber (1-based), status (AttemptStatus: IN_PROGRESS |
               SUBMITTED), startedAt, submittedAt?, score?
               — @@unique([examId, studentId, attemptNumber]). One row per time a student takes
               the exam; created explicitly via POST /api/student/exams/:examId/attempts, never a
               side effect of viewing. While IN_PROGRESS the student edits task_drafts; final
               submit grades them, flips status to SUBMITTED, fills score + submittedAt. startedAt
               is the per-attempt countdown / "所要時間" anchor, so a retake restarts the clock.
task_drafts    attemptId, taskId, code, keystrokeCount / pasteCount / pastedCharCount /
               timeSpentSeconds, updatedAt   — @@unique([attemptId, taskId]). Mutable in-progress
               answer for one task in one attempt ("下書き保存"); never graded directly. On final
               submit its code + metrics are copied into an immutable submission.
tasks          examId, order, title, statementMarkdown, language (Language: C|JAVA|JS|TS|PYTHON),
               starterCode?, points
test_cases     taskId, input, expectedOutput, isSample, order, timeLimitMs (default 2000),
               memoryLimitMb (default 256)   — the two limit fields are honoured by the Java judge
               only and have no authoring UI (set via API, left at defaults in practice)
solutions      taskId, language, code   — teacher-only reference solution, @@unique([taskId, language])
submissions    examId, taskId, studentId, attemptId?, language, code, results (Json),
               overallStatus, score, keystrokeCount / pasteCount / pastedCharCount /
               timeSpentSeconds   — one row per (attempt, task), created only when an attempt is
               finalized. The metric fields are editor telemetry the browser self-reports; same
               trust level as `code` itself, not an integrity guarantee (see Phase 5). attemptId
               is nullable only for pre-2026-09-10 legacy rows.
```

`submissions` carries `examId`/`taskId`/`studentId` as plain FK columns (not deeply nested) specifically so a teacher's grade dashboard / CSV export (Phase 5, see below) can query across all students and exams with a normal SQL `WHERE`/`JOIN`, which was one of the concrete reasons PostgreSQL was chosen over a document store.

**Program-execution time is still not tracked**: nothing records how long a student's program took to *run* — the client-side runner doesn't measure it, and the Java judge returns `timedOut` / `oom` booleans, not a duration. What *is* recorded is wall-clock *human* time: `ExamAttempt.startedAt` (exam opened), `Submission.timeSpentSeconds` (client-reported time on that task's page before submitting), and a derived `elapsedSeconds` (start → last submission), all surfaced in the Phase 5 dashboard/CSV. Don't conflate the two — a real per-run execution-time metric would still need both a measurement path (client + judge) and a migration.

**Hidden test case secrecy is implemented (Phase 4)**: `GET /api/student/tasks/:taskId` (`server/src/routes/student.ts`) sends every test case's `input` (the client needs it to feed the student's program) but only includes `expectedOutput` when `isSample` is true — verified during Phase 4 testing by inspecting every `/api/student/*` response body for the hidden test case's expected value and confirming it never appears. See "Student exam-taking flow" below for how judging then happens without the client ever holding the hidden answer.

### Teacher exam/task/test-case authoring API (Phase 2)

All of `server/src/routes/exams.ts`, `tasks.ts`, `testCases.ts` are mounted at `/api/exams`, `/api/tasks`, `/api/test-cases` and gated by `requireAuth, requireRole('TEACHER')` at the router level (`router.use(...)`) — there is currently no ownership check beyond "is a teacher," i.e. any teacher can edit any other teacher's exam. That's intentional for a small teaching-team admin console, not an oversight; revisit only if the user asks for per-teacher exam isolation.

- `POST/GET /api/exams`, `GET/PATCH/DELETE /api/exams/:examId` — exam CRUD. `GET /:examId` returns a lightweight `tasks` array (id/order/title/points only); full task content (statement, starter code, test cases, solutions) is only ever fetched via `GET /api/tasks/:taskId`, so the exam detail page stays cheap to load.
- `POST /api/exams/:examId/tasks` creates a task (mounted on `examsRouter`, not `tasksRouter`, since it's the nested-create route). `GET/PATCH/DELETE /api/tasks/:taskId` operate directly on a task by id.
- `POST /api/tasks/:taskId/test-cases` creates a test case; `PATCH/DELETE /api/test-cases/:testCaseId` (separate router, since a test case is addressed directly once created, not through its parent task).
- `PUT /api/tasks/:taskId/solutions/:language` upserts a reference-solution row (`language` is `c`/`java`, case-insensitively upper-cased server-side against the `C`/`JAVA` enum); `DELETE` on the same path removes it. Solutions are never returned by any student-facing endpoint — `server/src/routes/student.ts` doesn't touch the `Solution` model at all, keep it that way.
- `PATCH /api/tasks/:taskId` carries `language` and `starterCode` (both plain task fields — starter code, unlike the reference solution, *is* sent to students and saves with the task, not via its own route). The reference solution still has its own `PUT/DELETE /api/tasks/:taskId/solutions/:language` route.
- Deleting an `Exam` or `Task` cascades to its children via Prisma's `onDelete: Cascade` (see `schema.prisma`) — there's no soft-delete or orphan cleanup needed at the route level.

Frontend: `src/api/exams.ts` + `src/api/tasks.ts` wrap these endpoints; `src/types/exam.ts` holds the corresponding TS shapes. `TeacherDashboard` lists exams + an inline create form; `ExamDetailPage` (`/teacher/exams/:examId`) edits exam metadata and lists/creates tasks; `TaskEditorPage` (`/teacher/exams/:examId/tasks/:taskId`) edits statement (Markdown, previewed via `react-markdown`, no raw-HTML plugin — don't add `rehype-raw` without thinking through XSS from teacher-authored Markdown), a single `language` `<select>`, the starter template (a Monaco editor, all part of the main task form save — when the task has no starter code yet the field is pre-filled from `LANGUAGE_TEMPLATE[task.language]`, and changing the language `<select>` swaps that skeleton in only while `isUntouchedTemplate()` holds, never clobbering code the teacher typed; the pre-fill leaves the form "未保存" so it's persisted on the next save), plus `TestCaseRow` per test case and one `SolutionEditor` for the task's language with its own independent "保存" button. Test case fields save independently per-row via their own "保存" button, not as part of the task form submit — when writing browser-driven checks against this page, scope any selector to the specific card (e.g. `TestCaseRow`'s container has a distinguishing `p-3` class vs. `p-4` on the task-form/solution-editor cards) since there are multiple "保存" buttons on the page and a loosely-scoped `:last-of-type` or global text selector will silently click the wrong one.

### In-browser C compile/run sandbox (Phase 3)

`src/runner/cRunner.ts` wraps `@wasmer/sdk`: `compileAndRunC(sourceCode, stdin)` fetches `clang/clang` from the Wasmer registry (`Wasmer.fromRegistry`, memoized module-wide — only downloaded/initialized once per page load), compiles the source with `clang.entrypoint.run({ args: [...], mount: {...} })`, and if that succeeds, runs the resulting `.wasm` via `Wasmer.fromFile` with `stdin` passed straight through `SpawnOptions`. Returns `{ stage: 'compile_error' | 'runtime_error' | 'success', compileStderr, stdout, stderr, exitCode }` — no infinite-loop/resource-limit protection yet, that's explicitly Phase 6 (TLE/MLE).

**This needs cross-origin isolation to work at all**: `@wasmer/sdk` uses `SharedArrayBuffer` for its Web Worker thread pool even for single-threaded programs, which browsers only expose when the page sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `vite.config.ts` sets these for `server`/`preview`; **whatever serves the production build in Phase 5+ deployment must set the same two headers**, or the sandbox will fail silently/mysteriously in production even though it works in dev.

**Performance characteristics to keep in mind**: the `clang/clang` WASIX package is ~106MB (measured via `content-length`), fetched once per browser session and cached by the browser afterward. On a ~256KB/s link that's ~7 minutes for the very first compile; on campus/broadband it'll be much faster, but don't be surprised by a slow first run in any environment — this is inherent to shipping a real clang toolchain to the browser, not a bug. Subsequent runs in the same session reuse the in-memory `Wasmer` instance.

`src/components/CodeEditor.tsx` wraps `@monaco-editor/react`; its `language` prop takes `c`/`java`/`javascript`/`typescript`/`python`/`plaintext` (Monaco registers each as a real language id). Used in `TaskEditorPage` (starter + solution editors, mode = `task.language`), in `StudentTaskPage` (mode = `task.language`), and in `SandboxPage` (`/teacher/sandbox`, teacher-only) — a standalone manual-verification harness kept around independently of the real student flow (see below); don't delete it. `src/lib/language.ts` holds the shared per-language metadata (label, Monaco id, filename) plus `RUNNABLE_LANGUAGES` (everything the app can execute — currently all five) and `SERVER_EXEC_LANGUAGES` (`JAVA` only); `server/src/lib/language.ts` is the server-side counterpart (`LANGUAGES`, `languageSchema`, `parseLanguageParam`).

### Client-side JS / TS / Python runners (multi-language Increment 3)

`src/runner/clientRunner.ts` is the single entry point for every browser-executed language — `runClientSide(language, source, testCases, onProgress)` dispatches by language and returns the same `{ compileFailed, compileStderr, outcomes[] }` the C path always did (no self-declared verdict). `StudentTaskPage`'s `executeAgainstAllTestCases` just calls it; `prewarmClientRunner(language)` kicks off any heavy download early.

- **JS / TS** — `src/runner/jsRunner.ts` + `js.worker.ts`. `prepareJs()` transpiles TS with **sucrase** (`transforms: ['typescript']` — type-*stripping* only, so a type error never fails the judge; a **syntax** error does) or, for JS, syntax-checks via `new Function()`. Each test case then runs in a throwaway classic Web Worker that's `terminate()`d on a 10s timeout. The worker exposes `readline()` / `read()` for stdin and `print()` / `console.*` / `write()` for stdout (no `process` / `require`); top-level `await` is not supported. `sucrase` is a pure-JS dep (no native bindings — safe on the pinned Node, matching the repo's "pure-JS deps" preference).
- **Python** — `src/runner/pyRunner.ts` + `py.worker.ts`. **Pyodide** (CPython→WASM) loaded once per worker from the jsDelivr CDN (`PYODIDE_BASE_URL` in `py.worker.ts`; ~10MB first load, works under the app's COOP/COEP headers — if a deployment's CDN is blocked, self-host the pyodide dist and repoint that constant). One worker is reused across a run's test cases; on a 15s timeout it's `terminate()`d and recreated. Student code runs via `exec()` in a fresh globals dict with `sys.stdin`/`stdout`/`stderr` redirected; a traceback goes to stderr and marks the test a runtime error.
- Timeouts here already do more than the C path (which still has no infinite-loop protection — Phase 6): a JS/Python infinite loop is contained in its worker and killed, it just can't freeze the tab. Distinct `TLE`/`MLE` verdicts are still Phase 6.

### Server-side Java judge (multi-language Increment 2)

`judge/` (its own Docker image, `judge` service in `docker-compose.yml`) is a single-file Java HTTP service (`judge/Judge.java`, uses `com.sun.net.httpserver` + `javax.tools.JavaCompiler` + Gson) that compiles and runs student Java **inside the container only** — never on the host, so it behaves identically on macOS and Linux. The container *is* the sandbox: `cap_drop: ALL`, `read_only`, tmpfs `/work` + `/tmp`, `pids_limit`, `mem_limit`, `cpus`, `no-new-privileges`, non-root uid. Per test case it forks `java --enable-preview -cp <classes> Main` (source is always written as `Main.java`; entry class is always `Main` — an implicitly declared class from a JEP 495 compact source file is also named `Main`) wrapped in `sh -c 'ulimit -f …; ulimit -t …; exec "$@"'`, with a wall-clock `waitFor` + `destroyForcibly` on the process tree.

- Protocol: `POST /run { code, tests: [{ id, stdin, timeLimitMs, memoryLimitMb }] }` → `{ compile: { ok, stderr }, results: [{ id, stdout, stderr, exitCode, timedOut, oom }] }`. It does **not** compute a verdict — `judgeSubmission()` still does, from these raw outcomes.
- `server/src/lib/judgeClient.ts` talks to it over `JUDGE_URL` (default `http://localhost:4001`; empty ⇒ Java disabled, student UI shows "準備中"). `server/src/lib/executionQueue.ts` bounds it: a global concurrency cap (`JUDGE_CONCURRENCY`, default 3) plus a per-user in-flight cap of 1 (second concurrent request → 429).
- `timedOut` / `oom` / non-zero exit all currently map to a per-test `runtime_error` → `RE` badge → overall `WA`. Distinct `TLE`/`MLE` verdicts are still Phase 6.

### Student exam-taking flow + judge (Phase 4)

**The server, never the client, decides AC/WA/CE.** `server/src/lib/judge.ts`'s `judgeSubmission(testCases, points, { compileFailed, outcomes })` is the *only* place a verdict is computed. Where the `{ compileFailed, outcomes }` comes from depends on the language: for **client-exec** languages (C, JS, TS, Python) the browser compiles+runs locally and reports `{ testCaseId, stage: 'success'|'runtime_error', stdout }` per test case (never a self-declared pass/fail); for **server-exec** languages (Java) the browser sends only the source and `server/src/routes/student.ts`'s `resolveOutcomes()` calls the `judge` container and builds the outcomes from its output. Either way the client can only change *what code runs*, not make the server believe output matched a stored `expectedOutput` when it didn't.

- `server/src/routes/student.ts`, mounted at `/api/student`, gated by `requireAuth` only (not role-restricted — a teacher previewing the student view is fine; every route additionally filters to `exam.status === 'PUBLISHED'`, 404ing otherwise so a draft exam's existence isn't even leaked):
  - `GET /exams` — published exams + per-exam attempt state for the caller: `taskCount` / `totalPoints` / `maxAttempts` / `attemptsUsed` / `hasInProgress` / `canStart` / `latestScore`.
  - `POST /exams/:examId/attempts` — begin a new attempt (or return the in-progress one; idempotent). 409 if the retake cap is reached. This is the *only* way an `ExamAttempt` row is created.
  - `GET /exams/:examId` — read-only: task summaries + `maxAttempts` / `totalPoints`, the current `attempt` (`{ id, attemptNumber, startedAt, deadline, draftedTaskIds }` or null), `attemptsUsed`, `canStartNew`. Never returns a prior attempt's evaluation.
  - `GET /tasks/:taskId` — statement/points/`language`/`starterCode` + hidden-`expectedOutput`-redacted test cases, **plus** the current attempt's saved `draft` for this task (`{ code, keystrokeCount, … }` or null).
  - `PUT /tasks/:taskId/draft` — "下書き保存": upserts the `TaskDraft` for `(current attempt, task)` with `{ code, keystrokeCount, pasteCount, pastedCharCount, timeSpentSeconds }`. Never judged. 409 if no in-progress attempt.
  - `POST /tasks/:taskId/run` — ephemeral preview: judges, never persists. Body carries **no language** (the task fixes it): `resolveOutcomes()` branches on `task.language` — `{ compileFailed, outcomes }` for a client-exec language, `{ code }` for Java. Response `{ verdict, compileStderr }`.
  - `GET /exams/:examId/attempt` — everything the review page needs to grade the in-progress attempt client-side: per task its `language` / `serverExec` / `hasDraft` / `draftCode` / test-case `input`s. 404 if no in-progress attempt; 409 if this call auto-finalized an expired one.
  - `POST /exams/:examId/submit` — **finalize the current attempt.** Body `{ tasks: [{ taskId, compileFailed, outcomes }] }` carries per-task results only for client-exec languages (the browser ran the *saved draft*); Java tasks are compiled+run server-side from their stored draft. For each drafted task it builds a verdict via `judgeSubmission` and writes an immutable `Submission` (code + metrics copied from the draft); undrafted tasks get no submission ("未提出"). Then a guarded `updateMany` flips the attempt to `SUBMITTED` with `score` + `submittedAt` (so a double-submit can't grade twice). Response `{ attempt, perTask }`.
  - `GET /exams/:examId/result` — the latest SUBMITTED attempt: `{ exam:{…,tasks,totalPoints}, attempt:{ attemptNumber, score, submittedAt, startedAt } | null, perTask:[{ taskId, status, score }], attemptsUsed, maxAttempts, canRetake }`. Drives `StudentExamFinishedPage`'s result view.
- **Attempt lifecycle, drafts & final submission** (`server/src/lib/attempts.ts`): `maybeSettleAttempt(id)` auto-finalizes an attempt that is IN_PROGRESS *and* past `attemptDeadline(startedAt, timeLimitMinutes)` — decision 2026-09-10, "自動確定して評価". It's called opportunistically from every student read and from `getExamResults`. The server can't re-run browser languages, so a drafted client-exec task the student never submitted is graded **WA/0**; Java drafts are still run through the judge. The status flip is a single guarded `updateMany`, so concurrent settles don't double-write. The client also fires the finalize itself at the deadline (`StudentTaskPage` redirects to the review page, which auto-submits) — the server settle is the fallback for a closed browser.
- `Submission.overallStatus` only ever gets `AC`/`WA`/`CE` (`TLE`/`MLE` exist in the Prisma enum for Phase 6 but nothing produces them yet). A runtime crash (non-zero exit) surfaces as a per-test-case `'RE'` badge but rolls into the *overall* `WA`, since `RE` isn't a `SubmissionStatus` value — don't add it without a migration. `Submission.language` is copied from `task.language` server-side (any of `C` / `JAVA` / `JS` / `TS` / `PYTHON`).

**Frontend**: `src/runner/cRunner.ts` is split into `compileC(source)` + `runCompiledC(wasmBinary, stdin)` (`compileAndRunC` kept as a thin `SandboxPage` wrapper) so a run compiles once and executes the same binary against every test case. `StudentTaskPage` (`/student/exams/:examId/tasks/:taskId`) is the 3-column screen (statement + samples / Monaco fixed to `task.language` / run + **下書き保存** buttons + a header "試験を提出する"). "▶ コンパイル＆テスト実行" is the ephemeral preview (`executeAgainstAllTestCases` → `runClientSide` for C/JS/TS/Python, or a source POST for Java). "下書き保存" PUTs the draft — no navigation, no judging, no auto-advance. Editor content is seeded from the saved draft (falls back to `starterCode`), and the editor-metric counters are seeded from the draft too so revisiting a task continues rather than resets. If there's no in-progress attempt the page redirects to `/finished`; at the deadline it redirects there too. `StudentExamFinishedPage` (`/student/exams/:examId/finished`) is now three-mode: **review** (in-progress attempt — lists per-task draft status, "最終提出する" runs every client-exec draft locally then `POST /submit`, auto-submits if past the deadline), **result** (latest SUBMITTED attempt + total + "もう一度受験する" when `canRetake`), or loading. `StudentDashboard` shows per-exam attempt state and the right action (受験する / 受験を再開する / もう一度受験する / 結果を見る). Submissions are immutable; a student re-takes via a fresh attempt (within `maxAttempts`), and the teacher's per-student "差し戻し" still wipes everything (see Phase 5). Both editor pages use `useUnsavedGuard` for a `beforeunload` warning; `StudentTaskPage` also auto-saves the draft before in-app navigation away from a task.

**Testing gotcha worth knowing before writing more browser-driven checks against Monaco pages**: `page.keyboard.type()` to drive Monaco is unreliable — its auto-indent and auto-close-bracket features corrupt raw keystroke simulation (observed firsthand: typing `#include <stdio.h>` character-by-character came out as `#io.h>` with compounding indentation on each line, producing a real compile error that had nothing to do with the app). Set content via `page.evaluate(() => window.monaco.editor.getModels()[0].setValue(code))` instead — it still flows through the same `onDidChangeModelContent` → React `onChange` path a real edit would, just without the corruption.

### Teacher grade dashboard + CSV export (Phase 5)

`server/src/lib/examResults.ts`'s `getExamResults(examId)` is the single source of truth shared by both the JSON dashboard endpoint and the CSV export, specifically so the two can never disagree — always add new result fields there, not separately in each route. It lists **every `STUDENT` user**, not just ones who touched this exam. A student's grade is their **latest SUBMITTED attempt** (highest `attemptNumber`, not best score); the row's per-task cells, `totalScore`, `elapsedSeconds` and `attemptCount` all come from that attempt and its `Submission`s (one per task). It first calls `maybeSettleAttempt` on any IN_PROGRESS attempt past its deadline so an auto-finalized result shows rather than "未提出".

- `GET /api/exams/:examId/results` (`examsRouter`, teacher-only like the rest of that router) — `{ exam, tasks, students: [{ id, studentNumber, displayName, results: [{ taskId, status, score, submittedAt, keystrokeCount, pasteCount, pastedCharCount, timeSpentSeconds }], totalScore, lastSubmittedAt, startedAt, elapsedSeconds, attemptCount }] }`. `status` is `null` for a task the latest attempt didn't submit — the frontend renders "未提出", don't conflate it with a real WA. Every per-cell metric field is `null` there too. `elapsedSeconds` / `startedAt` are `null` until the student has a SUBMITTED attempt; `attemptCount` is the number of SUBMITTED attempts.
- `GET /api/exams/:examId/results/csv` — same data. Summary columns first (`学籍番号,氏名,試験名,<task titles…>,合計点,受験回数,提出日時,所要時間（秒）`), then per-task detail appended at the tail: one `<task>（解答時間・秒）` block, then one `<task>（打鍵数）` block. Two things worth knowing if you touch this: (1) the body is prefixed with a UTF-8 BOM (`server/src/lib/csv.ts`'s `UTF8_BOM`) because Excel misdetects encoding on Japanese CSVs without one; (2) `Content-Disposition` sends **both** an ASCII `filename=` and an RFC 5987 `filename*=UTF-8''...`.
- `DELETE /api/exams/:examId/students/:studentId/results` — the "差し戻し" reset. In one `$transaction` it `deleteMany`s every `Submission` **and** every `ExamAttempt` for that (exam, student) pair (`TaskDraft`s cascade from the attempt delete), putting them back to never-took-it. This is the *only* sanctioned break in submission immutability — teacher-only, irreversible, confirmed in the UI. It is distinct from a student simply re-taking within `maxAttempts`.
- Frontend: `src/api/exams.ts`'s `downloadExamResultsCsv(examId)` does its own `fetch` (the response isn't JSON), reads a `Blob`, triggers a download via a temporary `<a download>`. `ExamResultsPage` (`/teacher/exams/:examId/results`, linked from `ExamDetailPage`'s "成績を見る") renders a table with client-side search, a submitted / not-submitted filter, sortable columns (score / elapsed / name / last-submitted), a non-sortable 受験 (attempt count) column, summary stat tiles, per-task AC-rate bars, an expandable per-student row (per-task status, score, 打鍵数, 解答時間, 📋 paste-count badge), and the per-row "差し戻し" button.

### Routing / role gating (frontend)

`src/App.tsx` wires `/login`, `/signup` (public) and `/`, `/student`, `/student/exams/:examId/tasks/:taskId`, `/student/exams/:examId/finished`, `/teacher`, `/teacher/exams/:examId`, `/teacher/exams/:examId/tasks/:taskId`, `/teacher/exams/:examId/results`, `/teacher/sandbox` (all wrapped in `ProtectedRoute`). `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) redirects to `/login` if `profile` is null, and to `/` if the wrong role hits a role-locked route. `/` itself (`RoleHome`) just redirects to `/student` or `/teacher` based on `profile.role` — it's a dispatcher, not a page. `src/contexts/AuthContext.tsx` calls `GET /api/auth/me` on mount (and again via `refresh()` right after login/signup/logout) to populate `profile`.

This client-side gating is UX only; real authorization is enforced by the Express middleware (`requireAuth`/`requireRole`) on each route. Never add a data-bearing API route without one of those.
