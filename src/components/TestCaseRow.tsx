import { useState } from 'react';
import { updateTestCase, deleteTestCase } from '../api/tasks';
import type { TestCase } from '../types/exam';

const fieldClass =
  'w-full rounded border border-mp-border bg-mp-bg px-2 py-1 font-mono text-sm text-mp-fg';

interface TestCaseRowProps {
  testCase: TestCase;
  onUpdated: (testCase: TestCase) => void;
  onDeleted: (id: string) => void;
}

export function TestCaseRow({ testCase, onUpdated, onDeleted }: TestCaseRowProps) {
  const [input, setInput] = useState(testCase.input);
  const [expectedOutput, setExpectedOutput] = useState(testCase.expectedOutput);
  const [isSample, setIsSample] = useState(testCase.isSample);
  const [saving, setSaving] = useState(false);

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
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded border border-mp-border bg-mp-surface-hover px-3 py-1 text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded bg-mp-red px-3 py-1 text-sm font-bold text-mp-ink hover:opacity-90"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
