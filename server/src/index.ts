import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { examsRouter } from './routes/exams';
import { coursesRouter } from './routes/courses';
import { studentsRouter } from './routes/students';
import { tasksRouter } from './routes/tasks';
import { taskBankRouter } from './routes/taskBank';
import { testCasesRouter } from './routes/testCases';
import { studentRouter } from './routes/student';
import { uploadsRouter } from './routes/uploads';
import { UPLOADS_DIR, UPLOADS_URL_PREFIX } from './lib/uploads';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
// server/src and server/dist (tsx dev vs. compiled prod) sit at the same
// depth under server/, so this resolves to the repo-root frontend build
// output either way. Override via CLIENT_DIST_PATH if that ever changes.
const CLIENT_DIST_PATH = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.env.CLIENT_DIST_PATH)
  : path.resolve(__dirname, '../../dist');

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// @wasmer/sdk (the in-browser C sandbox, Phase 3) needs SharedArrayBuffer,
// which browsers only expose on a cross-origin-isolated page. Vite's dev
// server sets these itself (vite.config.ts); this server needs to set them
// too now that it can also be the one serving the frontend HTML (see below).
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/exams', examsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/task-bank', taskBankRouter);
app.use('/api/test-cases', testCasesRouter);
app.use('/api/student', studentRouter);
app.use('/api/uploads', uploadsRouter);

// Task-statement images (POST /api/uploads above writes here) — served
// publicly, no auth: see lib/uploads.ts for why. Registered before the
// frontend's own static/catch-all block below just for clarity of intent;
// order doesn't matter between the two since their path prefixes don't
// overlap (/uploads/* vs. everything else).
app.use(UPLOADS_URL_PREFIX, express.static(UPLOADS_DIR));

// Serves the frontend's production build (`npm run build` at the repo root)
// so one `npm start` here runs the whole app — no separate Vite dev-server
// terminal needed for day-to-day operation. Registered after the API routes
// so /api/* always reaches Express handlers first; anything else falls back
// to index.html so React Router's client-side routes survive a hard refresh.
app.use(express.static(CLIENT_DIST_PATH));
app.get('*', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST_PATH, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});
