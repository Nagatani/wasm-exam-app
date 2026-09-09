import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getTask, updateTask, deleteTask, createTestCase, upsertSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import type { Language, TaskDetail } from '../types/exam';
import { ALL_LANGUAGES, LANGUAGE_LABEL, MONACO_LANGUAGE } from '../lib/language';
import { TestCaseRow } from '../components/TestCaseRow';
import { CodeEditor } from '../components/CodeEditor';
import { BackHeader } from '../components/BackHeader';
import { PageSkeleton } from '../components/Skeleton';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';

const inputClass =
  'w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg';
const codeClass =
  'w-full rounded border border-mp-border bg-mp-bg px-3 py-2 font-mono text-sm text-mp-fg';

// The subset of task fields the main form's "保存" persists — used to detect
// unsaved edits (test cases and the reference solution save independently via
// their own buttons, so they're deliberately excluded here).
function taskFormKey(t: TaskDetail): string {
  return JSON.stringify({
    title: t.title,
    order: t.order,
    points: t.points,
    statementMarkdown: t.statementMarkdown,
    language: t.language,
    starterCode: t.starterCode ?? '',
  });
}

export function TaskEditorPage() {
  const { examId, taskId } = useParams<{ examId: string; taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Snapshot (taskFormKey) of the last server-persisted state of the main
  // form, so an "unsaved changes" hint can be shown while the current fields
  // differ from it.
  const savedSnapshotRef = useRef('');

  async function load() {
    if (!taskId) return;
    setLoading(true);
    try {
      const { task } = await getTask(taskId);
      setTask(task);
      savedSnapshotRef.current = taskFormKey(task);
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
        language: task.language,
        starterCode: task.starterCode,
      });
      setTask((prev) => {
        const next = prev ? { ...prev, ...updated } : prev;
        if (next) savedSnapshotRef.current = taskFormKey(next);
        return next;
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
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

  const dirty = task ? taskFormKey(task) !== savedSnapshotRef.current : false;
  useUnsavedGuard(dirty);

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

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <BackHeader to={`/teacher/exams/${examId}`} label="試験詳細に戻る" />

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
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-language">
              解答言語
            </label>
            <select
              id="task-language"
              className={inputClass}
              value={task.language}
              onChange={(e) => setTask({ ...task, language: e.target.value as Language })}
            >
              {ALL_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABEL[lang]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mb-3 text-xs text-mp-muted">
          生徒はこの問題をここで指定した言語のみで解答します（生徒側に言語の選択肢はありません）。
        </p>

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
          <div className="markdown-body mb-3 rounded border border-mp-border bg-mp-bg p-3">
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

        <label className="mb-1 block text-sm text-mp-muted">
          初期テンプレートコード（{LANGUAGE_LABEL[task.language]}）
        </label>
        <div className="mb-3">
          <CodeEditor
            value={task.starterCode ?? ''}
            onChange={(v) => setTask({ ...task, starterCode: v })}
            language={MONACO_LANGUAGE[task.language]}
            height={220}
          />
        </div>

        {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-mp-red px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90"
          >
            問題を削除
          </button>
          {dirty ? (
            <span className="text-xs font-bold text-mp-orange">● 未保存の変更があります</span>
          ) : savedFlash ? (
            <span className="text-xs font-bold text-mp-green">保存しました</span>
          ) : null}
        </div>
      </form>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">テストケース</h2>
          <button
            onClick={handleAddTestCase}
            className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
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
        key={`${task.id}-${task.language}`}
        taskId={task.id}
        language={task.language}
        initialCode={findSolution(task, task.language)}
      />
    </div>
  );
}

function findSolution(task: TaskDetail, language: Language): string {
  return task.solutions.find((s) => s.language === language)?.code ?? '';
}

// The teacher-only reference solution for this task's language, with its own
// "保存" button — saved separately from the task metadata form.
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
    <div className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-4">
      <h3 className="mb-2 text-sm font-bold text-mp-muted">
        解答例コード（{LANGUAGE_LABEL[language]}） — 生徒には非公開
      </h3>
      <div className="mb-2">
        <CodeEditor
          value={code}
          onChange={setCode}
          language={MONACO_LANGUAGE[language]}
          height={220}
        />
      </div>
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
