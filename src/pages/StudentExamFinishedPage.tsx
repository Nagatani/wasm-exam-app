import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getStudentExamResult,
  getSubmitPayload,
  startAttempt,
  submitExam,
} from '../api/student';
import { ApiError } from '../api/client';
import { runClientSide } from '../runner/clientRunner';
import type {
  ExamResultPerTask,
  StudentExamResult,
  SubmitPayload,
  SubmitTaskResult,
} from '../types/student';
import { UserDrawer } from '../components/UserDrawer';
import { PageSkeleton } from '../components/Skeleton';
import { statusGlyph } from '../lib/status';

type Mode = 'loading' | 'review' | 'result';

const STATUS_COLOR: Record<'AC' | 'WA' | 'CE' | 'TLE' | 'MLE', string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  CE: 'text-mp-yellow',
  TLE: 'text-mp-orange',
  MLE: 'text-mp-orange',
};

export function StudentExamFinishedPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('loading');
  const [payload, setPayload] = useState<SubmitPayload | null>(null);
  const [result, setResult] = useState<StudentExamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [retaking, setRetaking] = useState(false);
  const autoSubmittedRef = useRef(false);

  const loadResult = useCallback(async () => {
    if (!examId) return;
    const data = await getStudentExamResult(examId);
    setResult(data);
    setMode('result');
  }, [examId]);

  const handleSubmit = useCallback(
    async (auto: boolean) => {
      if (!examId || !payload || submitting) return;
      if (!auto) {
        const undrafted = payload.tasks.filter((t) => !t.hasDraft);
        if (
          undrafted.length > 0 &&
          !window.confirm(
            `${undrafted.length} 問が下書き未保存です。未提出（0点）として提出します。よろしいですか？`,
          )
        ) {
          return;
        }
        if (!window.confirm('この内容で最終提出します。提出後は再提出できません。よろしいですか？')) {
          return;
        }
      }
      setSubmitting(true);
      setError(null);
      try {
        const clientResults: SubmitTaskResult[] = [];
        for (const t of payload.tasks) {
          if (t.serverExec || !t.hasDraft || t.draftCode == null) continue;
          setStatusText(`「${t.title}」を採点中...`);
          const { compileFailed, outcomes } = await runClientSide(
            t.language,
            t.draftCode,
            t.testCases,
            () => {},
          );
          clientResults.push({ taskId: t.id, compileFailed, outcomes });
        }
        setStatusText('提出しています...');
        await submitExam(examId, clientResults);
        await loadResult();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '提出に失敗しました。',
        );
      } finally {
        setSubmitting(false);
        setStatusText('');
      }
    },
    [examId, payload, submitting, loadResult],
  );

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    getSubmitPayload(examId)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        setMode('review');
      })
      .catch(async (err) => {
        if (cancelled) return;
        // 404 = no attempt in progress; 409 = the deadline passed and the
        // server just auto-finalized it. Either way, show the result.
        if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
          try {
            await loadResult();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : '結果の取得に失敗しました。');
          }
          return;
        }
        setError(err instanceof ApiError ? err.message : '結果の取得に失敗しました。');
      });
    return () => {
      cancelled = true;
    };
  }, [examId, loadResult]);

  // Auto-submit once when the review page loads past the deadline.
  useEffect(() => {
    if (mode !== 'review' || !payload || autoSubmittedRef.current) return;
    if (Date.now() >= new Date(payload.attempt.deadline).getTime()) {
      autoSubmittedRef.current = true;
      void handleSubmit(true);
    }
  }, [mode, payload, handleSubmit]);

  async function handleRetake(firstTaskId: string | undefined) {
    if (!examId) return;
    setRetaking(true);
    setError(null);
    try {
      await startAttempt(examId);
      navigate(
        firstTaskId
          ? `/student/exams/${examId}/tasks/${firstTaskId}`
          : `/student/exams/${examId}/finished`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '受験の開始に失敗しました。');
      setRetaking(false);
    }
  }

  if (mode === 'loading') {
    return <PageSkeleton />;
  }

  // ---- review (confirm + final submit) ----
  if (mode === 'review' && payload) {
    const pastDeadline = Date.now() >= new Date(payload.attempt.deadline).getTime();
    return (
      <div className="flex min-h-screen items-center justify-center bg-mp-bg p-6 text-mp-fg">
        <div className="w-full max-w-lg rounded-lg border border-mp-border bg-mp-surface p-6">
          <div className="mb-1 flex items-center justify-between">
            <h1 className="text-xl font-bold text-mp-cyan">提出前の確認</h1>
            <UserDrawer />
          </div>
          <p className="mb-4 text-center text-mp-muted">
            {payload.exam.title}（{payload.attempt.attemptNumber} 回目）
          </p>

          {pastDeadline && (
            <p className="mb-3 rounded bg-mp-red px-3 py-2 text-center text-sm font-bold text-mp-btn-fg">
              制限時間が終了しました。現在の下書きを自動提出します。
            </p>
          )}

          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="border-b border-mp-border text-left text-mp-muted">
                <th className="py-2">問題</th>
                <th className="py-2">配点</th>
                <th className="py-2 text-right">下書き</th>
              </tr>
            </thead>
            <tbody>
              {payload.tasks.map((t) => (
                <tr key={t.id} className="border-b border-mp-border/50">
                  <td className="py-2">
                    {t.order + 1}. {t.title}
                  </td>
                  <td className="py-2">{t.points}</td>
                  <td
                    className={`py-2 text-right font-bold ${
                      t.hasDraft ? 'text-mp-green' : 'text-mp-muted'
                    }`}
                  >
                    {t.hasDraft ? '保存済み' : '未保存'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mb-4 text-xs text-mp-muted">
            「最終提出する」を押すと、下書きが採点され成績が確定します。提出後の修正・再提出はできません。下書きのない問題は未提出（0点）扱いになります。
          </p>

          {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}
          {submitting && <p className="mb-3 text-sm text-mp-cyan">{statusText || '処理中...'}</p>}

          <div className="flex gap-2">
            {!pastDeadline && (
              <button
                onClick={() => navigate(-1)}
                disabled={submitting}
                className="flex-1 rounded border border-mp-border bg-mp-surface px-4 py-2 font-bold hover:bg-mp-surface-hover disabled:opacity-50"
              >
                受験に戻る
              </button>
            )}
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="flex-1 rounded bg-mp-purple px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '提出中...' : '最終提出する'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- result ----
  if (mode === 'result' && result) {
    const { exam, attempt, perTask, canRetake } = result;
    const perTaskById = new Map<string, ExamResultPerTask>(perTask.map((p) => [p.taskId, p]));
    const firstTaskId = exam.tasks[0]?.id;

    return (
      <div className="flex min-h-screen items-center justify-center bg-mp-bg p-6 text-mp-fg">
        <div className="w-full max-w-lg rounded-lg border border-mp-border bg-mp-surface p-6">
          <div className="mb-1 flex items-center justify-between">
            <h1 className="text-xl font-bold text-mp-cyan">
              {attempt ? '🎉 提出完了' : '未受験'}
            </h1>
            <UserDrawer />
          </div>
          <p className="mb-6 text-center text-mp-muted">
            {exam.title}
            {attempt ? `（${attempt.attemptNumber} 回目の結果）` : ''}
          </p>

          {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}

          {attempt ? (
            <>
              <table className="mb-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-mp-border text-left text-mp-muted">
                    <th className="py-2">問題</th>
                    <th className="py-2">結果</th>
                    <th className="py-2 text-right">得点</th>
                  </tr>
                </thead>
                <tbody>
                  {exam.tasks.map((task) => {
                    const cell = perTaskById.get(task.id);
                    return (
                      <tr key={task.id} className="border-b border-mp-border/50">
                        <td className="py-2">
                          {task.order + 1}. {task.title}
                        </td>
                        <td
                          className={`py-2 font-bold ${
                            cell?.status ? STATUS_COLOR[cell.status] : 'text-mp-muted'
                          }`}
                        >
                          {cell?.status
                            ? `${statusGlyph(cell.status)} ${cell.status}`
                            : '未提出'}
                        </td>
                        <td className="py-2 text-right">
                          {cell?.score ?? 0} / {task.points}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <p className="mb-6 text-right text-lg font-bold">
                合計: {attempt.score} / {exam.totalPoints} 点
              </p>
            </>
          ) : (
            <p className="mb-6 text-center text-mp-muted">この試験はまだ受験していません。</p>
          )}

          <div className="flex flex-col gap-2">
            {canRetake && (
              <button
                onClick={() => handleRetake(firstTaskId)}
                disabled={retaking}
                className="rounded bg-mp-cyan px-4 py-2 text-center font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {retaking ? '準備中...' : attempt ? 'もう一度受験する' : '受験する'}
              </button>
            )}
            <button
              onClick={() => navigate('/student')}
              className="rounded border border-mp-border bg-mp-surface px-4 py-2 text-center font-bold hover:bg-mp-surface-hover"
            >
              試験一覧に戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
      {error ?? '結果の取得に失敗しました。'}
    </div>
  );
}
