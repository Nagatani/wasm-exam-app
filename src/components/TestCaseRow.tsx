import { useEffect, useState } from 'react';
import { updateTestCase, deleteTestCase } from '../api/tasks';
import type { TestCase } from '../types/exam';

const fieldClass =
  'w-full rounded border border-mp-border bg-mp-bg px-2 py-1 font-mono text-sm text-mp-fg';

// judge/Judge.java clamps to these (falls back to the default when a value is
// <= 0, caps at the max) — kept in sync manually since the judge doesn't
// expose its limits over the API.
const TIME_LIMIT_MIN_MS = 100;
const TIME_LIMIT_MAX_MS = 15_000;
const MEMORY_LIMIT_MIN_MB = 16;
const MEMORY_LIMIT_MAX_MB = 512;

interface TestCaseRowProps {
  testCase: TestCase;
  onUpdated: (testCase: TestCase) => void;
  onDeleted: (id: string) => void;
  // Reports this row's own unsaved-changes state up to the parent, which
  // aggregates every independently-saved section (task form / each test case
  // row / solution editor) into one page-level "未保存の変更" summary — see
  // TaskEditorPage's dirtyTestCases.
  onDirtyChange?: (dirty: boolean) => void;
  // Only Java (exam flow) and C (regrade only) actually run through the
  // judge container and honour these two fields — show the inputs only when
  // the task's language is one of those, so JS/TS/Python/C's real (in-browser)
  // run — where these limits are silently ignored — doesn't show a control
  // that looks like it does something.
  showLimits: boolean;
}

export function TestCaseRow({
  testCase,
  onUpdated,
  onDeleted,
  onDirtyChange,
  showLimits,
}: TestCaseRowProps) {
  const [input, setInput] = useState(testCase.input);
  const [expectedOutput, setExpectedOutput] = useState(testCase.expectedOutput);
  const [isSample, setIsSample] = useState(testCase.isSample);
  const [timeLimitMs, setTimeLimitMs] = useState(testCase.timeLimitMs);
  const [memoryLimitMb, setMemoryLimitMb] = useState(testCase.memoryLimitMb);
  const [saving, setSaving] = useState(false);

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

  async function handleSave() {
    setSaving(true);
    try {
      const { testCase: updated } = await updateTestCase(testCase.id, {
        input,
        expectedOutput,
        isSample,
        timeLimitMs,
        memoryLimitMb,
      });
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('このテストケースを削除しますか？')) return;
    await deleteTestCase(testCase.id);
    onDeleted(testCase.id);
  }

  return (
    <div className="rounded-lg border border-mp-border bg-mp-surface p-3">
      <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-mp-muted">入力（stdin）</label>
          <textarea
            rows={3}
            className={fieldClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-mp-muted">期待される出力（stdout）</label>
          <textarea
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
            <label className="mb-1 block text-xs text-mp-muted">
              時間制限（ms、{TIME_LIMIT_MIN_MS}〜{TIME_LIMIT_MAX_MS}）
            </label>
            <input
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
            <label className="mb-1 block text-xs text-mp-muted">
              メモリ制限（MB、{MEMORY_LIMIT_MIN_MB}〜{MEMORY_LIMIT_MAX_MB}）
            </label>
            <input
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
          <p className="text-xs text-mp-muted">Java・C（再採点）にのみ適用されます。</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-mp-muted">
          <input
            type="checkbox"
            checked={isSample}
            onChange={(e) => setIsSample(e.target.checked)}
          />
          サンプルとして生徒に表示する
        </label>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs font-bold text-mp-orange">● 未保存</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded border border-mp-border bg-mp-surface-hover px-3 py-1 text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : 'このテストケースを保存'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded bg-mp-red px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
