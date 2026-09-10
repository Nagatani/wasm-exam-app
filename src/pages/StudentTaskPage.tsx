import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { CodeEditor } from '../components/CodeEditor';
import { ThemeToggle } from '../components/ThemeToggle';
import { getStudentExam, getStudentTask, runTask, saveTaskDraft } from '../api/student';
import { prewarmClientRunner, runClientSide } from '../runner/clientRunner';
import { statusGlyph } from '../lib/status';
import {
  isServerExec,
  LANGUAGE_FILENAME,
  LANGUAGE_LABEL,
  MONACO_LANGUAGE,
  RUNNABLE_LANGUAGES,
} from '../lib/language';
import { PageSkeleton } from '../components/Skeleton';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { ApiError } from '../api/client';
import type { JudgeOutcome, JudgeVerdict } from '../types/student';
import type { StudentTask, StudentTaskSummary } from '../types/student';

const STATUS_LABEL: Record<JudgeVerdict['overallStatus'], string> = {
  AC: '✅ AC（全テストケース正解）',
  WA: '❌ WA（不正解）',
  CE: '⚠️ コンパイルエラー',
};

const STATUS_COLOR: Record<JudgeVerdict['overallStatus'], string> = {
  AC: 'bg-mp-green text-mp-btn-fg',
  WA: 'bg-mp-red text-mp-btn-fg',
  CE: 'bg-mp-yellow text-mp-btn-fg',
};

interface ExecutionResult {
  compileFailed: boolean;
  compileStderr: string;
  outcomes: JudgeOutcome[];
}

// Structured progress for the preview run so the UI can show a real bar
// instead of a single status string. 'compiling' is indeterminate (the first
// C compile may pull a ~100MB toolchain); 'running' is proportional; 'server'
// is the indeterminate wait while the judge container runs a Java preview.
type RunProgress =
  | { phase: 'compiling' }
  | { phase: 'running'; current: number; total: number }
  | { phase: 'server' }
  | null;

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function StudentTaskPage() {
  const { examId, taskId } = useParams<{ examId: string; taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<StudentTask | null>(null);
  const [examTasks, setExamTasks] = useState<StudentTaskSummary[]>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // No in-progress attempt for this exam → the student shouldn't be on this
  // page. Redirect to the review/result page.
  const [noAttempt, setNoAttempt] = useState(false);

  const [running, setRunning] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedFlash, setDraftSavedFlash] = useState(false);
  const [progress, setProgress] = useState<RunProgress>(null);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [draftedTaskIds, setDraftedTaskIds] = useState<string[]>([]);

  // Ctrl/Cmd+Enter in the editor triggers a preview run. Registered once on
  // mount, so it calls through this ref to always see the latest state.
  const runActionRef = useRef<() => void>(() => {});
  const handleCmdEnter = useCallback(() => runActionRef.current(), []);
  // The last code value persisted to the server draft — used to detect unsaved
  // edits (there's a beforeunload guard and an on-navigate save).
  const savedCodeRef = useRef('');

  // Accumulated for the whole time the student spends on this task, seeded
  // from the saved draft so revisiting continues rather than resets.
  const keystrokeCountRef = useRef(0);
  const pasteCountRef = useRef(0);
  const pastedCharCountRef = useRef(0);
  const taskStartTimeRef = useRef(Date.now());
  const draftBaseTimeRef = useRef(0);

  useEffect(() => {
    if (!taskId || !examId) return;
    setLoading(true);
    setVerdict(null);
    setCompileError(null);
    setNoAttempt(false);
    Promise.all([getStudentTask(taskId), getStudentExam(examId)])
      .then(([{ task, draft }, state]) => {
        if (!state.attempt) {
          setNoAttempt(true);
          return;
        }
        setTask(task);
        const initial = draft?.code ?? task.starterCode ?? '';
        setCode(initial);
        savedCodeRef.current = initial;
        keystrokeCountRef.current = draft?.keystrokeCount ?? 0;
        pasteCountRef.current = draft?.pasteCount ?? 0;
        pastedCharCountRef.current = draft?.pastedCharCount ?? 0;
        draftBaseTimeRef.current = draft?.timeSpentSeconds ?? 0;
        taskStartTimeRef.current = Date.now();
        setExamTasks(state.exam.tasks);
        setDraftedTaskIds(state.attempt.draftedTaskIds);
        setDeadline(new Date(state.attempt.deadline).getTime());
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [taskId, examId]);

  useEffect(() => {
    if (noAttempt && examId) {
      navigate(`/student/exams/${examId}/finished`, { replace: true });
    }
  }, [noAttempt, examId, navigate]);

  // Ticks once a second so the countdown stays live; the deadline itself is
  // anchored to the server-recorded attempt start.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Start any heavy runtime download (clang for C, Pyodide for Python) as soon
  // as the page opens so it overlaps with the student reading the statement.
  useEffect(() => {
    if (task) prewarmClientRunner(task.language);
  }, [task]);

  useUnsavedGuard(code !== savedCodeRef.current);

  const timeUp = deadline !== null && now >= deadline;

  // When the clock runs out, hand off to the review page, which auto-submits
  // the current drafts (decision: auto-finalize on time-up).
  useEffect(() => {
    if (timeUp && examId && !loading && task) {
      navigate(`/student/exams/${examId}/finished`, { replace: true });
    }
  }, [timeUp, examId, loading, task, navigate]);

  function currentMetrics() {
    return {
      keystrokeCount: keystrokeCountRef.current,
      pasteCount: pasteCountRef.current,
      pastedCharCount: pastedCharCountRef.current,
      timeSpentSeconds:
        draftBaseTimeRef.current + Math.round((Date.now() - taskStartTimeRef.current) / 1000),
    };
  }

  async function executeAgainstAllTestCases(currentTask: StudentTask): Promise<ExecutionResult> {
    return runClientSide(
      currentTask.language,
      code,
      currentTask.testCases.map((tc) => ({ id: tc.id, input: tc.input })),
      setProgress,
    );
  }

  async function handleRun() {
    if (!task) return;
    setRunning(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    try {
      if (isServerExec(task.language)) {
        setProgress({ phase: 'server' });
        const { verdict, compileStderr } = await runTask(task.id, { code });
        if (verdict.overallStatus === 'CE') setCompileError(compileStderr ?? '');
        setVerdict(verdict);
        return;
      }
      const { compileFailed, compileStderr, outcomes } = await executeAgainstAllTestCases(task);
      if (compileFailed) {
        setCompileError(compileStderr);
        setVerdict({ overallStatus: 'CE', results: [], score: 0 });
        return;
      }
      const { verdict } = await runTask(task.id, { compileFailed: false, outcomes });
      setVerdict(verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : '実行に失敗しました。');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function persistDraft(): Promise<void> {
    if (!task) return;
    await saveTaskDraft(task.id, code, currentMetrics());
    savedCodeRef.current = code;
    setDraftedTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
  }

  async function handleSaveDraft() {
    if (!task) return;
    setSavingDraft(true);
    setError(null);
    try {
      await persistDraft();
      setDraftSavedFlash(true);
      setTimeout(() => setDraftSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下書きの保存に失敗しました。');
    } finally {
      setSavingDraft(false);
    }
  }

  async function goToTask(targetId: string) {
    if (!examId || targetId === task?.id) return;
    if (code !== savedCodeRef.current) {
      if (
        !window.confirm(
          'このページの編集内容はまだ下書き保存されていません。保存してから移動しますか？（キャンセルで移動を中止）',
        )
      ) {
        return;
      }
      try {
        await persistDraft();
      } catch {
        setError('下書きの保存に失敗したため移動を中止しました。');
        return;
      }
    }
    navigate(`/student/exams/${examId}/tasks/${targetId}`);
  }

  async function goToReview() {
    if (!examId) return;
    if (code !== savedCodeRef.current && task) {
      try {
        await persistDraft();
      } catch {
        setError('下書きの保存に失敗しました。もう一度お試しください。');
        return;
      }
    }
    navigate(`/student/exams/${examId}/finished`);
  }

  if (loading || noAttempt) {
    return <PageSkeleton />;
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '問題が見つかりません。'}
      </div>
    );
  }

  const sampleTestCases = task.testCases.filter((tc) => tc.isSample);
  const busy = running || savingDraft;
  const languageRunnable = RUNNABLE_LANGUAGES.includes(task.language);

  const compilingMessage =
    task.language === 'C'
      ? 'コンパイル中...（初回はコンパイラのダウンロードのため数十秒〜数分かかることがあります）'
      : task.language === 'PYTHON'
        ? 'Python 実行環境を読み込み中...（初回は数十秒かかることがあります）'
        : 'コンパイル中...';

  const remainingMs = deadline !== null ? deadline - now : null;
  const timeCritical = remainingMs !== null && !timeUp && remainingMs < 60_000;
  const timeLow = remainingMs !== null && !timeUp && !timeCritical && remainingMs < 5 * 60_000;
  const draftedCount = examTasks.filter((t) => draftedTaskIds.includes(t.id)).length;
  const dirty = code !== savedCodeRef.current;

  runActionRef.current = () => {
    if (busy || timeUp || !languageRunnable) return;
    void handleRun();
  };

  return (
    <div className="flex min-h-screen flex-col bg-mp-bg text-mp-fg">
      <header className="flex flex-col gap-2 border-b border-mp-border bg-mp-surface px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-bold text-mp-cyan">
            問題 {task.order + 1}: {task.title}（{task.points}点）
          </h1>
          <div className="flex items-center gap-3">
            {remainingMs !== null && (
              <span
                className={`rounded px-2 py-1 text-sm font-bold ${
                  timeUp || timeCritical
                    ? 'bg-mp-red text-mp-btn-fg'
                    : timeLow
                      ? 'text-mp-red'
                      : 'text-mp-muted'
                }`}
              >
                残り時間: {timeUp ? '00:00（時間切れ）' : formatRemaining(remainingMs)}
              </span>
            )}
            <button
              onClick={goToReview}
              disabled={busy}
              className="rounded bg-mp-purple px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              試験を提出する
            </button>
            <ThemeToggle />
          </div>
        </div>

        {examTasks.length > 1 && (
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="問題一覧">
            {examTasks.map((t) => {
              const isCurrent = t.id === task.id;
              const isDrafted = draftedTaskIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => goToTask(t.id)}
                  disabled={busy || isCurrent}
                  aria-current={isCurrent ? 'page' : undefined}
                  title={`問題 ${t.order + 1}: ${t.title}${isDrafted ? '（下書き保存済み）' : ''}`}
                  className={`rounded px-2 py-0.5 text-xs font-bold disabled:cursor-default ${
                    isCurrent
                      ? 'bg-mp-cyan text-mp-btn-fg'
                      : isDrafted
                        ? 'bg-mp-green/20 text-mp-green hover:bg-mp-green/30'
                        : 'border border-mp-border text-mp-muted hover:bg-mp-surface-hover'
                  }`}
                >
                  {isDrafted ? '✎ ' : ''}問題 {t.order + 1}
                </button>
              );
            })}
            <span className="ml-1 text-xs text-mp-muted">
              下書き {draftedCount}/{examTasks.length}
            </span>
          </nav>
        )}
      </header>

      {timeUp && (
        <div className="border-b border-mp-border bg-mp-red px-4 py-2 text-center text-sm font-bold text-mp-btn-fg">
          試験時間が終了しました。提出画面に移動します...
        </div>
      )}

      <main className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:flex-row">
        {/* 左カラム: 問題文 + サンプルテストケース */}
        <div className="flex w-full flex-col overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <h2 className="mb-2 text-sm font-bold text-mp-muted">問題文</h2>
          <div className="markdown-body mb-4 text-sm">
            <ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>
          </div>

          <h2 className="mb-2 text-sm font-bold text-mp-muted">サンプルテストケース</h2>
          {sampleTestCases.length === 0 ? (
            <p className="text-sm text-mp-muted">サンプルはありません。</p>
          ) : (
            <div className="space-y-3">
              {sampleTestCases.map((tc) => (
                <div key={tc.id} className="rounded bg-mp-bg p-2.5 text-xs font-mono">
                  <p>
                    <strong>入力例:</strong> {tc.input || '(なし)'}
                  </p>
                  <p>
                    <strong>期待される出力例:</strong> {tc.expectedOutput}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 中央カラム: エディタ */}
        <div className="flex w-full flex-col md:w-1/3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{LANGUAGE_LABEL[task.language]}</span>
              <span className="text-xs text-mp-muted">{LANGUAGE_FILENAME[task.language]}</span>
            </div>
            <span className="text-xs text-mp-muted">Ctrl / ⌘ + Enter で実行</span>
          </div>
          <div className="flex-1">
            <CodeEditor
              value={code}
              onChange={setCode}
              language={MONACO_LANGUAGE[task.language]}
              height={500}
              readOnly={timeUp}
              onCmdEnter={handleCmdEnter}
              onKeystroke={() => {
                keystrokeCountRef.current += 1;
              }}
              onPasteText={(charCount) => {
                pasteCountRef.current += 1;
                pastedCharCountRef.current += charCount;
              }}
            />
          </div>
        </div>

        {/* 右カラム: 実行結果 */}
        <div className="flex w-full flex-col gap-3 overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={busy || timeUp || !languageRunnable}
              className="flex-1 rounded bg-mp-cyan px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {running ? '実行中...' : '▶ コンパイル＆テスト実行'}
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={busy || timeUp}
              className="flex-1 rounded bg-mp-green px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {savingDraft ? '保存中...' : dirty ? '下書き保存' : draftSavedFlash ? '保存しました' : '下書き保存済み'}
            </button>
          </div>

          <p className="rounded border border-mp-border bg-mp-bg p-2 text-xs text-mp-muted">
            「下書き保存」で解答を一時保存できます。採点は行われません。すべての解答を確認したら、右上の「試験を提出する」から最終提出してください（提出後は再提出できません）。
          </p>

          {!languageRunnable && (
            <p className="rounded border border-mp-border bg-mp-bg p-2 text-xs text-mp-muted">
              {LANGUAGE_LABEL[task.language]}の実行環境は現在準備中です。担当教員にお問い合わせください。
            </p>
          )}

          {busy && progress && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded bg-mp-bg">
                <div
                  className={`h-full bg-mp-cyan transition-[width] duration-300 ${
                    progress.phase === 'running' ? '' : 'mp-progress-indeterminate'
                  }`}
                  style={
                    progress.phase === 'running'
                      ? { width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }
                      : undefined
                  }
                />
              </div>
              <p className="text-xs text-mp-muted">
                {progress.phase === 'compiling'
                  ? compilingMessage
                  : progress.phase === 'server'
                    ? 'サーバーでコンパイル・実行しています...'
                    : `テストケース ${progress.current}/${progress.total} を実行中...`}
              </p>
            </div>
          )}
          {error && <p className="text-sm text-mp-red">{error}</p>}

          {verdict && (
            <div
              className={`rounded border px-3 py-2 text-center font-bold ${STATUS_COLOR[verdict.overallStatus]}`}
            >
              {STATUS_LABEL[verdict.overallStatus]}
            </div>
          )}

          {verdict?.overallStatus === 'CE' && compileError && (
            <pre className="whitespace-pre-wrap rounded bg-mp-bg p-3 text-xs text-mp-red">
              {compileError}
            </pre>
          )}

          {verdict && verdict.overallStatus !== 'CE' && (
            <div className="space-y-2">
              {task.testCases.map((tc) => {
                const result = verdict.results.find((r) => r.testCaseId === tc.id);
                return (
                  <div key={tc.id} className="rounded bg-mp-bg p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">
                        テストケース {tc.order + 1}
                        {tc.isSample ? '' : '（非公開）'}
                      </span>
                      <span
                        className={
                          result?.status === 'AC'
                            ? 'text-mp-green'
                            : result?.status === 'RE'
                              ? 'text-mp-yellow'
                              : 'text-mp-red'
                        }
                      >
                        {result?.status ? `${statusGlyph(result.status)} ${result.status}` : '-'}
                      </span>
                    </div>
                    {tc.isSample && result && (
                      <div className="font-mono text-mp-muted">
                        <p>入力: {tc.input}</p>
                        <p>期待値: {tc.expectedOutput}</p>
                        <p>出力: {result.actualOutput}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
