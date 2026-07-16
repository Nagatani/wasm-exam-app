import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getTask, updateTask, deleteTask, createTestCase, upsertSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import type { Language, TaskDetail } from '../types/exam';
import { TestCaseRow } from '../components/TestCaseRow';

const inputClass =
  'w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white';
const codeClass =
  'w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-sm text-white';

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
    return <div className="min-h-screen bg-gray-900 p-6 text-gray-400">読み込み中...</div>;
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 text-red-400">
        {error ?? '問題が見つかりません。'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <Link
        to={`/teacher/exams/${examId}`}
        className="mb-4 inline-block text-sm text-teal-400 hover:underline"
      >
        ← 試験詳細に戻る
      </Link>

      <form
        onSubmit={handleSave}
        className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4"
      >
        <label className="mb-1 block text-sm text-gray-400" htmlFor="task-title">
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
            <label className="mb-1 block text-sm text-gray-400" htmlFor="task-order">
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
            <label className="mb-1 block text-sm text-gray-400" htmlFor="task-points">
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
          <label className="block text-sm text-gray-400" htmlFor="task-statement">
            問題文（Markdown）
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs text-teal-400 hover:underline"
          >
            {showPreview ? '編集に戻る' : 'プレビュー'}
          </button>
        </div>
        {showPreview ? (
          <div className="prose prose-invert mb-3 max-w-none rounded border border-gray-600 bg-gray-900 p-3">
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

        <label className="mb-1 block text-sm text-gray-400" htmlFor="starter-c">
          初期テンプレートコード（C言語）
        </label>
        <textarea
          id="starter-c"
          rows={6}
          className={`mb-3 ${codeClass}`}
          value={task.starterCodeC ?? ''}
          onChange={(e) => setTask({ ...task, starterCodeC: e.target.value })}
        />

        <label className="mb-1 block text-sm text-gray-400" htmlFor="starter-java">
          初期テンプレートコード（Java）
        </label>
        <textarea
          id="starter-java"
          rows={6}
          className={`mb-3 ${codeClass}`}
          value={task.starterCodeJava ?? ''}
          onChange={(e) => setTask({ ...task, starterCodeJava: e.target.value })}
        />

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-teal-500 px-4 py-2 font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-red-900 px-4 py-2 font-bold text-red-300 hover:bg-red-800"
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
            className="rounded bg-teal-500 px-3 py-1.5 text-sm font-bold text-gray-900 hover:bg-teal-600"
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

      <SolutionEditor taskId={task.id} language="C" initialCode={findSolution(task, 'C')} />
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
}: {
  taskId: string;
  language: Language;
  initialCode: string;
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
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="mb-2 text-sm font-bold text-gray-400">
        解答例コード（{language === 'C' ? 'C言語' : 'Java'}） — 生徒には非公開
      </h3>
      <textarea
        rows={6}
        className={`mb-2 ${codeClass}`}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600 disabled:opacity-50"
      >
        {saving ? '保存中...' : saved ? '保存しました' : '保存'}
      </button>
    </div>
  );
}
