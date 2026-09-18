import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { CodeEditor } from '../components/CodeEditor';
import { UserDrawer } from '../components/UserDrawer';
import {
  getPracticeExam,
  getPracticeTask,
  getPracticeTaskSubmissions,
  runPracticeTask,
  submitPracticeTask,
} from '../api/practice';
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
import { SampleDiff } from '../components/SampleDiff';
import type { EditorMarker } from '../components/CodeEditor';
import { parseCompileErrors } from '../lib/compileErrors';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { ApiError } from '../api/client';
import type { JudgeOutcome, JudgeVerdict } from '../types/student';
import type { PracticeSubmissionSummary, PracticeTask, PracticeTaskSummary } from '../types/practice';

// Practice mode's task page — same judging UI/UX as the exam flow's
// StudentTaskPage, but with every ExamAttempt/TaskDraft/deadline concept
// removed: there's no time limit, no draft, and code lives only in this
// page's state (lost on reload — accepted for this foundation slice, see
// CLAUDE.md "演習モード"). Two actions instead of one: "実行" (ephemeral
// preview, same as the exam flow's) and "提出" (judged + recorded as a
// PracticeSubmission — unlimited history, unlike the exam flow's immutable
// per-attempt Submission).

const STATUS_LABEL: Record<JudgeVerdict['overallStatus'], string> = {
  AC: '✅ AC（全テストケース正解）',
  WA: '❌ WA（不正解）',
  CE: '⚠️ コンパイルエラー',
  TLE: '⌛ TLE（実行時間超過）',
  MLE: '⌛ MLE（メモリ超過）',
};

const STATUS_COLOR: Record<JudgeVerdict['overallStatus'], string> = {
  AC: 'bg-mp-green text-mp-btn-fg',
  WA: 'bg-mp-red text-mp-btn-fg',
  CE: 'bg-mp-yellow text-mp-btn-fg',
  TLE: 'bg-mp-orange text-mp-btn-fg',
  MLE: 'bg-mp-orange text-mp-btn-fg',
};

const STATUS_TEXT_COLOR: Record<JudgeVerdict['overallStatus'], string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  CE: 'text-mp-yellow',
  TLE: 'text-mp-orange',
  MLE: 'text-mp-orange',
};

const TESTCASE_STATUS_COLOR: Record<string, string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  RE: 'text-mp-yellow',
  TLE: 'text-mp-orange',
  MLE: 'text-mp-orange',
};

interface ExecutionResult {
  compileFailed: boolean;
  compileStderr: string;
  outcomes: JudgeOutcome[];
}

type RunProgress =
  | { phase: 'compiling' }
  | { phase: 'running'; current: number; total: number }
  | { phase: 'server' }
  | null;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP');
}

export function PracticeTaskPage() {
  const { examId, taskId } = useParams<{ examId: string; taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<PracticeTask | null>(null);
  const [examTasks, setExamTasks] = useState<PracticeTaskSummary[]>([]);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<RunProgress>(null);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileMarkers, setCompileMarkers] = useState<EditorMarker[]>([]);
  const [submissions, setSubmissions] = useState<PracticeSubmissionSummary[]>([]);
  const [lastSubmitFlash, setLastSubmitFlash] = useState(false);

  const runActionRef = useRef<() => void>(() => {});
  const handleCmdEnter = useCallback(() => runActionRef.current(), []);
  const initialCodeRef = useRef('');

  function loadSubmissions(id: string) {
    getPracticeTaskSubmissions(id)
      .then(({ submissions }) => setSubmissions(submissions))
      .catch(() => setSubmissions([]));
  }

  useEffect(() => {
    if (!taskId || !examId) return;
    setLoading(true);
    setVerdict(null);
    setCompileError(null);
    Promise.all([getPracticeTask(taskId), getPracticeExam(examId)])
      .then(([{ task }, { exam }]) => {
        setTask(task);
        const initial = task.starterCode ?? '';
        setCode(initial);
        initialCodeRef.current = initial;
        setExamTasks(exam.tasks);
        loadSubmissions(taskId);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [taskId, examId]);

  useEffect(() => {
    if (task) prewarmClientRunner(task.language);
  }, [task]);

  const dirty = code !== initialCodeRef.current;
  useUnsavedGuard(dirty);

  async function executeAgainstAllTestCases(currentTask: PracticeTask): Promise<ExecutionResult> {
    return runClientSide(
      currentTask.language,
      code,
      currentTask.testCases.map((tc) => ({ id: tc.id, input: tc.input })),
      setProgress,
    );
  }

  function showCompileError(stderr: string) {
    setCompileError(stderr);
    setCompileMarkers(task ? parseCompileErrors(task.language, stderr) : []);
  }

  async function handleRun() {
    if (!task) return;
    setRunning(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    setCompileMarkers([]);
    try {
      if (isServerExec(task.language)) {
        setProgress({ phase: 'server' });
        const { verdict, compileStderr } = await runPracticeTask(task.id, { code });
        if (verdict.overallStatus === 'CE') showCompileError(compileStderr ?? '');
        setVerdict(verdict);
        return;
      }
      const { compileFailed, compileStderr, outcomes } = await executeAgainstAllTestCases(task);
      if (compileFailed) {
        showCompileError(compileStderr);
        setVerdict({ overallStatus: 'CE', results: [], score: 0 });
        return;
      }
      const { verdict } = await runPracticeTask(task.id, { compileFailed: false, outcomes, code });
      setVerdict(verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : '実行に失敗しました。');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function handleSubmit() {
    if (!task) return;
    setSubmitting(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    setCompileMarkers([]);
    try {
      let result;
      if (isServerExec(task.language)) {
        setProgress({ phase: 'server' });
        result = await submitPracticeTask(task.id, { code });
      } else {
        const { compileFailed, compileStderr, outcomes } = await executeAgainstAllTestCases(task);
        if (compileFailed) {
          showCompileError(compileStderr);
          setVerdict({ overallStatus: 'CE', results: [], score: 0 });
          await submitPracticeTask(task.id, { compileFailed: true, outcomes: [], code });
          loadSubmissions(task.id);
          return;
        }
        result = await submitPracticeTask(task.id, { compileFailed: false, outcomes, code });
      }
      if (result.verdict.overallStatus === 'CE') showCompileError(result.compileStderr ?? '');
      setVerdict(result.verdict);
      initialCodeRef.current = code;
      setLastSubmitFlash(true);
      setTimeout(() => setLastSubmitFlash(false), 2000);
      loadSubmissions(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提出に失敗しました。');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  function goToTask(targetId: string) {
    if (!examId || targetId === task?.id) return;
    if (
      dirty &&
      !window.confirm('このページの編集内容は保存されません。移動しますか？（キャンセルで移動を中止）')
    ) {
      return;
    }
    navigate(`/student/practice/exams/${examId}/tasks/${targetId}`);
  }

  function loadSubmissionCode(s: PracticeSubmissionSummary) {
    if (dirty && !window.confirm('現在の編集内容を破棄して、この提出のコードを読み込みますか？')) {
      return;
    }
    setCode(s.code);
    initialCodeRef.current = s.code;
    setVerdict(null);
  }

  if (loading) {
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
  const busy = running || submitting;
  const languageRunnable = RUNNABLE_LANGUAGES.includes(task.language);

  const compilingMessage =
    task.language === 'C'
      ? 'コンパイル中...（初回はコンパイラのダウンロードのため数十秒〜数分かかることがあります）'
      : task.language === 'PYTHON'
        ? 'Python 実行環境を読み込み中...（初回は数十秒かかることがあります）'
        : 'コンパイル中...';

  runActionRef.current = () => {
    if (busy || !languageRunnable) return;
    void handleRun();
  };

  return (
    <div className="flex min-h-screen flex-col bg-mp-bg text-mp-fg">
      <header className="flex flex-col gap-2 border-b border-mp-border bg-mp-surface px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-bold text-mp-cyan">
            演習 {task.order + 1}: {task.title}（{task.points}点）
          </h1>
          <div className="flex items-center gap-3">
            <Link
              to={`/student/practice/exams/${examId}`}
              className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
            >
              演習セットに戻る
            </Link>
            <div className="border-l border-mp-border pl-3">
              <UserDrawer />
            </div>
          </div>
        </div>

        {examTasks.length > 1 && (
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="問題一覧">
            {examTasks.map((t) => {
              const isCurrent = t.id === task.id;
              return (
                <button
                  key={t.id}
                  onClick={() => goToTask(t.id)}
                  disabled={busy || isCurrent}
                  aria-current={isCurrent ? 'page' : undefined}
                  title={`問題 ${t.order + 1}: ${t.title}`}
                  className={`rounded px-2 py-0.5 text-xs font-bold disabled:cursor-default ${
                    isCurrent
                      ? 'bg-mp-cyan text-mp-btn-fg'
                      : 'border border-mp-border text-mp-muted hover:bg-mp-surface-hover'
                  }`}
                >
                  問題 {t.order + 1}
                </button>
              );
            })}
          </nav>
        )}
      </header>

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

          <h2 className="mb-2 mt-4 text-sm font-bold text-mp-muted">提出履歴</h2>
          {submissions.length === 0 ? (
            <p className="text-sm text-mp-muted">まだ提出していません。</p>
          ) : (
            <ul className="space-y-1">
              {submissions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => loadSubmissionCode(s)}
                    className="flex w-full items-center justify-between gap-2 rounded bg-mp-bg px-2 py-1.5 text-left text-xs hover:bg-mp-surface-hover"
                  >
                    <span className="text-mp-muted">{formatDateTime(s.submittedAt)}</span>
                    <span className={`font-bold ${STATUS_TEXT_COLOR[s.overallStatus]}`}>
                      {s.overallStatus}（{s.score}点）
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
              onChange={(v) => {
                setCode(v);
                if (compileMarkers.length > 0) setCompileMarkers([]);
              }}
              language={MONACO_LANGUAGE[task.language]}
              height={500}
              markers={compileMarkers}
              onCmdEnter={handleCmdEnter}
            />
          </div>
        </div>

        {/* 右カラム: 実行結果 */}
        <div className="flex w-full flex-col gap-3 overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={busy || !languageRunnable}
              className="flex-1 rounded bg-mp-cyan px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {running ? '実行中...' : '▶ 実行（お試し）'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy || !languageRunnable}
              className="flex-1 rounded bg-mp-purple px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '提出中...' : '提出する'}
            </button>
          </div>

          {lastSubmitFlash && (
            <p className="text-xs font-bold text-mp-green">提出しました（履歴に記録されました）</p>
          )}

          <p className="rounded border border-mp-border bg-mp-bg p-2 text-xs text-mp-muted">
            演習モードには時間制限がなく、何度でも提出できます。「実行」は採点のみで記録されません。「提出する」は全テストケースで判定し、提出履歴に記録されます。コードはこのページを離れると保存されません。
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
              {verdict.overallStatus !== 'CE' && (
                <span className="ml-2 font-normal">
                  （{verdict.score}/{task.points}点）
                </span>
              )}
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
                      <span className={result?.status ? TESTCASE_STATUS_COLOR[result.status] ?? 'text-mp-red' : ''}>
                        {result?.status ? `${statusGlyph(result.status)} ${result.status}` : '-'}
                      </span>
                    </div>
                    {tc.isSample && result && (
                      <div className="text-mp-muted">
                        <p className="font-mono">入力: {tc.input || '(なし)'}</p>
                        {result.status === 'AC' ? (
                          <p className="font-mono">出力: {result.actualOutput}</p>
                        ) : result.status === 'RE' || result.status === 'TLE' || result.status === 'MLE' ? (
                          <p className="font-mono">
                            出力: {result.actualOutput || '(なし)'}
                            {result.status === 'TLE'
                              ? '（実行時間超過）'
                              : result.status === 'MLE'
                                ? '（メモリ超過）'
                                : '（実行時エラー）'}
                          </p>
                        ) : (
                          <SampleDiff
                            expected={tc.expectedOutput ?? ''}
                            actual={result.actualOutput}
                          />
                        )}
                      </div>
                    )}
                    {!tc.isSample && result?.status === 'WA' && result.hint && (
                      <p className="text-mp-muted">ヒント: {result.hint}</p>
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
