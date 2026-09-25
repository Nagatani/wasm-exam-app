import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { AppHeader } from '../components/AppHeader';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { HelpPopover } from '../components/HelpPopover';
import { EXAM_MODE_HELP_TEXT } from '../lib/examModeHelp';
import { createExam, duplicateExam, listExams } from '../api/exams';
import { listCourses } from '../api/courses';
import { ApiError } from '../api/client';
import { datetimeLocalToIso } from '../lib/datetime';
import { ALL_LANGUAGES, LANGUAGE_LABEL } from '../lib/language';
import type { ExamSummary, ExamStatus, ExamMode, Language } from '../types/exam';
import type { CourseSummary } from '../types/course';

const STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: '非公開',
  PUBLISHED: '公開中',
};

export function TeacherDashboard() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  async function loadExams() {
    setLoading(true);
    try {
      const { exams } = await listExams();
      setExams(exams);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExams();
  }, []);

  async function handleDuplicate(examId: string) {
    setDuplicatingId(examId);
    setError(null);
    try {
      await duplicateExam(examId);
      await loadExams();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の複製に失敗しました。');
    } finally {
      setDuplicatingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <AppHeader title="教師ダッシュボード" />

      <p className="mb-4 text-mp-muted">ようこそ、{profile?.displayName} さん。</p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">試験一覧</h2>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
        >
          {showCreateForm ? 'キャンセル' : '+ 新規試験作成'}
        </button>
      </div>

      {showCreateForm && (
        <CreateExamForm
          onCreated={() => {
            setShowCreateForm(false);
            loadExams();
          }}
        />
      )}

      {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}
      {loading ? (
        <SkeletonRows />
      ) : exams.length === 0 ? (
        <EmptyState
          message="まだ試験が登録されていません。"
          action={
            <button
              onClick={() => setShowCreateForm(true)}
              className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
            >
              + 新規試験作成
            </button>
          }
        />
      ) : (
        <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
          {exams.map((exam) => (
            <li key={exam.id} className="flex items-center gap-2 px-4 py-3 hover:bg-mp-surface-hover">
              <Link
                to={`/teacher/exams/${exam.id}`}
                className="flex flex-1 items-center justify-between gap-2"
              >
                <div>
                  <p className="font-bold">{exam.title}</p>
                  <p className="text-sm text-mp-muted">
                    問題数: {exam.taskCount} ・{' '}
                    {exam.mode === 'PRACTICE' ? '演習（時間制限なし）' : `制限時間: ${exam.timeLimitMinutes}分`}
                    {exam.courseName && ` ・ クラス: ${exam.courseName}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {exam.mode === 'PRACTICE' && (
                    <span className="rounded border border-mp-cyan/50 px-2 py-1 text-xs font-bold text-mp-cyan">
                      演習
                    </span>
                  )}
                  <span
                    className={
                      exam.status === 'PUBLISHED'
                        ? 'rounded bg-mp-green px-2 py-1 text-xs font-bold text-mp-btn-fg'
                        : 'rounded border border-mp-border bg-mp-surface-hover px-2 py-1 text-xs text-mp-muted'
                    }
                  >
                    {STATUS_LABEL[exam.status]}
                  </span>
                </div>
              </Link>
              <button
                onClick={() => handleDuplicate(exam.id)}
                disabled={duplicatingId === exam.id}
                className="shrink-0 rounded border border-mp-border bg-mp-surface px-2 py-1 text-xs font-bold hover:bg-mp-surface-hover disabled:opacity-50"
              >
                {duplicatingId === exam.id ? '複製中...' : '複製'}
              </button>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

function CreateExamForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<ExamMode>('EXAM');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(60);
  const [unlimitedAttempts, setUnlimitedAttempts] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [courseId, setCourseId] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('C');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCourses()
      .then(({ courses }) => setCourses(courses))
      .catch(() => setCourses([]));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createExam({
        title,
        description: description || null,
        mode,
        timeLimitMinutes: mode === 'PRACTICE' ? null : timeLimitMinutes,
        maxAttempts: mode === 'PRACTICE' ? null : unlimitedAttempts ? null : maxAttempts,
        opensAt: mode === 'PRACTICE' ? null : datetimeLocalToIso(opensAt),
        closesAt: mode === 'PRACTICE' ? null : datetimeLocalToIso(closesAt),
        courseId: courseId || null,
        defaultLanguage,
      });
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
      <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-title">
        タイトル
      </label>
      <input
        id="exam-title"
        className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-description">
        説明（任意）
      </label>
      <textarea
        id="exam-description"
        className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="mb-1 flex items-center text-sm text-mp-muted" htmlFor="exam-mode">
        モード
        <HelpPopover text={EXAM_MODE_HELP_TEXT} />
      </label>
      <select
        id="exam-mode"
        className="mb-3 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        value={mode}
        onChange={(e) => setMode(e.target.value as ExamMode)}
      >
        <option value="EXAM">試験（時間制限あり）</option>
        <option value="PRACTICE">演習（時間制限なし・何度でも挑戦可）</option>
      </select>

      {mode === 'EXAM' && (
        <>
          <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-time-limit">
            制限時間（分）
          </label>
          <input
            id="exam-time-limit"
            type="number"
            min={1}
            className="mb-3 w-32 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
            value={timeLimitMinutes}
            onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
            required
          />

          <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-max-attempts">
            受験可能回数
          </label>
          <div className="mb-3 flex items-center gap-3">
            <input
              id="exam-max-attempts"
              type="number"
              min={1}
              disabled={unlimitedAttempts}
              className="w-24 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg disabled:opacity-50"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))}
            />
            <label className="flex items-center gap-1.5 text-sm text-mp-muted">
              <input
                type="checkbox"
                checked={unlimitedAttempts}
                onChange={(e) => setUnlimitedAttempts(e.target.checked)}
              />
              無制限
            </label>
          </div>
          <p className="mb-3 text-xs text-mp-muted">
            複数回受験できる場合、最後に提出した回の点数が成績になります。
          </p>
        </>
      )}

      <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-default-language">
        既定の解答言語
      </label>
      <select
        id="exam-default-language"
        className="mb-1 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        value={defaultLanguage}
        onChange={(e) => setDefaultLanguage(e.target.value as Language)}
      >
        {ALL_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_LABEL[lang]}
          </option>
        ))}
      </select>
      <p className="mb-3 text-xs text-mp-muted">
        新しく追加する問題の初期値として使われます（問題ごとに個別に変更できます）。
      </p>

      <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-course">
        クラス（任意）
      </label>
      <select
        id="exam-course"
        className="mb-3 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
      >
        <option value="">（クラスなし・全生徒に公開）</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.term ? `（${c.term}）` : ''}
          </option>
        ))}
      </select>

      {mode === 'EXAM' && (
        <div className="mb-3 flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-opens-at">
              公開開始日時（任意）
            </label>
            <input
              id="exam-opens-at"
              type="datetime-local"
              className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="exam-closes-at">
              受付終了日時（任意）
            </label>
            <input
              id="exam-closes-at"
              type="datetime-local"
              className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </div>
        </div>
      )}

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
