# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based online coding exam/judge system (LMS) for a C/Java programming course. Students write code in Monaco Editor and it compiles/runs entirely client-side (WASI/Wasmer for C, CheerpJ for Java in later phases) — no student source code is ever sent to a server for execution. Teachers author exams, tasks, and test cases and review student results.

Personal data (student IDs, names, scores) must stay on infrastructure the institution controls — this is *why* the backend is a self-hosted Node/Express + PostgreSQL server rather than a third-party BaaS (Firebase/Supabase were explicitly ruled out for this reason; don't suggest moving auth/data to an external cloud provider without raising this constraint first).

The original single-file mock prototype (`index.html` + `app.js`, a fake `mockWasmRun` that just summed two integers) has been moved to `legacy/` for reference and superseded by the app under `src/` + `server/`.

Being built in explicit phases (see project memory / prior conversation for the full roadmap): Phase 1 (auth + roles) is done; exam/task/test-case authoring, the in-browser C/Java judge, student exam-taking UI, and the teacher grade dashboard + CSV export come in later phases. Don't jump ahead to a later phase's code without the user's sign-off.

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

`submissions` carries `examId`/`taskId`/`studentId` as plain FK columns (not deeply nested) specifically so a teacher's grade dashboard / CSV export (later phase) can query across all students and exams with a normal SQL `WHERE`/`JOIN`, which was one of the concrete reasons PostgreSQL was chosen over a document store.

**Hidden test case secrecy is an open design point for the judge (Phase 3)**: because compiling/running code happens in the student's browser, the browser needs the test case `input` to feed the program, but it does *not* strictly need `expectedOutput` — unlike the earlier Firebase/Firestore-only design (where the client had no choice but to read both to self-judge), this stack now has a real backend, so hidden test cases *can* be judged by having the browser POST its actual stdout to an API route that holds `expectedOutput` server-side and returns only the verdict. Don't assume this for granted until Phase 3 actually implements it — flag it as a decision point rather than silently exposing `expectedOutput` to the client for non-sample test cases.

### Routing / role gating (frontend)

`src/App.tsx` wires `/login`, `/signup` (public) and `/`, `/student`, `/teacher` (wrapped in `ProtectedRoute`). `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) redirects to `/login` if `profile` is null, and to `/` if the wrong role hits a role-locked route. `/` itself (`RoleHome`) just redirects to `/student` or `/teacher` based on `profile.role` — it's a dispatcher, not a page. `src/contexts/AuthContext.tsx` calls `GET /api/auth/me` on mount (and again via `refresh()` right after login/signup/logout) to populate `profile`. `StudentDashboard`/`TeacherDashboard` are currently placeholders pending Phase 2+.

This client-side gating is UX only; real authorization is enforced by the Express middleware (`requireAuth`/`requireRole`) on each route. Never add a data-bearing API route without one of those.
