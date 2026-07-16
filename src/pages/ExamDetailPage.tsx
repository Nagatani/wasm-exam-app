import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteExam, getExam, updateExam } from '../api/exams';
import { createTask } from '../api/tasks';
import { ApiError } from '../api/client';
import type { ExamDetail, ExamStatus } from '../types/exam';

export function ExamDetailPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!examId) return;
    setLoading(true);
    try {
      const { exam } = await getExam(examId);
      setExam(exam);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!exam) return;
    setSaving(true);
    setError(null);
    try {
      const { exam: updated } = await updateExam(exam.id, {
        title: exam.title,
        description: exam.description,
        timeLimitMinutes: exam.timeLimitMinutes,
        status: exam.status,
      });
      setExam((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!exam) return;
    if (!confirm(`「${exam.title}」を削除します。よろしいですか？`)) return;
    await deleteExam(exam.id);
    navigate('/teacher');
  }

  async function handleAddTask() {
    if (!exam) return;
    const nextOrder = exam.tasks.length;
    const { task } = await createTask(exam.id, {
      order: nextOrder,
      title: `問題${nextOrder + 1}`,
    });
    navigate(`/teacher/exams/${exam.id}/tasks/${task.id}`);
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-900 p-6 text-gray-400">読み込み中...</div>;
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 text-red-400">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <Link to="/teacher" className="mb-4 inline-block text-sm text-teal-400 hover:underline">
        ← 試験一覧に戻る
      </Link>

      <form
        onSubmit={handleSave}
        className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4"
      >
        <label className="mb-1 block text-sm text-gray-400" htmlFor="title">
          タイトル
        </label>
        <input
          id="title"
          className="mb-3 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
          value={exam.title}
          onChange={(e) => setExam({ ...exam, title: e.target.value })}
          required
        />

        <label className="mb-1 block text-sm text-gray-400" htmlFor="description">
          説明
        </label>
        <textarea
          id="description"
          rows={2}
          className="mb-3 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
          value={exam.description ?? ''}
          onChange={(e) => setExam({ ...exam, description: e.target.value })}
        />

        <div className="mb-3 flex gap-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400" htmlFor="time-limit">
              制限時間（分）
            </label>
            <input
              id="time-limit"
              type="number"
              min={1}
              className="w-32 rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
              value={exam.timeLimitMinutes}
              onChange={(e) => setExam({ ...exam, timeLimitMinutes: Number(e.target.value) })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-400" htmlFor="status">
              公開ステータス
            </label>
            <select
              id="status"
              className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
              value={exam.status}
              onChange={(e) => setExam({ ...exam, status: e.target.value as ExamStatus })}
            >
              <option value="DRAFT">非公開</option>
              <option value="PUBLISHED">公開中</option>
            </select>
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-teal-500 px-4 py-2 font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-red-900 px-4 py-2 font-bold text-red-300 hover:bg-red-800"
          >
            試験を削除
          </button>
        </div>
      </form>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">問題一覧</h2>
        <button
          onClick={handleAddTask}
          className="rounded bg-teal-500 px-3 py-1.5 text-sm font-bold text-gray-900 hover:bg-teal-600"
        >
          + 問題を追加
        </button>
      </div>

      {exam.tasks.length === 0 ? (
        <p className="text-gray-400">まだ問題が登録されていません。</p>
      ) : (
        <ul className="divide-y divide-gray-700 rounded-lg border border-gray-700 bg-gray-800">
          {exam.tasks.map((task) => (
            <li key={task.id}>
              <Link
                to={`/teacher/exams/${exam.id}/tasks/${task.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-750"
              >
                <span>
                  {task.order + 1}. {task.title}
                </span>
                <span className="text-sm text-gray-400">{task.points}点</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
