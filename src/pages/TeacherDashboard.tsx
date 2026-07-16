import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logOut } from '../api/auth';
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
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-teal-400">講師管理画面</h1>
        <button
          onClick={() => logOut().then(refresh)}
          className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
        >
          ログアウト
        </button>
      </header>

      <p className="mb-4 text-gray-400">ようこそ、{profile?.studentNumber} さん。</p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">試験一覧</h2>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-teal-500 px-3 py-1.5 text-sm font-bold text-gray-900 hover:bg-teal-600"
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

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-gray-400">読み込み中...</p>
      ) : exams.length === 0 ? (
        <p className="text-gray-400">まだ試験が登録されていません。</p>
      ) : (
        <ul className="divide-y divide-gray-700 rounded-lg border border-gray-700 bg-gray-800">
          {exams.map((exam) => (
            <li key={exam.id}>
              <Link
                to={`/teacher/exams/${exam.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-750"
              >
                <div>
                  <p className="font-bold">{exam.title}</p>
                  <p className="text-sm text-gray-400">
                    問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分
                  </p>
                </div>
                <span
                  className={
                    exam.status === 'PUBLISHED'
                      ? 'rounded bg-green-900 px-2 py-1 text-xs text-green-300'
                      : 'rounded bg-gray-700 px-2 py-1 text-xs text-gray-300'
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
      className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4"
    >
      <label className="mb-1 block text-sm text-gray-400" htmlFor="exam-title">
        タイトル
      </label>
      <input
        id="exam-title"
        className="mb-3 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <label className="mb-1 block text-sm text-gray-400" htmlFor="exam-description">
        説明（任意）
      </label>
      <textarea
        id="exam-description"
        className="mb-3 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="mb-1 block text-sm text-gray-400" htmlFor="exam-time-limit">
        制限時間（分）
      </label>
      <input
        id="exam-time-limit"
        type="number"
        min={1}
        className="mb-3 w-32 rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
        value={timeLimitMinutes}
        onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
        required
      />

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-teal-500 px-4 py-2 font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
      >
        {submitting ? '作成中...' : '作成する'}
      </button>
    </form>
  );
}
