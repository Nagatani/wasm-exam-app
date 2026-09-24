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
import { loginBlockedForMs, recordLoginFailure, recordLoginSuccess } from '../lib/loginRateLimit';

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

// Self-signup can be closed with ALLOW_SIGNUP=false, for deployments that
// issue every student account from the roster (POST /api/students/bulk) and
// don't want anyone else creating one. The very first account is always
// allowed regardless, so a fresh deployment can still bootstrap its first
// teacher (see the role comment in the signup handler below).
function signupAllowedByConfig(): boolean {
  return (process.env.ALLOW_SIGNUP ?? 'true').trim().toLowerCase() !== 'false';
}

async function isSignupOpen(): Promise<boolean> {
  return signupAllowedByConfig() || (await prisma.user.count()) === 0;
}

// Lets the login/signup pages hide or explain the signup form.
authRouter.get('/signup-status', async (_req, res) => {
  res.json({ signupOpen: await isSignupOpen() });
});

authRouter.post('/signup', async (req, res) => {
  if (!(await isSignupOpen())) {
    res.status(403).json({
      error: '新規登録は現在受け付けていません。アカウントの発行は担当の教員に依頼してください。',
    });
    return;
  }
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

  // Every signup is STUDENT except the very first account ever created,
  // which becomes TEACHER (2026-09-16, user decision): the first registered
  // user is expected to be the administrator setting the system up, and
  // requiring a raw SQL promote for that one account was pure friction.
  // Every signup after that stays STUDENT — promotion to teacher from then
  // on only ever happens via POST /api/admin/promote-to-teacher, gated on
  // the caller already being a teacher (server/src/routes/admin.ts). This
  // check-then-create isn't wrapped in a serializable transaction — a
  // deliberate, accepted race (two signups landing in the same instant
  // before any user exists could both become TEACHER) since the window only
  // exists for the few seconds between a fresh deploy and the first signup.
  const userCount = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      studentNumber,
      passwordHash,
      displayName: studentNumber,
      role: userCount === 0 ? 'TEACHER' : 'STUDENT',
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
  const ip = req.ip ?? 'unknown';

  // Checked before bcrypt so a locked-out caller can't keep probing.
  const waitMs = loginBlockedForMs(studentNumber, ip);
  if (waitMs > 0) {
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
    res.status(429).json({
      error: `ログインの失敗が続いたため、一時的にログインを制限しています。${minutes}分ほど待ってから再度お試しください。`,
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { studentNumber } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    recordLoginFailure(studentNumber, ip);
    res.status(401).json({ error: '学籍番号またはパスワードが正しくありません。' });
    return;
  }
  recordLoginSuccess(studentNumber, ip);

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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, '新しいパスワードは8文字以上で入力してください。'),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  const user = req.user!;

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: '現在のパスワードが正しくありません。' });
    return;
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    res.status(400).json({ error: '現在のパスワードと異なるパスワードを設定してください。' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    // Clear the printed-credential fields once the student picks their own.
    data: { passwordHash, mustChangePassword: false, initialPassword: null },
  });
  res.json({ ok: true });
});
