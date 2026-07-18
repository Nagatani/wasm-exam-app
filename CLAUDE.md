# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based online coding exam/judge system (LMS) for a C/Java programming course. Students write code in Monaco Editor and it compiles/runs entirely client-side (WASI/Wasmer for C; Java via CheerpJ is **currently blocked**, see below) — no student source code is ever sent to a server for execution. Teachers author exams, tasks, and test cases and review student results.

**Java-in-browser is on hold, not implemented**: the course teaches Java 25 and wants JEP 512 ("Compact Source Files and Instance Main Methods") available to students, but CheerpJ's latest shipped release (4.3, April 2026) only supports Java up to 17 — this is a platform ceiling in CheerpJ itself, not something a different `tools.jar` can work around. Don't build a Java execution path until CheerpJ (or an alternative) actually ships Java 21+/25 support — check `https://cheerpj.com/docs/changelog.html` before resuming this. Only the C track was built in Phase 3.

Personal data (student IDs, names, scores) must stay on infrastructure the institution controls — this is *why* the backend is a self-hosted Node/Express + PostgreSQL server rather than a third-party BaaS (Firebase/Supabase were explicitly ruled out for this reason; don't suggest moving auth/data to an external cloud provider without raising this constraint first).

The original single-file mock prototype (`index.html` + `app.js`, a fake `mockWasmRun` that just summed two integers) has been moved to `legacy/` for reference and superseded by the app under `src/` + `server/`.

Being built in explicit phases (see project memory / prior conversation for the full roadmap): Phase 1 (auth + roles), Phase 2 (teacher exam/task/test-case authoring), Phase 3 (Monaco Editor + in-browser C compile/run sandbox — C only, see the Java note above), Phase 4 (student exam-taking UI + judge wired into a real submission flow), and Phase 5 (teacher grade dashboard + CSV export) are done; hardening (TLE/MLE, friendlier error feedback) comes in Phase 6. Don't jump ahead to a later phase's code without the user's sign-off.

## Commands

Frontend (repo root):
- `npm run dev` — start the Vite dev server (expects the API server from `VITE_API_BASE_URL` in `.env`, default `http://localhost:4000`).
- `npm run build` — typecheck (`tsc -b`) then production build.
- `npm run lint` — run oxlint over the frontend.
- `npm run preview` — preview a production build locally.

Backend (`server/`):
- `docker compose up -d db` (from repo root) — start local PostgreSQL. **Maps to host port 5433, not 5432** — see the Postgres port note below before changing this.
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

There is no third-party BaaS anywhere in this stack. Judging still happens in the student's browser (WASI/Wasmer, CheerpJ) — the server's job is auth, data storage, and (in later phases) authoring/grading APIs, not code execution.

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
exams          title, status: DRAFT|PUBLISHED, createdById
tasks          examId, order, statementMarkdown, starterCodeC/starterCodeJava, points
test_cases     taskId, input, expectedOutput, isSample, order
solutions      taskId, language, code            — teacher-only reference solution
submissions    examId, taskId, studentId, language, code, results (Json), overallStatus, score
```

`submissions` carries `examId`/`taskId`/`studentId` as plain FK columns (not deeply nested) specifically so a teacher's grade dashboard / CSV export (Phase 5, see below) can query across all students and exams with a normal SQL `WHERE`/`JOIN`, which was one of the concrete reasons PostgreSQL was chosen over a document store.

**No execution-time tracking**: the original spec mentioned an execution-time column as a "nice to have" for the grade dashboard, but nothing in this schema captures how long a student's program took to run (the client-side runner doesn't measure or report it, and `Submission` has no such field). Phase 5's dashboard/CSV don't have this column — don't assume it exists without adding both the measurement and a schema migration first.

**Hidden test case secrecy is implemented (Phase 4)**: `GET /api/student/tasks/:taskId` (`server/src/routes/student.ts`) sends every test case's `input` (the client needs it to feed the student's program) but only includes `expectedOutput` when `isSample` is true — verified during Phase 4 testing by inspecting every `/api/student/*` response body for the hidden test case's expected value and confirming it never appears. See "Student exam-taking flow" below for how judging then happens without the client ever holding the hidden answer.

### Teacher exam/task/test-case authoring API (Phase 2)

All of `server/src/routes/exams.ts`, `tasks.ts`, `testCases.ts` are mounted at `/api/exams`, `/api/tasks`, `/api/test-cases` and gated by `requireAuth, requireRole('TEACHER')` at the router level (`router.use(...)`) — there is currently no ownership check beyond "is a teacher," i.e. any teacher can edit any other teacher's exam. That's intentional for a small teaching-team admin console, not an oversight; revisit only if the user asks for per-teacher exam isolation.

- `POST/GET /api/exams`, `GET/PATCH/DELETE /api/exams/:examId` — exam CRUD. `GET /:examId` returns a lightweight `tasks` array (id/order/title/points only); full task content (statement, starter code, test cases, solutions) is only ever fetched via `GET /api/tasks/:taskId`, so the exam detail page stays cheap to load.
- `POST /api/exams/:examId/tasks` creates a task (mounted on `examsRouter`, not `tasksRouter`, since it's the nested-create route). `GET/PATCH/DELETE /api/tasks/:taskId` operate directly on a task by id.
- `POST /api/tasks/:taskId/test-cases` creates a test case; `PATCH/DELETE /api/test-cases/:testCaseId` (separate router, since a test case is addressed directly once created, not through its parent task).
- `PUT /api/tasks/:taskId/solutions/:language` upserts a reference-solution row (`language` is `c`/`java`, case-insensitively upper-cased server-side against the `C`/`JAVA` enum); `DELETE` on the same path removes it. Solutions are never returned by any student-facing endpoint — `server/src/routes/student.ts` doesn't touch the `Solution` model at all, keep it that way.
- Deleting an `Exam` or `Task` cascades to its children via Prisma's `onDelete: Cascade` (see `schema.prisma`) — there's no soft-delete or orphan cleanup needed at the route level.

Frontend: `src/api/exams.ts` + `src/api/tasks.ts` wrap these endpoints; `src/types/exam.ts` holds the corresponding TS shapes. `TeacherDashboard` lists exams + an inline create form; `ExamDetailPage` (`/teacher/exams/:examId`) edits exam metadata and lists/creates tasks; `TaskEditorPage` (`/teacher/exams/:examId/tasks/:taskId`) edits statement (Markdown, previewed via `react-markdown`, no raw-HTML plugin — don't add `rehype-raw` without thinking through XSS from teacher-authored Markdown), starter code, and renders `TestCaseRow` per test case plus two `SolutionEditor`s (C/Java). Test case fields save independently per-row via their own "保存" button, not as part of the task form submit — when writing browser-driven checks against this page, scope any selector to the specific card (e.g. `TestCaseRow`'s container has a distinguishing `p-3` class vs. `p-4` on the task-form/solution-editor cards) since there are multiple "保存" buttons on the page and a loosely-scoped `:last-of-type` or global text selector will silently click the wrong one.

### In-browser C compile/run sandbox (Phase 3)

`src/runner/cRunner.ts` wraps `@wasmer/sdk`: `compileAndRunC(sourceCode, stdin)` fetches `clang/clang` from the Wasmer registry (`Wasmer.fromRegistry`, memoized module-wide — only downloaded/initialized once per page load), compiles the source with `clang.entrypoint.run({ args: [...], mount: {...} })`, and if that succeeds, runs the resulting `.wasm` via `Wasmer.fromFile` with `stdin` passed straight through `SpawnOptions`. Returns `{ stage: 'compile_error' | 'runtime_error' | 'success', compileStderr, stdout, stderr, exitCode }` — no infinite-loop/resource-limit protection yet, that's explicitly Phase 6 (TLE/MLE).

**This needs cross-origin isolation to work at all**: `@wasmer/sdk` uses `SharedArrayBuffer` for its Web Worker thread pool even for single-threaded programs, which browsers only expose when the page sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `vite.config.ts` sets these for `server`/`preview`; **whatever serves the production build in Phase 5+ deployment must set the same two headers**, or the sandbox will fail silently/mysteriously in production even though it works in dev.

**Performance characteristics to keep in mind**: the `clang/clang` WASIX package is ~106MB (measured via `content-length`), fetched once per browser session and cached by the browser afterward. On a ~256KB/s link that's ~7 minutes for the very first compile; on campus/broadband it'll be much faster, but don't be surprised by a slow first run in any environment — this is inherent to shipping a real clang toolchain to the browser, not a bug. Subsequent runs in the same session reuse the in-memory `Wasmer` instance.

`src/components/CodeEditor.tsx` wraps `@monaco-editor/react` (`language="c"` — Monaco registers `"c"` as a real language id sharing the C++ tokenizer, not a fallback). Used in `TaskEditorPage` for the C starter-code and C solution fields (Java fields are still plain `<textarea>`s, matching the CheerpJ hold above), and in `SandboxPage` (`/teacher/sandbox`, teacher-only) — a standalone manual-verification harness kept around independently of the real student flow (see below); don't delete it.

### Student exam-taking flow + judge (Phase 4)

**The server, never the client, decides AC/WA/CE.** `server/src/lib/judge.ts`'s `judgeSubmission(testCases, points, { compileFailed, outcomes })` is the *only* place a verdict is computed: the client compiles and runs the student's program against every test case's `input` locally, then reports back only `{ testCaseId, stage: 'success'|'runtime_error', stdout }` per test case — never a self-declared pass/fail. This is deliberate: a student who tampers with the client (devtools, a modified build) can only ever change what code runs, not have the server believe it passed when the stored `expectedOutput` says otherwise.

- `server/src/routes/student.ts`, mounted at `/api/student`, gated by `requireAuth` only (not role-restricted — a teacher previewing the student view is fine; every route additionally filters to `exam.status === 'PUBLISHED'`, 404ing otherwise so a draft exam's existence isn't even leaked):
  - `GET /exams` — published exams only.
  - `GET /exams/:examId` — ordered task summaries (id/order/title/points) + `submittedTaskIds` for the current user (used to resume/redirect).
  - `GET /tasks/:taskId` — statement/starterCodeC/points + test cases with the hidden-`expectedOutput` redaction described above.
  - `POST /tasks/:taskId/run` — ephemeral: judges but does not persist. This is the "try it out" action.
  - `POST /submissions` — persists. Independently re-derives the verdict server-side from the same `judgeSubmission` call rather than trusting anything the client computed; `examId`/`studentId` are derived server-side from the authenticated session and the task, never taken from the request body.
  - `GET /exams/:examId/submissions` — the current student's own latest submission per task (by `submittedAt`), used for the finished-page summary.
- `Submission.overallStatus` only ever gets `AC`/`WA`/`CE` written by this phase (`TLE`/`MLE` exist in the Prisma enum for Phase 6 but nothing produces them yet). A runtime crash (non-zero exit) is surfaced to the UI as a per-test-case `'RE'` badge but rolls up into the *overall* `WA`, since `RE` isn't a value the `SubmissionStatus` enum has — don't add it without a migration; check whether Phase 6 wants to instead.

**Frontend**: `src/runner/cRunner.ts` was split into `compileC(source)` and `runCompiledC(wasmBinary, stdin)` (previously a single combined `compileAndRunC`, kept as a thin wrapper for `SandboxPage`) specifically so the student flow compiles once per run/submit and executes the same binary against every test case, instead of recompiling per test case. `StudentTaskPage` (`/student/exams/:examId/tasks/:taskId`) is the 3-column exam-taking screen (statement + sample test cases / Monaco editor / run+submit buttons with per-test-case results); both "実行" and "送信" call the same local `executeAgainstAllTestCases` helper — submit doesn't reuse a prior run's results, it always recompiles+reruns against the *current* editor content before persisting, so there's no way to submit stale results by editing after running. On successful submit it looks up the next task by `order` from the exam's task list and navigates there, or to `StudentExamFinishedPage` (`/student/exams/:examId/finished`) if it was the last one. `StudentDashboard` lists published exams and, on "受験する", fetches the exam detail to decide whether to jump into the first unsubmitted task or straight to the finished page if everything's already submitted (submissions are immutable — there's no re-attempt flow).

**Testing gotcha worth knowing before writing more browser-driven checks against Monaco pages**: `page.keyboard.type()` to drive Monaco is unreliable — its auto-indent and auto-close-bracket features corrupt raw keystroke simulation (observed firsthand: typing `#include <stdio.h>` character-by-character came out as `#io.h>` with compounding indentation on each line, producing a real compile error that had nothing to do with the app). Set content via `page.evaluate(() => window.monaco.editor.getModels()[0].setValue(code))` instead — it still flows through the same `onDidChangeModelContent` → React `onChange` path a real edit would, just without the corruption.

### Teacher grade dashboard + CSV export (Phase 5)

`server/src/lib/examResults.ts`'s `getExamResults(examId)` is the single source of truth shared by both the JSON dashboard endpoint and the CSV export, specifically so the two can never disagree — always add new result fields there, not separately in each route. It lists **every `STUDENT` user**, not just ones who touched this exam (a teacher needs to see who hasn't submitted anything at all), joined against the exam's tasks and each student's *latest* submission per task (submissions are immutable and a student can in principle have several for the same task, e.g. resubmission if that's ever added — this always takes the most recent by `submittedAt`).

- `GET /api/exams/:examId/results` (`examsRouter`, teacher-only like the rest of that router) — `{ exam, tasks, students: [{ id, studentNumber, displayName, results: [{ taskId, status, score, submittedAt }], totalScore, lastSubmittedAt }] }`. `status` is `null` (not `'WA'` or anything else) for a task a student never submitted — the frontend renders that as "未提出", don't conflate it with an actual wrong-answer submission.
- `GET /api/exams/:examId/results/csv` — same data, columns `学籍番号,氏名,試験名,<task titles...>,合計点,提出日時`. Two things worth knowing if you touch this: (1) the body is prefixed with a UTF-8 BOM (`server/src/lib/csv.ts`'s `UTF8_BOM`) because Excel misdetects encoding on Japanese CSVs without one; (2) `Content-Disposition` sends **both** an ASCII `filename=` and an RFC 5987 `filename*=UTF-8''...` (the exam title is Japanese, and a bare `filename="日本語.csv"` is invalid/inconsistently handled across browsers).
- Frontend: `src/api/exams.ts`'s `downloadExamResultsCsv(examId)` doesn't go through the shared `apiFetch` JSON helper (the response isn't JSON) — it does its own `fetch` with `credentials: 'include'`, reads the body as a `Blob`, and triggers a download via a temporary `<a download>` element. `ExamResultsPage` (`/teacher/exams/:examId/results`, linked from `ExamDetailPage`'s "成績を見る") renders the same data as a table.

### Routing / role gating (frontend)

`src/App.tsx` wires `/login`, `/signup` (public) and `/`, `/student`, `/student/exams/:examId/tasks/:taskId`, `/student/exams/:examId/finished`, `/teacher`, `/teacher/exams/:examId`, `/teacher/exams/:examId/tasks/:taskId`, `/teacher/exams/:examId/results`, `/teacher/sandbox` (all wrapped in `ProtectedRoute`). `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) redirects to `/login` if `profile` is null, and to `/` if the wrong role hits a role-locked route. `/` itself (`RoleHome`) just redirects to `/student` or `/teacher` based on `profile.role` — it's a dispatcher, not a page. `src/contexts/AuthContext.tsx` calls `GET /api/auth/me` on mount (and again via `refresh()` right after login/signup/logout) to populate `profile`.

This client-side gating is UX only; real authorization is enforced by the Express middleware (`requireAuth`/`requireRole`) on each route. Never add a data-bearing API route without one of those.
