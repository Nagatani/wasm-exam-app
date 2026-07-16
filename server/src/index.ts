import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { examsRouter } from './routes/exams';
import { tasksRouter } from './routes/tasks';
import { testCasesRouter } from './routes/testCases';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/exams', examsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/test-cases', testCasesRouter);

app.listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});
