import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
  createSession,
  revokeSessionByToken,
} from '../lib/session';
import { toPublicUser } from '../lib/publicUser';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

const credentialsSchema = z.object({
  studentNumber: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{3,32}$/, '学籍番号は英数字・ハイフン・アンダースコアのみ、3〜32文字で入力してください。'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください。'),
});

function cookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

authRouter.post('/signup', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }
  const { studentNumber, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { studentNumber } });
  if (existing) {
    res.status(409).json({ error: 'この学籍番号は既に登録されています。' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // role always defaults to STUDENT here — promotion to teacher only ever
  // happens via POST /api/admin/promote-to-teacher, gated on the caller
  // already being a teacher. See server/src/routes/admin.ts.
  const user = await prisma.user.create({
    data: {
      studentNumber,
      passwordHash,
      displayName: studentNumber,
      role: 'STUDENT',
    },
  });

  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ user: toPublicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '学籍番号またはパスワードが正しくありません。' });
    return;
  }
  const { studentNumber, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { studentNumber } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: '学籍番号またはパスワードが正しくありません。' });
    return;
  }

  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
  res.json({ user: toPublicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    await revokeSessionByToken(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});
