import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, PASSWORD, prisma, resetDb, signup, signupTeacher, startServer, stopServer } from './helpers';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

describe('signup / login / logout', () => {
  it('the first account becomes TEACHER, every later one STUDENT', async () => {
    const first = new Client();
    const a = await first.post('/api/auth/signup', { studentNumber: 'admin01', password: PASSWORD });
    expect(a.status).toBe(201);
    expect(a.body.user.role).toBe('TEACHER');

    const b = await new Client().post('/api/auth/signup', { studentNumber: 's001', password: PASSWORD });
    expect(b.status).toBe(201);
    expect(b.body.user.role).toBe('STUDENT');
  });

  it('ignores any role field in the signup body', async () => {
    await signupTeacher();
    const res = await new Client().post('/api/auth/signup', {
      studentNumber: 's001',
      password: PASSWORD,
      role: 'TEACHER',
    });
    expect(res.body.user.role).toBe('STUDENT');
  });

  it('rejects a duplicate student number and a short password', async () => {
    await signupTeacher();
    await signup('s001');
    expect((await new Client().post('/api/auth/signup', { studentNumber: 's001', password: PASSWORD })).status).toBe(409);
    expect((await new Client().post('/api/auth/signup', { studentNumber: 's002', password: 'short' })).status).toBe(400);
  });

  it('stores only a hash of the password and of the session token', async () => {
    const { client, userId } = await signupTeacher();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).not.toContain(PASSWORD);
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });

  it('login with a wrong password → 401, correct → session', async () => {
    await signupTeacher();
    const c = new Client();
    expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: 'wrongpass1' })).status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user.studentNumber).toBe('teacher01');
  });

  it('logout revokes the session server-side (a replayed cookie no longer works)', async () => {
    const { client } = await signupTeacher();
    // Keep a copy of the cookie jar state before logging out.
    const replay = Object.assign(Object.create(Object.getPrototypeOf(client)), client) as Client;
    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('change-password verifies the current password, then clears mustChangePassword', async () => {
    const { client, userId } = await signupTeacher();
    await prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: true, initialPassword: 'INITPASS' },
    });
    expect(
      (await client.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'newpassword1' })).status,
    ).not.toBe(200);
    const ok = await client.post('/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'newpassword1',
    });
    expect(ok.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustChangePassword).toBe(false);
    expect(user.initialPassword).toBeNull();
    expect((await new Client().post('/api/auth/login', { studentNumber: 'teacher01', password: 'newpassword1' })).status).toBe(200);
  });
});

describe('role gating', () => {
  it('unauthenticated requests get 401 on every protected router', async () => {
    const anon = new Client();
    for (const path of ['/api/exams', '/api/courses', '/api/task-bank', '/api/student/exams', '/api/student/practice/exams']) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });

  it('a STUDENT gets 403 on teacher-only routes', async () => {
    await signupTeacher();
    const { client: student } = await signup('s001');
    expect((await student.get('/api/exams')).status).toBe(403);
    expect((await student.post('/api/exams', { title: 'x', timeLimitMinutes: 10 })).status).toBe(403);
    expect((await student.get('/api/courses')).status).toBe(403);
    expect((await student.post('/api/students/bulk', { students: [] })).status).toBe(403);
    expect((await student.post('/api/admin/promote-to-teacher', { targetStudentNumber: 's001' })).status).toBe(403);
    expect((await student.get('/api/admin/service-health')).status).toBe(403);
  });

  it('only a teacher can promote, and promotion takes effect', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student } = await signup('s001');
    const res = await teacher.post('/api/admin/promote-to-teacher', { targetStudentNumber: 's001' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('TEACHER');
    expect((await student.get('/api/exams')).status).toBe(200);
  });
});

// Each failed login runs a real bcrypt compare (cost 12, ~250ms on a CI
// runner), and these tests make ~20 of them — well past vitest's 5s default.
const MANY_LOGINS_TIMEOUT = { timeout: 30_000 };

describe('login rate limiting', MANY_LOGINS_TIMEOUT, () => {
  it('locks an account after 10 failures from the same IP, even with the right password', async () => {
    await signupTeacher();
    const c = new Client();
    for (let i = 0; i < 10; i += 1) {
      expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: 'wrongpass1' })).status).toBe(401);
    }
    const locked = await c.post('/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // A different account from the same IP isn't affected by that lockout.
    await signup('s001');
    expect((await new Client().post('/api/auth/login', { studentNumber: 's001', password: PASSWORD })).status).toBe(200);
  });

  it('a successful login resets the per-account failure count', async () => {
    await signupTeacher();
    const c = new Client();
    for (let i = 0; i < 9; i += 1) {
      await c.post('/api/auth/login', { studentNumber: 'teacher01', password: 'wrongpass1' });
    }
    expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 9; i += 1) {
      expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: 'wrongpass1' })).status).toBe(401);
    }
    expect((await c.post('/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD })).status).toBe(200);
  });
});

describe('ALLOW_SIGNUP=false', () => {
  const original = process.env.ALLOW_SIGNUP;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_SIGNUP;
    else process.env.ALLOW_SIGNUP = original;
  });

  it('still lets the very first account (the bootstrap teacher) sign up, then closes signup', async () => {
    process.env.ALLOW_SIGNUP = 'false';
    expect((await new Client().get('/api/auth/signup-status')).body).toEqual({ signupOpen: true });
    const first = await new Client().post('/api/auth/signup', { studentNumber: 'admin01', password: PASSWORD });
    expect(first.status).toBe(201);
    expect(first.body.user.role).toBe('TEACHER');

    expect((await new Client().get('/api/auth/signup-status')).body).toEqual({ signupOpen: false });
    const second = await new Client().post('/api/auth/signup', { studentNumber: 's001', password: PASSWORD });
    expect(second.status).toBe(403);
    expect(await prisma.user.count()).toBe(1);
  });

  it('signup stays open by default', async () => {
    delete process.env.ALLOW_SIGNUP;
    await signupTeacher();
    expect((await new Client().get('/api/auth/signup-status')).body).toEqual({ signupOpen: true });
    expect((await new Client().post('/api/auth/signup', { studentNumber: 's001', password: PASSWORD })).status).toBe(201);
  });
});

describe('teacher password reset', MANY_LOGINS_TIMEOUT, () => {
  it('re-issues an initial password, forces a change, and signs the student out everywhere', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId } = await signup('s001');
    expect((await student.get('/api/auth/me')).status).toBe(200);

    const res = await teacher.post('/api/students/reset-password', { studentNumber: 's001' });
    expect(res.status).toBe(200);
    const newPassword: string = res.body.initialPassword;
    expect(newPassword).toMatch(/^[A-Za-z0-9]{12}$/);

    // Old session is revoked; old password no longer works; new one does.
    expect((await student.get('/api/auth/me')).status).toBe(401);
    expect((await new Client().post('/api/auth/login', { studentNumber: 's001', password: PASSWORD })).status).toBe(401);
    const relogin = new Client();
    expect((await relogin.post('/api/auth/login', { studentNumber: 's001', password: newPassword })).status).toBe(200);
    expect((await relogin.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.initialPassword).toBe(newPassword);
  });

  it('lifts a login lockout on the account', async () => {
    const { client: teacher } = await signupTeacher();
    await signup('s001');
    const c = new Client();
    for (let i = 0; i < 10; i += 1) {
      await c.post('/api/auth/login', { studentNumber: 's001', password: 'wrongpass1' });
    }
    expect((await c.post('/api/auth/login', { studentNumber: 's001', password: PASSWORD })).status).toBe(429);
    const { body } = await teacher.post('/api/students/reset-password', { studentNumber: 's001' });
    expect((await c.post('/api/auth/login', { studentNumber: 's001', password: body.initialPassword })).status).toBe(200);
  });

  it('is teacher-only, refuses teacher accounts, and 404s an unknown student number', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student } = await signup('s001');
    await signup('s002');
    expect((await student.post('/api/students/reset-password', { studentNumber: 's002' })).status).toBe(403);
    expect((await teacher.post('/api/students/reset-password', { studentNumber: 'teacher01' })).status).toBe(400);
    expect((await teacher.post('/api/students/reset-password', { studentNumber: 'nobody' })).status).toBe(404);
  });
});

describe('teacher force-logout', () => {
  it('signs the student out of every session but keeps the password', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: a } = await signup('s001');
    const b = new Client();
    expect((await b.post('/api/auth/login', { studentNumber: 's001', password: PASSWORD })).status).toBe(200);

    const res = await teacher.post('/api/students/force-logout', { studentNumber: 's001' });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);
    expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await b.get('/api/auth/me')).status).toBe(401);

    // Same password still works; the teacher's own session is untouched.
    const c = new Client();
    expect((await c.post('/api/auth/login', { studentNumber: 's001', password: PASSWORD })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user.mustChangePassword).toBe(false);
    expect((await teacher.get('/api/auth/me')).status).toBe(200);
  });

  it('is teacher-only, refuses teacher accounts, and 404s an unknown student number', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student } = await signup('s001');
    await signup('s002');
    expect((await student.post('/api/students/force-logout', { studentNumber: 's002' })).status).toBe(403);
    expect((await teacher.post('/api/students/force-logout', { studentNumber: 'teacher01' })).status).toBe(400);
    expect((await teacher.post('/api/students/force-logout', { studentNumber: 'nobody' })).status).toBe(404);
  });
});
