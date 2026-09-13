import { useEffect, useRef, useState, type FormEvent } from 'react';
import { searchTaskBank } from '../api/taskBank';
import { duplicateTask, importTasksIntoExam } from '../api/tasks';
import { ApiError } from '../api/client';
import { ALL_LANGUAGES, LANGUAGE_LABEL } from '../lib/language';
import type { Language, TaskBankEntry, TaskBankScope } from '../types/exam';

interface TaskBankPickerProps {
  examId: string;
  onClose: () => void;
  // Called after a task is added (duplicated) or a file imported, so the
  // parent can reload its own task list. Doesn't close the picker — a
  // teacher typically wants to add more than one task per visit.
  onAdded: () => void;
}

const SCOPE_LABEL: Record<TaskBankScope, string> = {
  all: 'すべて（自分＋公開）',
  mine: '自分の問題のみ',
  public: '公開されている問題のみ',
};

// Modal: search across every task the caller can discover (their own +
// anything another teacher marked public — see server/src/routes/taskBank.ts)
// and add one into `examId` via the existing duplicate-into-exam endpoint, or
// import a previously exported JSON file. No separate "bank" data model —
// every task ever authored is itself a bank entry.
export function TaskBankPicker({ examId, onClose, onAdded }: TaskBankPickerProps) {
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState<Language | ''>('');
  const [tagsText, setTagsText] = useState('');
  const [scope, setScope] = useState<TaskBankScope>('all');
  const [tasks, setTasks] = useState<TaskBankEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedFlash, setAddedFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const { tasks } = await searchTaskBank({
        q: q.trim() || undefined,
        language: language || undefined,
        tags,
        scope,
      });
      setTasks(tasks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '問題バンクの検索に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    search();
  }

  async function handleAdd(task: TaskBankEntry) {
    setAddingId(task.id);
    setError(null);
    setAddedFlash(null);
    try {
      await duplicateTask(task.id, examId);
      setAddedFlash(`「${task.title}」を追加しました。`);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '問題の追加に失敗しました。');
    } finally {
      setAddingId(null);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportMsg(null);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('JSONとして読み込めませんでした。エクスポートしたファイルを指定してください。');
      }
      const { tasks: imported } = await importTasksIntoExam(examId, payload);
      setImportMsg(`${imported.length}件の問題をインポートしました。`);
      onAdded();
    } catch (err) {
      setImportError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'インポートに失敗しました。',
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="問題バンクから追加"
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-mp-border bg-mp-surface p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">問題バンクから追加</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded px-2 py-1 text-mp-muted hover:bg-mp-surface-hover hover:text-mp-fg"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-mp-muted" htmlFor="bank-q">
              タイトル検索
            </label>
            <input
              id="bank-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="キーワード"
              className="w-full rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-mp-muted" htmlFor="bank-lang">
              言語
            </label>
            <select
              id="bank-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language | '')}
              className="rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            >
              <option value="">すべて</option>
              {ALL_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-32">
            <label className="mb-1 block text-xs text-mp-muted" htmlFor="bank-tags">
              タグ
            </label>
            <input
              id="bank-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="カンマ区切り"
              className="w-full rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-mp-muted" htmlFor="bank-scope">
              範囲
            </label>
            <select
              id="bank-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as TaskBankScope)}
              className="rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            >
              {(Object.keys(SCOPE_LABEL) as TaskBankScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '検索中...' : '検索'}
          </button>
        </form>

        {error && <p className="mb-2 text-sm text-mp-red">{error}</p>}
        {addedFlash && <p className="mb-2 text-sm font-bold text-mp-green">{addedFlash}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-mp-border">
          {loading ? (
            <p className="p-4 text-sm text-mp-muted">検索中...</p>
          ) : !tasks || tasks.length === 0 ? (
            <p className="p-4 text-sm text-mp-muted">条件に一致する問題がありません。</p>
          ) : (
            <ul className="divide-y divide-mp-border">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="font-bold">{t.title}</p>
                    <p className="text-xs text-mp-muted">
                      {LANGUAGE_LABEL[t.language]} ・ {t.points}点 ・ テスト{t.testCaseCount}件 ・{' '}
                      {t.mine ? '自分' : t.ownerName}（{t.examTitle}）
                      {t.isPublic && (
                        <span className="ml-1 rounded bg-mp-cyan/20 px-1 text-mp-cyan">公開</span>
                      )}
                    </p>
                    {t.tags.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-mp-border bg-mp-bg px-1.5 py-0.5 text-xs text-mp-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleAdd(t)}
                    disabled={addingId === t.id}
                    className="shrink-0 rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover disabled:opacity-50"
                  >
                    {addingId === t.id ? '追加中...' : 'この試験に追加'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 border-t border-mp-border pt-3">
          <label className="cursor-pointer text-sm font-bold text-mp-cyan hover:opacity-80">
            {importing ? 'インポート中...' : 'JSONファイルからインポート'}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportFile(file);
              }}
            />
          </label>
          <p className="text-xs text-mp-muted">
            問題編集画面の「エクスポート」で書き出したJSONファイルをこの試験に取り込みます。
          </p>
          {importMsg && <p className="mt-1 text-sm font-bold text-mp-green">{importMsg}</p>}
          {importError && <p className="mt-1 text-sm text-mp-red">{importError}</p>}
        </div>
      </div>
    </div>
  );
}
