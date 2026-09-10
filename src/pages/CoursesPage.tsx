import { useEffect, useState, type FormEvent } from 'react';
import { AppHeader } from '../components/AppHeader';
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
import type { CourseDetail, CourseSummary, EnrollResult } from '../types/course';

// Split a pasted roster (one-per-line or CSV) into 学籍番号 tokens: first
// comma/tab/space-separated field of each non-empty line.
function parseRoster(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,\t ]/)[0]?.trim() ?? '')
    .filter((s) => s !== '' && !/^学籍番号$/i.test(s));
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
      <AppHeader title="クラス管理" />

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
            <p className="mb-1 text-xs font-bold text-mp-muted">受講者（{detail.students.length} 名）</p>
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
