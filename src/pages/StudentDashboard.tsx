import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { getStudentExam, listStudentExams } from '../api/student';
import { prewarmCRunner } from '../runner/cRunner';
import { ApiError } from '../api/client';
import type { StudentExamSummary } from '../types/student';

function isCompleted(exam: StudentExamSummary): boolean {
  return exam.taskCount > 0 && exam.submittedTaskCount >= exam.taskCount;
}

export function StudentDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    listStudentExams()
      .then(({ exams }) => setExams(exams))
      .catch((err) => setError(err instanceof ApiError ? err.message : '試験一覧の取得に失敗しました。'))
      .finally(() => setLoading(false));
    // Begin fetching the ~100MB C toolchain now so it's likely cached by the
    // time the student actually opens a task and hits "実行".
    prewarmCRunner();
  }, []);

  async function handleStart(examId: string) {
    setStarting(examId);
    setError(null);
    try {
      const { exam, submittedTaskIds } = await getStudentExam(examId);

      if (exam.tasks.length === 0) {
        setError('この試験にはまだ問題が登録されていません。');
        return;
      }

      const allSubmitted = exam.tasks.every((t) => submittedTaskIds.includes(t.id));
      if (allSubmitted) {
        navigate(`/student/exams/${examId}/finished`);
        return;
      }

      const nextTask =
        exam.tasks.find((t) => !submittedTaskIds.includes(t.id)) ?? exam.tasks[0];
      navigate(`/student/exams/${examId}/tasks/${nextTask.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の開始に失敗しました。');
    } finally {
      setStarting(null);
    }
  }

  const pendingExams = exams.filter((exam) => !isCompleted(exam));
  const completedExams = exams.filter(isCompleted);

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <AppHeader title="生徒ダッシュボード" />

      <p className="mb-4 text-mp-muted">ようこそ、{profile?.displayName} さん。</p>

      {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

      {loading ? (
        <SkeletonRows />
      ) : exams.length === 0 ? (
        <EmptyState message="現在受験できる試験はありません。" />
      ) : (
        <>
          <h2 className="mb-2 text-lg font-bold">未受験の試験</h2>
          {pendingExams.length === 0 ? (
            <p className="mb-6 text-sm text-mp-muted">未受験の試験はありません。</p>
          ) : (
            <ul className="mb-6 divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
              {pendingExams.map((exam) => (
                <li key={exam.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-bold">{exam.title}</p>
                    {exam.description && (
                      <p className="text-sm text-mp-muted">{exam.description}</p>
                    )}
                    <p className="text-sm text-mp-muted">
                      問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分
                      {exam.submittedTaskCount > 0 &&
                        ` ・ 提出済み: ${exam.submittedTaskCount}/${exam.taskCount}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleStart(exam.id)}
                    disabled={starting === exam.id}
                    className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {starting === exam.id
                      ? '読み込み中...'
                      : exam.submittedTaskCount > 0
                        ? '再開する'
                        : '受験する'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-2 text-lg font-bold">受験済みの試験</h2>
          {completedExams.length === 0 ? (
            <p className="text-sm text-mp-muted">受験済みの試験はありません。</p>
          ) : (
            <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
              {completedExams.map((exam) => (
                <li key={exam.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-bold">{exam.title}</p>
                    {exam.description && (
                      <p className="text-sm text-mp-muted">{exam.description}</p>
                    )}
                    <p className="text-sm text-mp-muted">
                      問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分
                    </p>
                  </div>
                  <Link
                    to={`/student/exams/${exam.id}/finished`}
                    className="rounded border border-mp-border bg-mp-surface px-4 py-2 font-bold hover:bg-mp-surface-hover"
                  >
                    結果を見る
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
