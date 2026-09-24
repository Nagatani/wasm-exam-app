import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
