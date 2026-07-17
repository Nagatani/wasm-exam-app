import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { CodeEditor } from '../components/CodeEditor';
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
  AC: 'bg-green-900 text-green-300 border-green-700',
  WA: 'bg-red-900 text-red-300 border-red-700',
  CE: 'bg-yellow-900 text-yellow-300 border-yellow-700',
};

interface ExecutionResult {
  compileFailed: boolean;
  compileStderr: string;
  outcomes: JudgeOutcome[];
}

export function StudentTaskPage() {
  const { examId, taskId } = useParams<{ examId: string; taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<StudentTask | null>(null);
  const [examTasks, setExamTasks] = useState<StudentTaskSummary[]>([]);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId || !examId) return;
    setLoading(true);
    setVerdict(null);
    setCompileError(null);
    Promise.all([getStudentTask(taskId), getStudentExam(examId)])
      .then(([{ task }, { exam }]) => {
        setTask(task);
        setCode(task.starterCodeC ?? '');
        setExamTasks(exam.tasks);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [taskId, examId]);

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
      await submitTask(task.id, code, { compileFailed, outcomes });

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
    return <div className="min-h-screen bg-gray-900 p-6 text-gray-400">読み込み中...</div>;
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 text-red-400">
        {error ?? '問題が見つかりません。'}
      </div>
    );
  }

  const sampleTestCases = task.testCases.filter((tc) => tc.isSample);
  const busy = running || submitting;

  return (
    <div className="flex min-h-screen flex-col bg-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-800 px-4 py-2">
        <h1 className="text-sm font-bold text-teal-400">
          問題 {task.order + 1}: {task.title}（{task.points}点）
        </h1>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-hidden p-4 md:flex-row">
        {/* 左カラム: 問題文 + サンプルテストケース */}
        <div className="flex w-full flex-col overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-4 md:w-1/3">
          <h2 className="mb-2 text-sm font-bold text-gray-400">問題文</h2>
          <div className="prose prose-invert mb-4 max-w-none text-sm">
            <ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>
          </div>

          <h2 className="mb-2 text-sm font-bold text-gray-400">サンプルテストケース</h2>
          {sampleTestCases.length === 0 ? (
            <p className="text-sm text-gray-500">サンプルはありません。</p>
          ) : (
            <div className="space-y-3">
              {sampleTestCases.map((tc) => (
                <div key={tc.id} className="rounded bg-gray-900 p-2.5 text-xs font-mono">
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
            <CodeEditor value={code} onChange={setCode} language="c" height={500} />
          </div>
        </div>

        {/* 右カラム: 実行結果 */}
        <div className="flex w-full flex-col gap-3 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-4 md:w-1/3">
          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={busy}
              className="flex-1 rounded bg-teal-500 px-3 py-2 text-sm font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
            >
              {running ? '実行中...' : '▶ コンパイル＆テスト実行'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '提出中...' : '送信（解答提出）'}
            </button>
          </div>

          {busy && statusMessage && <p className="text-xs text-gray-400">{statusMessage}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {verdict && (
            <div className={`rounded border px-3 py-2 text-center font-bold ${STATUS_COLOR[verdict.overallStatus]}`}>
              {STATUS_LABEL[verdict.overallStatus]}
            </div>
          )}

          {verdict?.overallStatus === 'CE' && compileError && (
            <pre className="whitespace-pre-wrap rounded bg-gray-900 p-3 text-xs text-red-300">
              {compileError}
            </pre>
          )}

          {verdict && verdict.overallStatus !== 'CE' && (
            <div className="space-y-2">
              {task.testCases.map((tc) => {
                const result = verdict.results.find((r) => r.testCaseId === tc.id);
                return (
                  <div key={tc.id} className="rounded bg-gray-900 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">
                        テストケース {tc.order + 1}
                        {tc.isSample ? '' : '（非公開）'}
                      </span>
                      <span
                        className={
                          result?.status === 'AC'
                            ? 'text-green-400'
                            : result?.status === 'RE'
                              ? 'text-yellow-400'
                              : 'text-red-400'
                        }
                      >
                        {result?.status ?? '-'}
                      </span>
                    </div>
                    {tc.isSample && result && (
                      <div className="font-mono text-gray-400">
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
