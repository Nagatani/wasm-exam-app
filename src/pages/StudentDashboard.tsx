import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { getStudentExam, listStudentExams, startAttempt } from '../api/student';
import {
  getRuntimeReadiness,
  prewarmAllClientRunners,
  type RunnerReadiness,
} from '../runner/clientRunner';
import { ApiError } from '../api/client';
import type { StudentExamSummary } from '../types/student';

const READINESS_LABEL: Record<RunnerReadiness, string> = {
  idle: '未取得',
  loading: '準備中...',
  ready: '準備完了',
  error: '取得に失敗',
};

function RuntimeReadinessCard() {
  const [ready, setReady] = useState(getRuntimeReadiness());

  useEffect(() => {
    const id = setInterval(() => setReady(getRuntimeReadiness()), 1500);
    return () => clearInterval(id);
  }, []);

  const row = (label: string, state: RunnerReadiness) => (
    <span className="flex items-center gap-1">
      <span
        className={
          state === 'ready'
            ? 'text-mp-green'
            : state === 'error'
              ? 'text-mp-red'
              : state === 'loading'
                ? 'text-mp-cyan'
                : 'text-mp-muted'
        }
      >
        {state === 'ready' ? '✓' : state === 'loading' ? '…' : state === 'error' ? '✗' : '·'}
      </span>
      {label}: {READINESS_LABEL[state]}
    </span>
  );

  return (
    <div className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-bold text-mp-muted">実行環境の準備状況</span>
        {row('C（コンパイラ ~106MB）', ready.c)}
        {row('Python（~10MB）', ready.python)}
        <button
          onClick={() => {
            prewarmAllClientRunners();
            setReady(getRuntimeReadiness());
          }}
          className="rounded border border-mp-border bg-mp-bg px-2 py-0.5 text-xs font-bold hover:bg-mp-surface-hover"
        >
          今すぐ準備する
        </button>
      </div>
      <p className="text-xs text-mp-muted">
        C / Python の問題は初回にランタイムのダウンロードが必要です（以降はブラウザにキャッシュ）。
        受験前にこの表示が「準備完了」になっていると、最初の「実行」で待たされません。
        JavaScript / TypeScript / Java は準備不要です。
      </p>
    </div>
  );
}

function attemptLimitLabel(exam: StudentExamSummary): string {
  if (exam.maxAttempts === null) return '受験回数: 無制限';
  return `受験回数: ${exam.attemptsUsed}/${exam.maxAttempts}`;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ja-JP') : '';
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
    // Begin fetching the heavy client runtimes (clang ~106MB, Pyodide ~10MB)
    // now so they're likely ready by the time the student opens a task.
    prewarmAllClientRunners();
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

      <RuntimeReadinessCard />

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
                  {exam.notYetOpen && (
                    <p className="text-sm font-bold text-mp-orange">
                      公開開始: {fmt(exam.opensAt)}
                    </p>
                  )}
                  {!exam.notYetOpen && exam.closed && (
                    <p className="text-sm font-bold text-mp-red">
                      受付終了（{fmt(exam.closesAt)}）
                    </p>
                  )}
                  {!exam.notYetOpen && !exam.closed && exam.closesAt && (
                    <p className="text-sm text-mp-muted">受付終了: {fmt(exam.closesAt)}</p>
                  )}
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
