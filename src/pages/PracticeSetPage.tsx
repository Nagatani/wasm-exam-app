import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPracticeExam } from '../api/practice';
import { ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { PageSkeleton } from '../components/Skeleton';
import { LANGUAGE_LABEL } from '../lib/language';
import type { PracticeExamDetail } from '../types/practice';

// Read-only task list for one practice set (Exam, mode: PRACTICE) — the
// practice-mode counterpart to picking a task inside an exam. No attempt to
// start: every task is directly enterable, any number of times.
export function PracticeSetPage() {
  const { examId } = useParams<{ examId: string }>();
  const [exam, setExam] = useState<PracticeExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId) return;
    setLoading(true);
    getPracticeExam(examId)
      .then(({ exam }) => setExam(exam))
      .catch((err) => setError(err instanceof ApiError ? err.message : '演習セットの取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [examId]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '演習セットが見つかりません。'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <AppHeader
        title={exam.title}
        actions={
          <Link
            to="/student"
            className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
          >
            ダッシュボードに戻る
          </Link>
        }
      />
      {exam.description && <p className="mb-4 text-mp-muted">{exam.description}</p>}
      <p className="mb-4 text-sm text-mp-muted">
        時間制限はありません。何度でも実行・提出できます。合計 {exam.totalPoints}点 ・ 問題数{' '}
        {exam.tasks.length}
      </p>

      <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
        {exam.tasks.map((task) => (
          <li key={task.id}>
            <Link
              to={`/student/practice/exams/${exam.id}/tasks/${task.id}`}
              className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-mp-surface-hover"
            >
              <span>
                {task.order + 1}. {task.title}
              </span>
              <span className="text-sm text-mp-muted">
                {LANGUAGE_LABEL[task.language]} ・ {task.points}点
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
