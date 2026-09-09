import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getTask,
  updateTask,
  deleteTask,
  createTestCase,
  upsertSolution,
  upsertStarterCode,
} from '../api/tasks';
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
// unsaved edits (test cases, starter code and solutions save independently
// via their own rows, so they're deliberately excluded here).
function taskFormKey(t: TaskDetail): string {
  return JSON.stringify({
    title: t.title,
    order: t.order,
    points: t.points,
    statementMarkdown: t.statementMarkdown,
    allowedLanguages: [...t.allowedLanguages].sort(),
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
        allowedLanguages: task.allowedLanguages,
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

  const orderedAllowed = task
    ? ALL_LANGUAGES.filter((l) => task.allowedLanguages.includes(l))
    : [];

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

        <fieldset className="mb-3">
          <legend className="mb-1 text-sm text-mp-muted">解答可能な言語</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_LANGUAGES.map((lang) => {
              const checked = task.allowedLanguages.includes(lang);
              const isLastChecked = checked && task.allowedLanguages.length === 1;
              return (
                <label
                  key={lang}
                  className={`flex items-center gap-1.5 text-sm ${
                    isLastChecked ? 'opacity-60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLastChecked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? ALL_LANGUAGES.filter(
                            (l) => l === lang || task.allowedLanguages.includes(l),
                          )
                        : task.allowedLanguages.filter((l) => l !== lang);
                      setTask({ ...task, allowedLanguages: next });
                    }}
                  />
                  {LANGUAGE_LABEL[lang]}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-mp-muted">
            少なくとも1つ選択してください。初期テンプレートコードは下の「初期テンプレートコード」欄で言語ごとに保存します。
          </p>
        </fieldset>

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

      <div className="space-y-4">
        {orderedAllowed.map((lang) => (
          <div
            key={`${task.id}-${lang}`}
            className="rounded-lg border border-mp-border bg-mp-surface p-4"
          >
            <h2 className="mb-3 text-base font-bold text-mp-cyan">{LANGUAGE_LABEL[lang]}</h2>
            <LanguageCodeEditor
              kind="starter"
              taskId={task.id}
              language={lang}
              initialCode={findStarterCode(task, lang)}
            />
            <LanguageCodeEditor
              kind="solution"
              taskId={task.id}
              language={lang}
              initialCode={findSolution(task, lang)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function findSolution(task: TaskDetail, language: Language): string {
  return task.solutions.find((s) => s.language === language)?.code ?? '';
}

function findStarterCode(task: TaskDetail, language: Language): string {
  return task.starterCodes.find((s) => s.language === language)?.code ?? '';
}

// One editor + independent "保存" button for either the student-facing starter
// template ('starter') or the teacher-only reference solution ('solution') of
// a single language. Both persist per (task, language) row, separately from
// the task metadata form.
function LanguageCodeEditor({
  kind,
  taskId,
  language,
  initialCode,
}: {
  kind: 'starter' | 'solution';
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
      if (kind === 'starter') {
        await upsertStarterCode(taskId, language, code);
      } else {
        await upsertSolution(taskId, language, code);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-sm font-bold text-mp-muted">
        {kind === 'starter' ? '初期テンプレートコード' : '解答例コード（生徒には非公開）'}
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
