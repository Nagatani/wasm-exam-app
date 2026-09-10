import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteExam, getExam, updateExam } from '../api/exams';
import { createTask } from '../api/tasks';
import { ApiError } from '../api/client';
import type { ExamDetail, ExamStatus } from '../types/exam';
import { BackHeader } from '../components/BackHeader';
import { PageSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';

// The exam fields the metadata form persists — used to detect unsaved edits.
function examFormKey(e: ExamDetail): string {
  return JSON.stringify({
    title: e.title,
    description: e.description,
    timeLimitMinutes: e.timeLimitMinutes,
    maxAttempts: e.maxAttempts,
    status: e.status,
  });
}

export function ExamDetailPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedSnapshotRef = useRef('');

  async function load() {
    if (!examId) return;
    setLoading(true);
    try {
      const { exam } = await getExam(examId);
      setExam(exam);
      savedSnapshotRef.current = examFormKey(exam);
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
        maxAttempts: exam.maxAttempts,
        status: exam.status,
      });
      setExam((prev) => {
        const next = prev ? { ...prev, ...updated } : prev;
        if (next) savedSnapshotRef.current = examFormKey(next);
        return next;
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
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

  const dirty = exam ? examFormKey(exam) !== savedSnapshotRef.current : false;
  useUnsavedGuard(dirty);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <BackHeader to="/teacher" label="試験一覧に戻る" />

      <form
        onSubmit={handleSave}
        className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-4"
      >
        <label className="mb-1 block text-sm text-mp-muted" htmlFor="title">
          タイトル
        </label>
        <input
          id="title"
          className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
          value={exam.title}
          onChange={(e) => setExam({ ...exam, title: e.target.value })}
          required
        />

        <label className="mb-1 block text-sm text-mp-muted" htmlFor="description">
          説明
        </label>
        <textarea
          id="description"
          rows={2}
          className="mb-3 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
          value={exam.description ?? ''}
          onChange={(e) => setExam({ ...exam, description: e.target.value })}
        />

        <div className="mb-3 flex gap-4">
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="time-limit">
              制限時間（分）
            </label>
            <input
              id="time-limit"
              type="number"
              min={1}
              className="w-32 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
              value={exam.timeLimitMinutes}
              onChange={(e) => setExam({ ...exam, timeLimitMinutes: Number(e.target.value) })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="max-attempts">
              受験可能回数
            </label>
            <div className="flex items-center gap-2">
              <input
                id="max-attempts"
                type="number"
                min={1}
                disabled={exam.maxAttempts === null}
                className="w-20 rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg disabled:opacity-50"
                value={exam.maxAttempts ?? 1}
                onChange={(e) =>
                  setExam({ ...exam, maxAttempts: Math.max(1, Number(e.target.value)) })
                }
              />
              <label className="flex items-center gap-1 text-sm text-mp-muted">
                <input
                  type="checkbox"
                  checked={exam.maxAttempts === null}
                  onChange={(e) =>
                    setExam({ ...exam, maxAttempts: e.target.checked ? null : 1 })
                  }
                />
                無制限
              </label>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="status">
              公開ステータス
            </label>
            <select
              id="status"
              className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
              value={exam.status}
              onChange={(e) => setExam({ ...exam, status: e.target.value as ExamStatus })}
            >
              <option value="DRAFT">非公開</option>
              <option value="PUBLISHED">公開中</option>
            </select>
          </div>
        </div>
        <p className="mb-3 text-xs text-mp-muted">
          複数回受験できる場合、最後に提出した回の点数が成績になります。各回とも制限時間は受験開始からのカウントダウンです。
        </p>

        {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-mp-red px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90"
          >
            試験を削除
          </button>
          {dirty ? (
            <span className="text-xs font-bold text-mp-orange">● 未保存の変更があります</span>
          ) : savedFlash ? (
            <span className="text-xs font-bold text-mp-green">保存しました</span>
          ) : null}
        </div>
      </form>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">問題一覧</h2>
        <div className="flex gap-2">
          <Link
            to={`/teacher/exams/${exam.id}/results`}
            className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover"
          >
            成績を見る
          </Link>
          <button
            onClick={handleAddTask}
            className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
          >
            + 問題を追加
          </button>
        </div>
      </div>

      {exam.tasks.length === 0 ? (
        <EmptyState
          message="まだ問題が登録されていません。"
          action={
            <button
              onClick={handleAddTask}
              className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
            >
              + 問題を追加
            </button>
          }
        />
      ) : (
        <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
          {exam.tasks.map((task) => (
            <li key={task.id}>
              <Link
                to={`/teacher/exams/${exam.id}/tasks/${task.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-mp-surface-hover"
              >
                <span>
                  {task.order + 1}. {task.title}
                </span>
                <span className="text-sm text-mp-muted">{task.points}点</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
