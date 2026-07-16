import { useState } from 'react';
import { updateTestCase, deleteTestCase } from '../api/tasks';
import type { TestCase } from '../types/exam';

const fieldClass =
  'w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 font-mono text-sm text-white';

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
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
      <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-gray-400">入力（stdin）</label>
          <textarea
            rows={3}
            className={fieldClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">期待される出力（stdout）</label>
          <textarea
            rows={3}
            className={fieldClass}
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-400">
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
            className="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded bg-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-800"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
