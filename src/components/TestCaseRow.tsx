import { useEffect, useId, useImperativeHandle, useState, type Ref } from 'react';
import { updateTestCase, deleteTestCase } from '../api/tasks';
import { ApiError } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import type { TestCase } from '../types/exam';

export interface TestCaseRowHandle {
  // Persists this row if dirty and resolves with the updated TestCase, or
  // returns null if already clean. Rejects on API error so callers like
  // "すべて保存" (Promise.allSettled) can report partial failures.
  save: () => Promise<TestCase | null>;
}

export interface TestCaseDuplicatePayload {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  timeLimitMs: number;
  memoryLimitMb: number;
}

const fieldClass =
  'w-full rounded border border-mp-border bg-mp-bg px-2 py-1 font-mono text-sm text-mp-fg';

// judge/Judge.java clamps to these (falls back to the default when a value is
// <= 0, caps at the max) — kept in sync manually since the judge doesn't
// expose its limits over the API.
const TIME_LIMIT_MIN_MS = 100;
const TIME_LIMIT_MAX_MS = 15_000;
const MEMORY_LIMIT_MIN_MB = 16;
const MEMORY_LIMIT_MAX_MB = 512;

function summarizeValue(value: string, maxLen = 40): string {
  const normalized = value.replace(/\r?\n/g, '↵');
  if (normalized === '') return '(空)';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

interface TestCaseRowProps {
  ref?: Ref<TestCaseRowHandle>;
  testCase: TestCase;
  onUpdated: (testCase: TestCase) => void;
  onDeleted: (id: string) => void;
  onDuplicate?: (payload: TestCaseDuplicatePayload) => Promise<void> | void;
  // Reports this row's own unsaved-changes state up to the parent, which
  // aggregates every independently-saved section (task form / each test case
  // row / solution editor) into one page-level "未保存の変更" summary — see
  // TaskEditorPage's dirtyTestCases.
  onDirtyChange?: (dirty: boolean) => void;
  // Only Java actually honours per-test time/memory limits on the judge —
  // C/JS/TS/Python use fixed limits equal to the browser's.
  showLimits: boolean;
}

export function TestCaseRow({
  ref,
  testCase,
  onUpdated,
  onDeleted,
  onDuplicate,
  onDirtyChange,
  showLimits,
}: TestCaseRowProps) {
  const idPrefix = useId();
  const [input, setInput] = useState(testCase.input);
  const [expectedOutput, setExpectedOutput] = useState(testCase.expectedOutput);
  const [isSample, setIsSample] = useState(testCase.isSample);
  const [timeLimitMs, setTimeLimitMs] = useState(testCase.timeLimitMs);
  const [memoryLimitMb, setMemoryLimitMb] = useState(testCase.memoryLimitMb);
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    input !== testCase.input ||
    expectedOutput !== testCase.expectedOutput ||
    isSample !== testCase.isSample ||
    timeLimitMs !== testCase.timeLimitMs ||
    memoryLimitMb !== testCase.memoryLimitMb;

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  // Clear this row's dirty flag from the parent's aggregate when the row goes
  // away (e.g. deleted), not just when it becomes clean.
  useEffect(() => {
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveRow(): Promise<TestCase | null> {
    if (!dirty) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const { testCase: updated } = await updateTestCase(testCase.id, {
        input,
        expectedOutput,
        isSample,
        timeLimitMs,
        memoryLimitMb,
      });
      onUpdated(updated);
      return updated;
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '保存に失敗しました。');
      throw err;
    } finally {
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({
    save: saveRow,
  }));

  function handleSave() {
    void saveRow().catch(() => {});
  }

  async function handleDuplicate() {
    if (!onDuplicate || duplicating) return;
    setDuplicating(true);
    setSaveError(null);
    try {
      await onDuplicate({
        input,
        expectedOutput,
        isSample,
        timeLimitMs,
        memoryLimitMb,
      });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '複製に失敗しました。');
    } finally {
      setDuplicating(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleteConfirmOpen(false);
    try {
      await deleteTestCase(testCase.id);
      onDeleted(testCase.id);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '削除に失敗しました。');
    }
  }

  return (
    <div className="rounded-lg border border-mp-border bg-mp-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="rounded border border-mp-border bg-mp-bg px-2 py-0.5 text-xs font-semibold text-mp-muted hover:bg-mp-surface-hover hover:text-mp-fg"
          >
            <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>{' '}
            {collapsed ? '展開' : '折りたたむ'}
          </button>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-bold ${
              isSample
                ? 'bg-mp-cyan/15 text-mp-cyan'
                : 'border border-mp-border bg-mp-bg text-mp-muted'
            }`}
          >
            {isSample ? 'サンプル' : '非公開'}
          </span>
          {dirty && <span className="text-xs font-bold text-mp-orange">● 未保存</span>}
          {collapsed && (
            <span className="min-w-0 truncate font-mono text-xs text-mp-muted">
              入力: {summarizeValue(input)} ／ 期待: {summarizeValue(expectedOutput)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onDuplicate && (
            <button
              type="button"
              onClick={() => void handleDuplicate()}
              disabled={duplicating}
              className="rounded border border-mp-border bg-mp-bg px-2 py-1 text-xs font-semibold hover:bg-mp-surface-hover disabled:opacity-50"
            >
              {duplicating ? '複製中...' : '複製'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label="このテストケースを削除"
            className="rounded border border-mp-red/50 px-2 py-1 text-xs text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
          >
            削除
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${idPrefix}-input`} className="mb-1 block text-xs text-mp-muted">
                入力（stdin）
              </label>
              <textarea
                id={`${idPrefix}-input`}
                rows={3}
                className={fieldClass}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-expected`} className="mb-1 block text-xs text-mp-muted">
                期待される出力（stdout）
              </label>
              <textarea
                id={`${idPrefix}-expected`}
                rows={3}
                className={fieldClass}
                value={expectedOutput}
                onChange={(e) => setExpectedOutput(e.target.value)}
              />
            </div>
          </div>
          {showLimits && (
            <div className="mb-2 flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor={`${idPrefix}-time`} className="mb-1 block text-xs text-mp-muted">
                  時間制限（ms、{TIME_LIMIT_MIN_MS}〜{TIME_LIMIT_MAX_MS}）
                </label>
                <input
                  id={`${idPrefix}-time`}
                  type="number"
                  min={TIME_LIMIT_MIN_MS}
                  max={TIME_LIMIT_MAX_MS}
                  step={100}
                  className={`w-28 ${fieldClass}`}
                  value={timeLimitMs}
                  onChange={(e) => setTimeLimitMs(Number(e.target.value))}
                  onBlur={(e) =>
                    setTimeLimitMs(
                      Math.min(TIME_LIMIT_MAX_MS, Math.max(TIME_LIMIT_MIN_MS, Number(e.target.value))),
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor={`${idPrefix}-memory`} className="mb-1 block text-xs text-mp-muted">
                  メモリ制限（MB、{MEMORY_LIMIT_MIN_MB}〜{MEMORY_LIMIT_MAX_MB}）
                </label>
                <input
                  id={`${idPrefix}-memory`}
                  type="number"
                  min={MEMORY_LIMIT_MIN_MB}
                  max={MEMORY_LIMIT_MAX_MB}
                  step={16}
                  className={`w-28 ${fieldClass}`}
                  value={memoryLimitMb}
                  onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                  onBlur={(e) =>
                    setMemoryLimitMb(
                      Math.min(
                        MEMORY_LIMIT_MAX_MB,
                        Math.max(MEMORY_LIMIT_MIN_MB, Number(e.target.value)),
                      ),
                    )
                  }
                />
              </div>
              <p className="text-xs text-mp-muted">Java にのみ適用されます。</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-mp-muted">
              <input
                type="checkbox"
                checked={isSample}
                onChange={(e) => setIsSample(e.target.checked)}
              />
              サンプルとして生徒に表示する
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="rounded border border-mp-border bg-mp-surface-hover px-3 py-1 text-sm hover:opacity-90 disabled:opacity-50"
              >
                {saving ? '保存中...' : 'このテストケースを保存'}
              </button>
            </div>
          </div>
        </>
      )}

      {saveError && (
        <p role="alert" className="mt-2 text-xs text-mp-red">
          {saveError}
        </p>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="テストケースを削除"
        message="このテストケースを削除します。この操作は取り消せません。よろしいですか？"
        confirmLabel="削除する"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
