import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getTask, updateTask, deleteTask, createTestCase, upsertSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import type { Language, TaskDetail } from '../types/exam';
import { TestCaseRow } from '../components/TestCaseRow';
import { CodeEditor } from '../components/CodeEditor';
import { ThemeToggle } from '../components/ThemeToggle';

const inputClass =
  'w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg';
const codeClass =
  'w-full rounded border border-mp-border bg-mp-bg px-3 py-2 font-mono text-sm text-mp-fg';

export function TaskEditorPage() {
  const { examId, taskId } = useParams<{ examId: string; taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  async function load() {
    if (!taskId) return;
    setLoading(true);
    try {
      const { task } = await getTask(taskId);
      setTask(task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      const { task: updated } = await updateTask(task.id, {
        title: task.title,
        order: task.order,
        points: task.points,
        statementMarkdown: task.statementMarkdown,
        starterCodeC: task.starterCodeC,
        starterCodeJava: task.starterCodeJava,
      });
      setTask((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm(`「${task.title}」を削除します。よろしいですか？`)) return;
    await deleteTask(task.id);
    navigate(`/teacher/exams/${examId}`);
  }

  async function handleAddTestCase() {
    if (!task) return;
    const { testCase } = await createTestCase(task.id, {
      input: '',
      expectedOutput: '',
      order: task.testCases.length,
    });
    setTask((prev) => (prev ? { ...prev, testCases: [...prev.testCases, testCase] } : prev));
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

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <div className="mb-4 flex items-center justify-between">
        <Link
          to={`/teacher/exams/${examId}`}
          className="inline-block text-sm font-semibold text-mp-cyan hover:underline"
        >
          ← 試験詳細に戻る
        </Link>
        <ThemeToggle />
      </div>

      <form
        onSubmit={handleSave}
        className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-4"
      >
        <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-title">
          タイトル
        </label>
        <input
          id="task-title"
          className={`mb-3 ${inputClass}`}
          value={task.title}
          onChange={(e) => setTask({ ...task, title: e.target.value })}
          required
        />

        <div className="mb-3 flex gap-4">
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-order">
              表示順
            </label>
            <input
              id="task-order"
              type="number"
              className={`w-24 ${inputClass}`}
              value={task.order}
              onChange={(e) => setTask({ ...task, order: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-points">
              配点
            </label>
            <input
              id="task-points"
              type="number"
              min={0}
              className={`w-24 ${inputClass}`}
              value={task.points}
              onChange={(e) => setTask({ ...task, points: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm text-mp-muted" htmlFor="task-statement">
            問題文（Markdown）
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs font-semibold text-mp-cyan hover:underline"
          >
            {showPreview ? '編集に戻る' : 'プレビュー'}
          </button>
        </div>
        {showPreview ? (
          <div className="prose prose-invert mb-3 max-w-none rounded border border-mp-border bg-mp-bg p-3">
            <ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            id="task-statement"
            rows={6}
            className={`mb-3 ${codeClass}`}
            value={task.statementMarkdown}
            onChange={(e) => setTask({ ...task, statementMarkdown: e.target.value })}
          />
        )}

        <label className="mb-1 block text-sm text-mp-muted">初期テンプレートコード（C言語）</label>
        <div className="mb-3">
          <CodeEditor
            value={task.starterCodeC ?? ''}
            onChange={(v) => setTask({ ...task, starterCodeC: v })}
            language="c"
            height={220}
          />
        </div>

        <label className="mb-1 block text-sm text-mp-muted" htmlFor="starter-java">
          初期テンプレートコード（Java）
        </label>
        <textarea
          id="starter-java"
          rows={6}
          className={`mb-3 ${codeClass}`}
          value={task.starterCodeJava ?? ''}
          onChange={(e) => setTask({ ...task, starterCodeJava: e.target.value })}
        />

        {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-ink hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-mp-red px-4 py-2 font-bold text-mp-ink hover:opacity-90"
          >
            問題を削除
          </button>
        </div>
      </form>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">テストケース</h2>
          <button
            onClick={handleAddTestCase}
            className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-ink hover:opacity-90"
          >
            + テストケースを追加
          </button>
        </div>
        <div className="space-y-3">
          {task.testCases.map((tc) => (
            <TestCaseRow
              key={tc.id}
              testCase={tc}
              onUpdated={(updated) =>
                setTask((prev) =>
                  prev
                    ? {
                        ...prev,
                        testCases: prev.testCases.map((t) => (t.id === updated.id ? updated : t)),
                      }
                    : prev,
                )
              }
              onDeleted={(id) =>
                setTask((prev) =>
                  prev ? { ...prev, testCases: prev.testCases.filter((t) => t.id !== id) } : prev,
                )
              }
            />
          ))}
        </div>
      </div>

      <SolutionEditor
        taskId={task.id}
        language="C"
        initialCode={findSolution(task, 'C')}
        useMonaco
      />
      <SolutionEditor taskId={task.id} language="JAVA" initialCode={findSolution(task, 'JAVA')} />
    </div>
  );
}

function findSolution(task: TaskDetail, language: Language): string {
  return task.solutions.find((s) => s.language === language)?.code ?? '';
}

function SolutionEditor({
  taskId,
  language,
  initialCode,
  useMonaco = false,
}: {
  taskId: string;
  language: Language;
  initialCode: string;
  useMonaco?: boolean;
}) {
  const [code, setCode] = useState(initialCode);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await upsertSolution(taskId, language, code);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-4">
      <h3 className="mb-2 text-sm font-bold text-mp-muted">
        解答例コード（{language === 'C' ? 'C言語' : 'Java'}） — 生徒には非公開
      </h3>
      {useMonaco ? (
        <div className="mb-2">
          <CodeEditor value={code} onChange={setCode} language="c" height={220} />
        </div>
      ) : (
        <textarea
          rows={6}
          className={`mb-2 ${codeClass}`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded border border-mp-border bg-mp-surface-hover px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
      >
        {saving ? '保存中...' : saved ? '保存しました' : '保存'}
      </button>
    </div>
  );
}
