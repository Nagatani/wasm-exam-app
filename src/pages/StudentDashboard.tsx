import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { getStudentExam, listStudentExams, startAttempt } from '../api/student';
import { prewarmCRunner } from '../runner/cRunner';
import { ApiError } from '../api/client';
import type { StudentExamSummary } from '../types/student';

function attemptLimitLabel(exam: StudentExamSummary): string {
  if (exam.maxAttempts === null) return '受験回数: 無制限';
  return `受験回数: ${exam.attemptsUsed}/${exam.maxAttempts}`;
}

export function StudentDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listStudentExams()
      .then(({ exams }) => setExams(exams))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '試験一覧の取得に失敗しました。'),
      )
      .finally(() => setLoading(false));
    // Begin fetching the ~100MB C toolchain now so it's likely cached by the
    // time the student actually opens a task and hits "実行".
    prewarmCRunner();
  }, []);

  async function enterFirstTask(examId: string) {
    const state = await getStudentExam(examId);
    if (state.exam.tasks.length === 0) {
      setError('この試験にはまだ問題が登録されていません。');
      return;
    }
    const drafted = state.attempt?.draftedTaskIds ?? [];
    const next = state.exam.tasks.find((t) => !drafted.includes(t.id)) ?? state.exam.tasks[0];
    navigate(`/student/exams/${examId}/tasks/${next.id}`);
  }

  async function handleResume(examId: string) {
    setBusyId(examId);
    setError(null);
    try {
      await enterFirstTask(examId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の再開に失敗しました。');
    } finally {
      setBusyId(null);
    }
  }

  async function handleStartNew(examId: string) {
    setBusyId(examId);
    setError(null);
    try {
      await startAttempt(examId);
      await enterFirstTask(examId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の開始に失敗しました。');
    } finally {
      setBusyId(null);
    }
  }

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
        <ul className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface">
          {exams.map((exam) => {
            const busy = busyId === exam.id;
            return (
              <li
                key={exam.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-bold">
                    {exam.title}
                    {exam.hasInProgress && (
                      <span className="ml-2 rounded bg-mp-cyan px-1.5 py-0.5 text-xs font-bold text-mp-btn-fg">
                        受験中
                      </span>
                    )}
                  </p>
                  {exam.description && <p className="text-sm text-mp-muted">{exam.description}</p>}
                  <p className="text-sm text-mp-muted">
                    問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分 ・{' '}
                    {attemptLimitLabel(exam)}
                    {exam.latestScore !== null &&
                      ` ・ 前回: ${exam.latestScore}/${exam.totalPoints}点`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {exam.attemptsUsed > 0 && (
                    <button
                      onClick={() => navigate(`/student/exams/${exam.id}/finished`)}
                      className="rounded border border-mp-border bg-mp-surface px-4 py-2 font-bold hover:bg-mp-surface-hover"
                    >
                      結果を見る
                    </button>
                  )}
                  {exam.hasInProgress ? (
                    <button
                      onClick={() => handleResume(exam.id)}
                      disabled={busy}
                      className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? '読み込み中...' : '受験を再開する'}
                    </button>
                  ) : exam.canStart ? (
                    <button
                      onClick={() => handleStartNew(exam.id)}
                      disabled={busy}
                      className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                    >
                      {busy
                        ? '読み込み中...'
                        : exam.attemptsUsed > 0
                          ? 'もう一度受験する'
                          : '受験する'}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
