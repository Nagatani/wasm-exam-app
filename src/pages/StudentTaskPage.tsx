import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { CodeEditor } from '../components/CodeEditor';
import { ThemeToggle } from '../components/ThemeToggle';
import { getStudentExam, getStudentTask, runTask, submitTask } from '../api/student';
import { compileC, runCompiledC } from '../runner/cRunner';
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

interface ExamTiming {
  timeLimitMinutes: number;
  startedAt: string;
}

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
  const [examTiming, setExamTiming] = useState<ExamTiming | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Accumulated for the whole time the student spends on this task (from load
  // to submit), not just the latest run — kept in refs since nothing needs to
  // re-render on every keystroke, only read them when submitting.
  const keystrokeCountRef = useRef(0);
  const pasteCountRef = useRef(0);
  const pastedCharCountRef = useRef(0);

  useEffect(() => {
    if (!taskId || !examId) return;
    setLoading(true);
    setVerdict(null);
    setCompileError(null);
    keystrokeCountRef.current = 0;
    pasteCountRef.current = 0;
    pastedCharCountRef.current = 0;
    Promise.all([getStudentTask(taskId), getStudentExam(examId)])
      .then(([{ task }, { exam }]) => {
        setTask(task);
        setCode(task.starterCodeC ?? '');
        setExamTasks(exam.tasks);
        setExamTiming({ timeLimitMinutes: exam.timeLimitMinutes, startedAt: exam.startedAt });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [taskId, examId]);

  // Ticks once a second so the countdown in the header stays live; the
  // deadline itself is anchored to the server-recorded exam start time, not
  // to when this component happened to mount.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function executeAgainstAllTestCases(currentTask: StudentTask): Promise<ExecutionResult> {
    setStatusMessage(
      'コンパイル中です（初回はclangパッケージのダウンロードのため数十秒〜数分かかることがあります）...',
    );
    const compileResult = await compileC(code);
    if (!compileResult.ok || !compileResult.wasmBinary) {
      return { compileFailed: true, compileStderr: compileResult.stderr, outcomes: [] };
    }

    const outcomes: JudgeOutcome[] = [];
    for (const tc of currentTask.testCases) {
      setStatusMessage(`テストケース ${tc.order + 1} を実行中...`);
      const runResult = await runCompiledC(compileResult.wasmBinary, tc.input);
      outcomes.push({
        testCaseId: tc.id,
        stage: runResult.ok ? 'success' : 'runtime_error',
        stdout: runResult.stdout,
      });
    }
    return { compileFailed: false, compileStderr: '', outcomes };
  }

  async function handleRun() {
    if (!task) return;
    setRunning(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    try {
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
      setStatusMessage('');
    }
  }

  async function handleSubmit() {
    if (!task || !examId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { compileFailed, compileStderr, outcomes } = await executeAgainstAllTestCases(task);
      if (compileFailed) {
        setCompileError(compileStderr);
        setVerdict({ overallStatus: 'CE', results: [], score: 0 });
      }
      await submitTask(task.id, code, { compileFailed, outcomes }, {
        keystrokeCount: keystrokeCountRef.current,
        pasteCount: pasteCountRef.current,
        pastedCharCount: pastedCharCountRef.current,
      });

      const idx = examTasks.findIndex((t) => t.id === task.id);
      const next = examTasks[idx + 1];
      if (next) {
        navigate(`/student/exams/${examId}/tasks/${next.id}`);
      } else {
        navigate(`/student/exams/${examId}/finished`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提出に失敗しました。');
    } finally {
      setSubmitting(false);
      setStatusMessage('');
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-mp-bg p-6 text-mp-muted">読み込み中...</div>;
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

  const remainingMs = examTiming
    ? new Date(examTiming.startedAt).getTime() + examTiming.timeLimitMinutes * 60_000 - now
    : null;
  const timeUp = remainingMs !== null && remainingMs <= 0;
  const timeLow = remainingMs !== null && !timeUp && remainingMs < 5 * 60_000;

  return (
    <div className="flex min-h-screen flex-col bg-mp-bg text-mp-fg">
      <header className="flex items-center justify-between border-b border-mp-border bg-mp-surface px-4 py-2">
        <h1 className="text-sm font-bold text-mp-cyan">
          問題 {task.order + 1}: {task.title}（{task.points}点）
        </h1>
        <div className="flex items-center gap-3">
          {remainingMs !== null && (
            <span
              className={`rounded px-2 py-1 text-sm font-bold ${
                timeUp
                  ? 'bg-mp-red text-mp-btn-fg'
                  : timeLow
                    ? 'text-mp-red'
                    : 'text-mp-muted'
              }`}
            >
              残り時間: {timeUp ? '00:00（時間切れ）' : formatRemaining(remainingMs)}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:flex-row">
        {/* 左カラム: 問題文 + サンプルテストケース */}
        <div className="flex w-full flex-col overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <h2 className="mb-2 text-sm font-bold text-mp-muted">問題文</h2>
          <div className="prose prose-invert mb-4 max-w-none text-sm">
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
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">main.c</span>
          </div>
          <div className="flex-1">
            <CodeEditor
              value={code}
              onChange={setCode}
              language="c"
              height={500}
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
              disabled={busy}
              className="flex-1 rounded bg-mp-cyan px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {running ? '実行中...' : '▶ コンパイル＆テスト実行'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="flex-1 rounded bg-mp-purple px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '提出中...' : '送信（解答提出）'}
            </button>
          </div>

          {busy && statusMessage && <p className="text-xs text-mp-muted">{statusMessage}</p>}
          {error && <p className="text-sm text-mp-red">{error}</p>}

          {verdict && (
            <div className={`rounded border px-3 py-2 text-center font-bold ${STATUS_COLOR[verdict.overallStatus]}`}>
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
                        {result?.status ?? '-'}
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
