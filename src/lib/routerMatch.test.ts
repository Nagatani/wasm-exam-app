import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNavLinkActive, matchPath } from './routerMatch.ts';

describe('matchPath', () => {
  it('matches root and static paths exactly', () => {
    assert.deepEqual(matchPath('/', '/'), {});
    assert.deepEqual(matchPath('/login', '/login'), {});
    assert.deepEqual(matchPath('/teacher/courses', '/teacher/courses'), {});
    assert.equal(matchPath('/login', '/signup'), null);
    assert.equal(matchPath('/teacher', '/teacher/courses'), null);
    assert.equal(matchPath('/', '/student'), null);
  });

  it('normalizes trailing slashes', () => {
    assert.deepEqual(matchPath('/student', '/student/'), {});
    assert.deepEqual(matchPath('/student/', '/student'), {});
    assert.deepEqual(matchPath('/', '///'), {});
  });

  it('extracts :param segments and decodes URI components', () => {
    assert.deepEqual(
      matchPath('/student/exams/:examId/tasks/:taskId', '/student/exams/ex-1/tasks/t-2'),
      { examId: 'ex-1', taskId: 't-2' },
    );
    assert.deepEqual(
      matchPath('/teacher/exams/:examId', '/teacher/exams/hello%20world'),
      { examId: 'hello world' },
    );
    // Malformed percent-encoding falls back to raw segment instead of throwing.
    assert.deepEqual(matchPath('/items/:id', '/items/%E0%A4%A'), { id: '%E0%A4%A' });
  });

  it('does not match when segment counts differ', () => {
    assert.equal(matchPath('/teacher/exams/:examId', '/teacher/exams'), null);
    assert.equal(matchPath('/teacher/exams/:examId', '/teacher/exams/1/results'), null);
  });

  it('supports wildcard fallback routes', () => {
    assert.deepEqual(matchPath('*', '/anything/at/all'), {});
    assert.deepEqual(matchPath('/*', '/'), {});
    assert.deepEqual(matchPath('/docs/*', '/docs/a/b'), { '*': 'a/b' });
    assert.deepEqual(matchPath('/docs/*', '/docs'), { '*': '' });
    assert.equal(matchPath('/docs/*', '/other'), null);
  });

  it('ignores query strings and hashes in pathname', () => {
    assert.deepEqual(matchPath('/teacher/exams/:examId', '/teacher/exams/42?tab=1#top'), {
      examId: '42',
    });
  });
});

describe('isNavLinkActive', () => {
  it('matches exact paths when end is true', () => {
    assert.equal(isNavLinkActive('/teacher', '/teacher', true), true);
    assert.equal(isNavLinkActive('/teacher', '/teacher/', true), true);
    assert.equal(isNavLinkActive('/teacher', '/teacher/courses', true), false);
    assert.equal(isNavLinkActive('/student', '/student/exams/1/finished', true), false);
  });

  it('matches prefix segments when end is false (default)', () => {
    assert.equal(isNavLinkActive('/teacher/courses', '/teacher/courses'), true);
    assert.equal(isNavLinkActive('/teacher/courses', '/teacher/courses/123'), true);
    assert.equal(isNavLinkActive('/teacher/courses', '/teacher/courses-archive'), false);
    assert.equal(isNavLinkActive('/settings', '/change-password'), false);
  });

  it('handles root link with and without end', () => {
    assert.equal(isNavLinkActive('/', '/'), true);
    assert.equal(isNavLinkActive('/', '/student'), true);
    assert.equal(isNavLinkActive('/', '/', true), true);
    assert.equal(isNavLinkActive('/', '/student', true), false);
  });
});
