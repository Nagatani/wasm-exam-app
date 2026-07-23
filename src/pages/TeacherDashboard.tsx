import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logOut } from '../api/auth';
import { ThemeToggle } from '../components/ThemeToggle';
import { createExam, listExams } from '../api/exams';
import { ApiError } from '../api/client';
import type { ExamSummary, ExamStatus } from '../types/exam';

const STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: '非公開',
  PUBLISHED: '公開中',
};

export function TeacherDashboard() {
  const { profile, refresh } = useAuth();
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

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

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-mp-cyan">講師管理画面</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/teacher/sandbox"
            className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
          >
            サンドボックス動作確認
          </Link>
          <button
            onClick={() => logOut().then(refresh)}
            className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
          >
            ログアウト
          </button>
        </div>
      </header>

      <p className="mb-4 text-mp-muted">ようこそ、{profile?.studentNumber} さん。</p>

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
        <p className="text-mp-muted">読み込み中...</p>
      ) : exams.length === 0 ? (
        <p className="text-mp-muted">まだ試験が登録されていません。</p>
      ) : (
        <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
          {exams.map((exam) => (
            <li key={exam.id}>
              <Link
                to={`/teacher/exams/${exam.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-mp-surface-hover"
              >
                <div>
                  <p className="font-bold">{exam.title}</p>
                  <p className="text-sm text-mp-muted">
                    問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分
                  </p>
                </div>
                <span
                  className={
                    exam.status === 'PUBLISHED'
                      ? 'rounded bg-mp-green px-2 py-1 text-xs font-bold text-mp-btn-fg'
                      : 'rounded border border-mp-border bg-mp-surface-hover px-2 py-1 text-xs text-mp-muted'
                  }
                >
                  {STATUS_LABEL[exam.status]}
                </span>
              </Link>
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
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createExam({ title, description: description || null, timeLimitMinutes });
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
