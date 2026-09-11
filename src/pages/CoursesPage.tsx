import { useEffect, useState, type FormEvent } from 'react';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { BackHeader } from '../components/BackHeader';
import { ApiError } from '../api/client';
import {
  createCourse,
  deleteCourse,
  enrollStudents,
  getCourse,
  listCourses,
  unenrollStudent,
} from '../api/courses';
import { bulkCreateStudents } from '../api/students';
import type {
  BulkCreateResult,
  CourseDetail,
  CourseStudent,
  CourseSummary,
  EnrollResult,
} from '../types/course';

// Split a pasted roster (one-per-line or CSV) into 学籍番号 tokens: first
// comma/tab/space-separated field of each non-empty line.
function parseRoster(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,\t ]/)[0]?.trim() ?? '')
    .filter((s) => s !== '' && !/^学籍番号$/i.test(s));
}

// Parse a `学籍番号,氏名` roster (CSV or tab-separated) for account creation.
function parseAccountRoster(text: string): { studentNumber: string; displayName: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      return { studentNumber: parts[0] ?? '', displayName: parts.slice(1).join(' ').trim() };
    })
    .filter(
      (r) => r.studentNumber !== '' && r.displayName !== '' && !/^学籍番号$/i.test(r.studentNumber),
    );
}

// Open a print-friendly window listing credential slips.
function printCredentials(
  courseName: string,
  rows: { studentNumber: string; displayName: string; initialPassword: string }[],
) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.studentNumber)}</td><td>${esc(r.displayName)}</td><td class="pw">${esc(
        r.initialPassword,
      )}</td></tr>`,
    )
    .join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>初期パスワード一覧</title>
<style>body{font-family:sans-serif;padding:24px}h1{font-size:16px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:6px 10px;text-align:left;font-size:13px}.pw{font-family:monospace}
p{font-size:12px;color:#555}</style></head><body>
<h1>${esc(courseName)} — 初期パスワード一覧</h1>
<p>初回ログイン後、生徒は必ずパスワードを変更してください。変更するとこの初期パスワードは無効になります。</p>
<table><thead><tr><th>学籍番号</th><th>氏名</th><th>初期パスワード</th></tr></thead><tbody>${body}</tbody></table>
</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    try {
      const { courses } = await listCourses();
      setCourses(courses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'クラス一覧の取得に失敗しました。');
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <BackHeader to="/teacher" label="講師管理画面に戻る" />
      <h1 className="mb-4 text-xl font-bold text-mp-cyan">クラス管理</h1>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">クラス一覧</h2>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
        >
          {showCreate ? 'キャンセル' : '+ 新規クラス'}
        </button>
      </div>

      {showCreate && (
        <CreateCourseForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

      {courses === null ? (
        <SkeletonRows />
      ) : courses.length === 0 ? (
        <EmptyState message="まだクラスがありません。" />
      ) : (
        <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                onClick={() =>
                  setExpandedId((id) => (id === course.id ? null : course.id))
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-mp-surface-hover"
              >
                <div>
                  <p className="font-bold">
                    {course.name}
                    {course.term && (
                      <span className="ml-2 text-sm text-mp-muted">{course.term}</span>
                    )}
                  </p>
                  <p className="text-sm text-mp-muted">
                    {course.enrollmentCount} 名 ・ {course.examCount} 試験
                  </p>
                </div>
                <span className="text-mp-muted">{expandedId === course.id ? '▼' : '▶'}</span>
              </button>
              {expandedId === course.id && (
                <CourseRosterPanel courseId={course.id} onChanged={load} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateCourseForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCourse({ name, term: term || null });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '作成に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-4"
    >
      <label className="mb-1 block text-sm text-mp-muted" htmlFor="course-name">
        クラス名
      </label>
      <input
        id="course-name"
        className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <label className="mb-1 block text-sm text-mp-muted" htmlFor="course-term">
        学期・期（任意）
      </label>
      <input
        id="course-term"
        className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        placeholder="2026 前期 など"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? '作成中...' : '作成する'}
      </button>
    </form>
  );
}

function CourseRosterPanel({
  courseId,
  onChanged,
}: {
  courseId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rosterText, setRosterText] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [lastResult, setLastResult] = useState<EnrollResult | null>(null);
  const [acctText, setAcctText] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<BulkCreateResult | null>(null);

  async function load() {
    try {
      const { course } = await getCourse(courseId);
      setDetail(course);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '取得に失敗しました。');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function handleEnroll() {
    const numbers = parseRoster(rosterText);
    if (numbers.length === 0) {
      setError('学籍番号を読み取れませんでした。');
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const result = await enrollStudents(courseId, numbers);
      setLastResult(result);
      setRosterText('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '追加に失敗しました。');
    } finally {
      setEnrolling(false);
    }
  }

  async function handleCreateAccounts() {
    const students = parseAccountRoster(acctText);
    if (students.length === 0) {
      setError('「学籍番号,氏名」の形式で入力してください。');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await bulkCreateStudents({ students, courseId });
      setLastCreated(result);
      setAcctText('');
      await load();
      onChanged();
      if (result.created.length > 0) {
        printCredentials(detail?.name ?? 'クラス', result.created);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'アカウント作成に失敗しました。');
    } finally {
      setCreating(false);
    }
  }

  function handlePrintAll() {
    const rows = (detail?.students ?? [])
      .filter((s): s is CourseStudent & { initialPassword: string } => s.initialPassword !== null)
      .map((s) => ({
        studentNumber: s.studentNumber,
        displayName: s.displayName,
        initialPassword: s.initialPassword,
      }));
    if (rows.length === 0) return;
    printCredentials(detail?.name ?? 'クラス', rows);
  }

  async function handleRemove(userId: string, label: string) {
    if (!confirm(`${label} をこのクラスから外しますか？`)) return;
    try {
      await unenrollStudent(courseId, userId);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '削除に失敗しました。');
    }
  }

  async function handleDeleteCourse() {
    if (!confirm('このクラスを削除します。所属する試験はクラス指定が外れます（試験自体は残ります）。よろしいですか？')) {
      return;
    }
    try {
      await deleteCourse(courseId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '削除に失敗しました。');
    }
  }

  return (
    <div className="border-t border-mp-border bg-mp-bg px-4 py-3">
      {error && <p className="mb-2 text-sm text-mp-red">{error}</p>}
      {detail === null ? (
        <p className="text-sm text-mp-muted">読み込み中...</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-bold text-mp-muted">受講者（{detail.students.length} 名）</p>
              {detail.students.some((s) => s.initialPassword !== null) && (
                <button
                  onClick={handlePrintAll}
                  className="rounded border border-mp-border bg-mp-surface px-2 py-0.5 text-xs font-bold hover:bg-mp-surface-hover"
                >
                  初期パスワード一覧を印刷
                </button>
              )}
            </div>
            {detail.students.length === 0 ? (
              <p className="text-sm text-mp-muted">まだ受講者がいません。</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded border border-mp-border">
                {detail.students.map((s) => (
                  <li
                    key={s.userId}
                    className="flex items-center justify-between border-b border-mp-border/50 px-2 py-1 text-sm last:border-b-0"
                  >
                    <span>
                      {s.studentNumber} <span className="text-mp-muted">{s.displayName}</span>
                      {s.initialPassword !== null && (
                        <span
                          className="ml-2 rounded bg-mp-yellow/20 px-1 font-mono text-xs text-mp-yellow"
                          title="初期パスワード（変更前）"
                        >
                          🔑 {s.initialPassword}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => handleRemove(s.userId, `${s.studentNumber} ${s.displayName}`)}
                      className="rounded bg-mp-red px-2 py-0.5 text-xs font-bold text-mp-btn-fg hover:opacity-90"
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-mp-muted">
              生徒アカウントを一括作成（1行に「学籍番号,氏名」、CSV可）— 既存の学籍番号はスキップされます。作成後、初期パスワード一覧が印刷用に開きます
            </p>
            <textarea
              rows={4}
              className="w-full rounded border border-mp-border bg-mp-surface px-2 py-1 font-mono text-sm text-mp-fg"
              placeholder={'s2600001,山田 太郎\ns2600002,佐藤 花子'}
              value={acctText}
              onChange={(e) => setAcctText(e.target.value)}
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={handleCreateAccounts}
                disabled={creating || acctText.trim() === ''}
                className="rounded bg-mp-cyan px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {creating ? '作成中...' : 'アカウントを作成'}
              </button>
              {lastCreated && (
                <span className="text-xs text-mp-muted">
                  {lastCreated.created.length} 名作成 ・ {lastCreated.enrolled} 名をこのクラスに登録
                  {lastCreated.skipped.length > 0 && (
                    <span className="text-mp-yellow">
                      {' '}
                      ・ 既存でスキップ: {lastCreated.skipped.join(', ')}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-mp-muted">
              学籍番号を追加（1行ずつ、またはCSVを貼り付け — 各行の先頭列を学籍番号として読みます）
            </p>
            <textarea
              rows={4}
              className="w-full rounded border border-mp-border bg-mp-surface px-2 py-1 font-mono text-sm text-mp-fg"
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={handleEnroll}
                disabled={enrolling || rosterText.trim() === ''}
                className="rounded bg-mp-cyan px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {enrolling ? '追加中...' : '受講者を追加'}
              </button>
              {lastResult && (
                <span className="text-xs text-mp-muted">
                  {lastResult.added} 名追加
                  {lastResult.alreadyEnrolled.length > 0 &&
                    ` ・ 既存 ${lastResult.alreadyEnrolled.length} 名`}
                  {lastResult.notFound.length > 0 && (
                    <span className="text-mp-red">
                      {' '}
                      ・ 未登録アカウント: {lastResult.notFound.join(', ')}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {detail.exams.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold text-mp-muted">このクラスの試験</p>
              <ul className="text-sm text-mp-muted">
                {detail.exams.map((ex) => (
                  <li key={ex.id}>
                    {ex.title}（{ex.status === 'PUBLISHED' ? '公開中' : '非公開'}）
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleDeleteCourse}
            className="rounded bg-mp-red px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90"
          >
            クラスを削除
          </button>
        </div>
      )}
    </div>
  );
}
