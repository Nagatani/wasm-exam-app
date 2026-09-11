import { useEffect, useState } from 'react';
import { updateTestCase, deleteTestCase } from '../api/tasks';
import type { TestCase } from '../types/exam';

const fieldClass =
  'w-full rounded border border-mp-border bg-mp-bg px-2 py-1 font-mono text-sm text-mp-fg';

interface TestCaseRowProps {
  testCase: TestCase;
  onUpdated: (testCase: TestCase) => void;
  onDeleted: (id: string) => void;
  // Reports this row's own unsaved-changes state up to the parent, which
  // aggregates every independently-saved section (task form / each test case
  // row / solution editor) into one page-level "未保存の変更" summary — see
  // TaskEditorPage's dirtyTestCases.
  onDirtyChange?: (dirty: boolean) => void;
}

export function TestCaseRow({ testCase, onUpdated, onDeleted, onDirtyChange }: TestCaseRowProps) {
  const [input, setInput] = useState(testCase.input);
  const [expectedOutput, setExpectedOutput] = useState(testCase.expectedOutput);
  const [isSample, setIsSample] = useState(testCase.isSample);
  const [saving, setSaving] = useState(false);

  const dirty =
    input !== testCase.input ||
    expectedOutput !== testCase.expectedOutput ||
    isSample !== testCase.isSample;

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
