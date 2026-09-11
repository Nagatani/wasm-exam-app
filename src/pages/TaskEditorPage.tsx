import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getTask,
  updateTask,
  deleteTask,
  createTestCase,
  bulkCreateTestCases,
  updateTestCase,
  upsertSolution,
  checkSolution,
  regradeTask,
} from '../api/tasks';
import { ApiError } from '../api/client';
import type { ComparisonMode, Language, TaskDetail } from '../types/exam';
import { COMPARISON_MODE_LABEL, compareOutput } from '../lib/compareOutput';
import {
  ALL_LANGUAGES,
  isServerExec,
  LANGUAGE_LABEL,
  LANGUAGE_TEMPLATE,
  MONACO_LANGUAGE,
  isUntouchedTemplate,
} from '../lib/language';
import { runClientSide } from '../runner/clientRunner';
import { TestCaseRow } from '../components/TestCaseRow';
import { CodeEditor } from '../components/CodeEditor';
import { BackHeader } from '../components/BackHeader';
import { PageSkeleton } from '../components/Skeleton';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { changedOrders, moveItem } from '../lib/reorder';

// Bulk import format: cases separated by a line that is exactly `===`; within
// a case, input and expected are separated by a line that is exactly `---`; a
// first line of exactly `@sample` marks the case as a sample.
function parseBulkCases(
  text: string,
): { input: string; expectedOutput: string; isSample: boolean }[] {
  return text
    .split(/\r?\n===\r?\n/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => {
      let body = block;
      let isSample = false;
      const nl = body.indexOf('\n');
      const firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === '@sample') {
        isSample = true;
        body = nl === -1 ? '' : body.slice(nl + 1);
      }
      const parts = body.split(/\r?\n---\r?\n/);
      return {
        input: parts[0] ?? '',
        expectedOutput: parts.slice(1).join('\n---\n'),
        isSample,
      };
    });
}

type SolutionCheckStatus = 'match' | 'mismatch' | 'error' | 'timeout' | 'missing';

interface SolutionCheckRow {
  testCaseId: string;
  label: string;
  isSample: boolean;
  expected: string;
  actual: string | null;
  status: SolutionCheckStatus;
}

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
    comparisonMode: t.comparisonMode,
    floatTolerance: t.floatTolerance,
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
  const [statementView, setStatementView] = useState<'edit' | 'split' | 'preview'>('edit');
  // "解答例でテストケースを検証" results — one row per test case, or an error /
  // compile-failure message.
  const [checking, setChecking] = useState(false);
  const [checkRows, setCheckRows] = useState<SolutionCheckRow[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  // Snapshot (taskFormKey) of the last server-persisted state of the main
  // form, so an "unsaved changes" hint can be shown while the current fields
  // differ from it.
  const savedSnapshotRef = useRef('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [regrading, setRegrading] = useState(false);
  const [regradeMsg, setRegradeMsg] = useState<string | null>(null);
  const [tcDragIndex, setTcDragIndex] = useState<number | null>(null);
  const [testCaseReorderError, setTestCaseReorderError] = useState<string | null>(null);
  // This page has three independently-saved sections (basic info / each test
  // case row / the reference solution) — each aggregated here so one banner
  // can show every unsaved section at once instead of leaving the teacher to
  // notice a missed "保存" click on a section they've scrolled away from.
  const [dirtyTestCaseIds, setDirtyTestCaseIds] = useState<Set<string>>(new Set());
  const [solutionDirty, setSolutionDirty] = useState(false);

  function handleTestCaseDirtyChange(id: string, dirty: boolean) {
    setDirtyTestCaseIds((prev) => {
      if (dirty === prev.has(id)) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function load() {
    if (!taskId) return;
    setLoading(true);
    try {
      const { task } = await getTask(taskId);
      savedSnapshotRef.current = taskFormKey(task);
      // Pre-fill the starter-code field with the language's skeleton when the
      // task has none yet (leaves the form marked "未保存" so the teacher saves it).
      if (!task.starterCode || task.starterCode.trim() === '') {
        setTask({ ...task, starterCode: LANGUAGE_TEMPLATE[task.language] });
      } else {
        setTask(task);
      }
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
        comparisonMode: task.comparisonMode,
        floatTolerance: task.floatTolerance,
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

  // Drag-and-drop / ▲▼ reordering for the test case list — same pattern as
  // ExamDetailPage's task reordering (see reorder.ts): update on-screen
  // order immediately, persist only the rows that actually moved, and
  // reload from the server if any of those PATCHes fail.
  async function reorderTestCases(from: number, to: number) {
    if (!task) return;
    const reordered = moveItem(task.testCases, from, to);
    if (reordered === task.testCases) return;
    setTask({ ...task, testCases: reordered.map((tc, i) => ({ ...tc, order: i })) });
    setTestCaseReorderError(null);
    try {
      await Promise.all(
        changedOrders(reordered).map(({ item, order }) => updateTestCase(item.id, { order })),
      );
    } catch (err) {
      setTestCaseReorderError(
        err instanceof ApiError ? err.message : '並び替えの保存に失敗しました。',
      );
      await load();
    }
  }

  async function handleRegrade() {
    if (!task) return;
    if (
      !confirm(
        'この問題の既存の提出をすべて、現在のテストケース・比較設定で再採点します。提出の判定・得点が上書きされます。よろしいですか？',
      )
    ) {
      return;
    }
    setRegrading(true);
    setRegradeMsg(null);
    try {
      const { regraded, changed, failed } = await regradeTask(task.id);
      setRegradeMsg(
        `${regraded} 件を再採点、${changed} 件で判定が変化${failed > 0 ? `（${failed} 件は失敗）` : ''}。`,
      );
    } catch (err) {
      setRegradeMsg(err instanceof ApiError ? err.message : '再採点に失敗しました。');
    } finally {
      setRegrading(false);
    }
  }

  async function handleBulkImport(text: string) {
    if (!task) return;
    const cases = parseBulkCases(text);
    if (cases.length === 0) {
      setBulkError('テストケースを読み取れませんでした。書式を確認してください。');
      return;
    }
    setBulkBusy(true);
    setBulkError(null);
    try {
      const { testCases } = await bulkCreateTestCases(task.id, cases);
      setTask((prev) => (prev ? { ...prev, testCases } : prev));
      setShowBulk(false);
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : '一括追加に失敗しました。');
    } finally {
      setBulkBusy(false);
    }
  }

  // Run `code` (the current reference-solution editor content) against every
  // test case and diff its stdout against the stored expected output. Java
  // goes through the server judge; the other languages run in this browser via
  // the same runner the student flow uses.
  async function runSolutionCheck(code: string) {
    if (!task) return;
    setChecking(true);
    setCheckError(null);
    setCheckRows(null);
    try {
      const run = isServerExec(task.language)
        ? await checkSolution(task.id, code)
        : await runClientSide(
            task.language,
            code,
            task.testCases.map((tc) => ({ id: tc.id, input: tc.input })),
            () => {},
          );
      if (run.compileFailed) {
        setCheckError(run.compileStderr || 'コンパイル／構文エラーが発生しました。');
        return;
      }
      setCheckRows(
        task.testCases.map((tc, i) => {
          const outcome = run.outcomes.find((o) => o.testCaseId === tc.id);
          if (!outcome) {
            return {
              testCaseId: tc.id,
              label: `テストケース ${i + 1}`,
              isSample: tc.isSample,
              expected: tc.expectedOutput,
              actual: null,
              status: 'missing',
            };
          }
          if (outcome.stage !== 'success') {
            return {
              testCaseId: tc.id,
              label: `テストケース ${i + 1}`,
              isSample: tc.isSample,
              expected: tc.expectedOutput,
              actual: outcome.stdout,
              status: outcome.stage === 'tle' || outcome.stage === 'mle' ? 'timeout' : 'error',
            };
          }
          const status: SolutionCheckStatus = compareOutput(
            tc.expectedOutput,
            outcome.stdout,
            task.comparisonMode,
            task.floatTolerance,
          )
            ? 'match'
            : 'mismatch';
          return {
            testCaseId: tc.id,
            label: `テストケース ${i + 1}`,
            isSample: tc.isSample,
            expected: tc.expectedOutput,
            actual: outcome.stdout,
            status,
          };
        }),
      );
    } catch (err) {
      setCheckError(err instanceof ApiError ? err.message : '検証の実行に失敗しました。');
    } finally {
      setChecking(false);
    }
  }

  // "実際の出力を期待値にする" — persist the produced stdout as this test
  // case's expected output.
  async function applyActualAsExpected(testCaseId: string, actual: string) {
    try {
      const { testCase: updated } = await updateTestCase(testCaseId, { expectedOutput: actual });
      setTask((prev) =>
        prev
          ? { ...prev, testCases: prev.testCases.map((t) => (t.id === updated.id ? updated : t)) }
          : prev,
      );
      setCheckRows((prev) =>
        prev
          ? prev.map((r) =>
              r.testCaseId === testCaseId ? { ...r, expected: actual, status: 'match' } : r,
            )
          : prev,
      );
    } catch (err) {
      setCheckError(err instanceof ApiError ? err.message : '期待値の更新に失敗しました。');
    }
  }

  const basicInfoDirty = task ? taskFormKey(task) !== savedSnapshotRef.current : false;
  // Only Java (exam flow) and C (regrade only) actually run through the
  // judge container — see isRegradeCapable() server-side; there's no
  // frontend equivalent to import since this page is the only place that
  // needs it.
  const judgeRelevant = task ? task.language === 'JAVA' || task.language === 'C' : false;
  const anyDirty = basicInfoDirty || dirtyTestCaseIds.size > 0 || solutionDirty;
  useUnsavedGuard(anyDirty);

  const unsavedSections: string[] = [];
  if (basicInfoDirty) unsavedSections.push('基本情報');
  if (dirtyTestCaseIds.size > 0) unsavedSections.push(`テストケース（${dirtyTestCaseIds.size}件）`);
  if (solutionDirty) unsavedSections.push('解答例コード');

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

      {/* This page has 3 independently-saved sections (below); this banner is
          the one place that shows every unsaved one at once, so a save click
          in one section is never mistaken for saving another. */}
      {unsavedSections.length > 0 && (
        <div className="mb-4 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-sm font-bold text-mp-orange">
          ● 未保存の変更があります： {unsavedSections.join('、')}
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-4"
      >
        <h2 className="mb-3 text-sm font-bold text-mp-muted">
          基本情報（タイトル・配点・言語・問題文・初期テンプレート）
        </h2>

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
              onChange={(e) => {
                const language = e.target.value as Language;
                // Swap in the new language's template only if the field is
                // still blank or an untouched template — never clobber code
                // the teacher has written.
                const starterCode = isUntouchedTemplate(task.starterCode ?? '')
                  ? LANGUAGE_TEMPLATE[language]
                  : task.starterCode;
                setTask({ ...task, language, starterCode });
              }}
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

        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-comparison">
              出力の比較方法
            </label>
            <select
              id="task-comparison"
              className={inputClass}
              value={task.comparisonMode}
              onChange={(e) =>
                setTask({ ...task, comparisonMode: e.target.value as ComparisonMode })
              }
            >
              {(Object.keys(COMPARISON_MODE_LABEL) as ComparisonMode[]).map((m) => (
                <option key={m} value={m}>
                  {COMPARISON_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          {task.comparisonMode === 'FLOAT' && (
            <div>
              <label className="mb-1 block text-sm text-mp-muted" htmlFor="task-float-tol">
                許容誤差
              </label>
              <input
                id="task-float-tol"
                type="number"
                step="any"
                min={0}
                className={`w-32 ${inputClass}`}
                value={task.floatTolerance}
                onChange={(e) =>
                  setTask({ ...task, floatTolerance: Math.max(0, Number(e.target.value)) })
                }
              />
            </div>
          )}
        </div>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm text-mp-muted" htmlFor="task-statement">
            問題文（Markdown）
          </label>
          <div className="flex overflow-hidden rounded border border-mp-border text-xs">
            {(
              [
                ['edit', '編集'],
                ['split', '分割'],
                ['preview', 'プレビュー'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatementView(value)}
                className={`px-2 py-0.5 font-semibold ${
                  statementView === value
                    ? 'bg-mp-cyan text-mp-btn-fg'
                    : 'bg-mp-surface text-mp-muted hover:bg-mp-surface-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {statementView === 'preview' ? (
          <div className="markdown-body mb-3 rounded border border-mp-border bg-mp-bg p-3">
            <ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>
          </div>
        ) : statementView === 'split' ? (
          <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <textarea
              id="task-statement"
              rows={16}
              className={codeClass}
              value={task.statementMarkdown}
              onChange={(e) => setTask({ ...task, statementMarkdown: e.target.value })}
            />
            <div className="markdown-body max-h-[26rem] overflow-y-auto rounded border border-mp-border bg-mp-bg p-3">
              <ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <textarea
            id="task-statement"
            rows={14}
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
            disabled={saving || !basicInfoDirty}
            className="rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '基本情報を保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded bg-mp-red px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90"
          >
            問題を削除
          </button>
          {basicInfoDirty ? (
            <span className="text-xs font-bold text-mp-orange">● 未保存</span>
          ) : savedFlash ? (
            <span className="text-xs font-bold text-mp-green">保存しました</span>
          ) : null}
        </div>
      </form>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">テストケース</h2>
            <p className="text-xs text-mp-muted">
              各行は「このテストケースを保存」で個別に保存されます（基本情報とは別）。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {judgeRelevant && (
              <button
                onClick={handleRegrade}
                disabled={regrading}
                className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover disabled:opacity-50"
                title="このテストケースで既存の提出を再採点します（Java / C）"
              >
                {regrading ? '再採点中...' : '既存の提出を再採点'}
              </button>
            )}
            <button
              onClick={() => setShowBulk((v) => !v)}
              className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover"
            >
              {showBulk ? '一括追加を閉じる' : '一括追加'}
            </button>
            <button
              onClick={handleAddTestCase}
              className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
            >
              + テストケースを追加
            </button>
          </div>
        </div>
        {regradeMsg && <p className="mb-2 text-sm text-mp-cyan">{regradeMsg}</p>}
        {testCaseReorderError && (
          <p className="mb-2 text-sm text-mp-red">{testCaseReorderError}</p>
        )}

        {showBulk && (
          <BulkTestCasePanel
            busy={bulkBusy}
            error={bulkError}
            onImport={handleBulkImport}
          />
        )}

        <div className="space-y-3">
          {task.testCases.map((tc, i) => (
            <div
              // Include expectedOutput in the key so a value written by
              // "実際の出力を期待値にする" remounts the row with fresh field state.
              key={`${tc.id}@${tc.expectedOutput}`}
              draggable
              onDragStart={() => setTcDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (tcDragIndex !== null) reorderTestCases(tcDragIndex, i);
                setTcDragIndex(null);
              }}
              onDragEnd={() => setTcDragIndex(null)}
              className={tcDragIndex === i ? 'opacity-50' : ''}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-mp-muted">
                <span
                  className="cursor-grab select-none active:cursor-grabbing"
                  title="ドラッグして並び替え"
                >
                  ⠿
                </span>
                <button
                  type="button"
                  onClick={() => reorderTestCases(i, i - 1)}
                  disabled={i === 0}
                  aria-label="上に移動"
                  className="leading-none hover:text-mp-fg disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => reorderTestCases(i, i + 1)}
                  disabled={i === task.testCases.length - 1}
                  aria-label="下に移動"
                  className="leading-none hover:text-mp-fg disabled:opacity-30"
                >
                  ▼
                </button>
                <span>テストケース {i + 1}</span>
              </div>
              <TestCaseRow
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
                onDirtyChange={(dirty) => handleTestCaseDirtyChange(tc.id, dirty)}
                showLimits={judgeRelevant}
              />
            </div>
          ))}
        </div>
      </div>

      <SolutionEditor
        key={`${task.id}-${task.language}`}
        taskId={task.id}
        language={task.language}
        initialCode={findSolution(task, task.language)}
        canCheck={task.testCases.length > 0}
        checking={checking}
        onRunCheck={runSolutionCheck}
        onDirtyChange={setSolutionDirty}
      />

      {(checkRows || checkError) && (
        <SolutionCheckPanel
          rows={checkRows}
          error={checkError}
          onApply={applyActualAsExpected}
          onDismiss={() => {
            setCheckRows(null);
            setCheckError(null);
          }}
        />
      )}
    </div>
  );
}

function BulkTestCasePanel({
  busy,
  error,
  onImport,
}: {
  busy: boolean;
  error: string | null;
  onImport: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const placeholder = `3\n---\n6\n===\n@sample\n10\n---\n20`;
  return (
    <div className="mb-3 rounded-lg border border-mp-border bg-mp-surface p-3">
      <p className="mb-2 text-xs text-mp-muted">
        複数のテストケースをまとめて追加します。ケースの区切りは <code>===</code> だけの行、
        入力と期待される出力の区切りは <code>---</code> だけの行。ケースの1行目を{' '}
        <code>@sample</code> にするとサンプル扱いになります。既存のテストケースの後ろに追加されます。
      </p>
      <textarea
        rows={8}
        className={codeClass}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="mt-1 text-sm text-mp-red">{error}</p>}
      <button
        onClick={() => onImport(text)}
        disabled={busy || text.trim() === ''}
        className="mt-2 rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? '追加中...' : 'この内容で追加'}
      </button>
    </div>
  );
}

function SolutionCheckPanel({
  rows,
  error,
  onApply,
  onDismiss,
}: {
  rows: SolutionCheckRow[] | null;
  error: string | null;
  onApply: (testCaseId: string, actual: string) => void;
  onDismiss: () => void;
}) {
  const STATUS_META: Record<SolutionCheckStatus, { label: string; cls: string }> = {
    match: { label: '一致', cls: 'text-mp-green' },
    mismatch: { label: '不一致', cls: 'text-mp-red' },
    error: { label: '実行時エラー', cls: 'text-mp-yellow' },
    timeout: { label: '時間／メモリ超過', cls: 'text-mp-orange' },
    missing: { label: '出力なし', cls: 'text-mp-muted' },
  };
  const mismatchCount = rows?.filter((r) => r.status !== 'match').length ?? 0;

  return (
    <div className="mb-6 rounded-lg border border-mp-border bg-mp-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-mp-muted">解答例の検証結果</h3>
        <button
          onClick={onDismiss}
          className="text-xs font-semibold text-mp-cyan hover:underline"
        >
          閉じる
        </button>
      </div>

      {error ? (
        <pre className="whitespace-pre-wrap rounded bg-mp-bg p-3 text-xs text-mp-red">{error}</pre>
      ) : rows && rows.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-mp-muted">
            {mismatchCount === 0
              ? 'すべてのテストケースで期待される出力と一致しました。'
              : `${mismatchCount} 件が期待される出力と一致していません。解答例が正しいことを確認できたら、「実際の出力を期待値にする」で期待される出力を上書きできます。`}
          </p>
          <div className="space-y-2">
            {rows.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <div key={r.testCaseId} className="rounded border border-mp-border bg-mp-bg p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold">
                      {r.label}
                      {r.isSample ? '（サンプル）' : ''}
                    </span>
                    <span className={`font-bold ${meta.cls}`}>{meta.label}</span>
                  </div>
                  {r.status !== 'match' && (
                    <div className="grid grid-cols-1 gap-2 font-mono md:grid-cols-2">
                      <div>
                        <p className="text-mp-muted">期待される出力</p>
                        <pre className="whitespace-pre-wrap break-words">{r.expected || '(空)'}</pre>
                      </div>
                      <div>
                        <p className="text-mp-muted">解答例の出力</p>
                        <pre className="whitespace-pre-wrap break-words">
                          {r.actual === null ? '(なし)' : r.actual || '(空)'}
                        </pre>
                      </div>
                    </div>
                  )}
                  {(r.status === 'mismatch' || r.status === 'error') && r.actual !== null && (
                    <button
                      onClick={() => onApply(r.testCaseId, r.actual as string)}
                      className="mt-2 rounded border border-mp-border bg-mp-surface-hover px-2 py-1 text-xs hover:opacity-90"
                    >
                      実際の出力を期待値にする
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-mp-muted">テストケースがありません。</p>
      )}
    </div>
  );
}

function findSolution(task: TaskDetail, language: Language): string {
  return task.solutions.find((s) => s.language === language)?.code ?? '';
}

// The teacher-only reference solution for this task's language, with its own
// "解答例を保存" button — saved separately from the task metadata form. Also
// drives "解答例でテストケースを検証" (results are rendered by the parent).
function SolutionEditor({
  taskId,
  language,
  initialCode,
  canCheck,
  checking,
  onRunCheck,
  onDirtyChange,
}: {
  taskId: string;
  language: Language;
  initialCode: string;
  canCheck: boolean;
  checking: boolean;
  onRunCheck: (code: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [code, setCode] = useState(initialCode);
  // Tracked separately from `initialCode` (a prop that only changes on a full
  // task reload) so dirty correctly clears right after a successful save,
  // not just after the page is reloaded.
  const [savedCode, setSavedCode] = useState(initialCode);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = code !== savedCode;

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  useEffect(() => {
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await upsertSolution(taskId, language, code);
      setSavedCode(code);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const trimmed = code.trim();

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
      <div className="flex flex-wrap items-center gap-2">
        {dirty && <span className="text-xs font-bold text-mp-orange">● 未保存</span>}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded border border-mp-border bg-mp-surface-hover px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '保存中...' : saved ? '保存しました' : '解答例を保存'}
        </button>
        <button
          onClick={() => onRunCheck(code)}
          disabled={checking || !canCheck || trimmed === ''}
          title={
            !canCheck
              ? 'テストケースを追加してください'
              : trimmed === ''
                ? '解答例コードを入力してください'
                : undefined
          }
          className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
        >
          {checking ? '検証中...' : '解答例でテストケースを検証'}
        </button>
      </div>
    </div>
  );
}
