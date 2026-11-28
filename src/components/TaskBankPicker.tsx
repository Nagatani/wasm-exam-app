import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getTaskBankTags, searchTaskBank } from '../api/taskBank';
import { duplicateTask, getTask, importTasksIntoExam } from '../api/tasks';
import { ApiError } from '../api/client';
import { ALL_LANGUAGES, LANGUAGE_LABEL } from '../lib/language';
import type {
  Language,
  TaskBankEntry,
  TaskBankScope,
  TaskBankSort,
  TaskDetail,
} from '../types/exam';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { MarkdownBody } from './MarkdownBody';

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

const SORT_LABEL: Record<TaskBankSort, string> = {
  newest: '新着順',
  title: 'タイトル順',
  points: '配点順',
};

// Modal: search across every task the caller can discover (their own +
// anything another teacher marked public — see server/src/routes/taskBank.ts)
// and add one or more into `examId` via the existing duplicate-into-exam
// endpoint, or import a previously exported JSON file. No separate "bank" data
// model — every task ever authored is itself a bank entry.
export function TaskBankPicker({ examId, onClose, onAdded }: TaskBankPickerProps) {
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState<Language | ''>('');
  const [tagsText, setTagsText] = useState('');
  const [scope, setScope] = useState<TaskBankScope>('all');
  const [sort, setSort] = useState<TaskBankSort>('newest');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskBankEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [previewCache, setPreviewCache] = useState<Record<string, TaskDetail>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = useState<Record<string, string>>({});
  const [addedFlash, setAddedFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function search(overrideSort?: TaskBankSort) {
    setLoading(true);
    setError(null);
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const { tasks: found } = await searchTaskBank({
        q: q.trim() || undefined,
        language: language || undefined,
        tags,
        scope,
        sort: overrideSort ?? sort,
      });
      setTasks(found);
      const foundIds = new Set(found.map((t) => t.id));
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (foundIds.has(id)) next.add(id);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '問題バンクの検索に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search();
    getTaskBankTags()
      .then(({ tags }) => setAvailableTags(tags))
      .catch(() => setAvailableTags([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDialogFocus(true, dialogRef, onClose, closeButtonRef);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    void search();
  }

  function toggleSelect(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!tasks || tasks.length === 0) return;
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  }

  async function togglePreview(taskId: string) {
    const willExpand = !expandedIds.has(taskId);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(taskId);
      else next.delete(taskId);
      return next;
    });

    if (!willExpand || previewCache[taskId] || previewLoading[taskId]) return;

    setPreviewLoading((prev) => ({ ...prev, [taskId]: true }));
    setPreviewError((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    try {
      const { task } = await getTask(taskId);
      setPreviewCache((prev) => ({ ...prev, [taskId]: task }));
    } catch (err) {
      setPreviewError((prev) => ({
        ...prev,
        [taskId]: err instanceof ApiError ? err.message : 'プレビューの取得に失敗しました。',
      }));
    } finally {
      setPreviewLoading((prev) => ({ ...prev, [taskId]: false }));
    }
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

  async function handleBulkAdd() {
    if (!tasks || selectedIds.size === 0 || bulkAdding) return;
    const targets = tasks.filter((t) => selectedIds.has(t.id));
    if (targets.length === 0) return;

    setBulkAdding(true);
    setError(null);
    setAddedFlash(null);
    let addedCount = 0;
    const failedTitles: string[] = [];
    const remainingSelected = new Set(selectedIds);

    for (const task of targets) {
      try {
        await duplicateTask(task.id, examId);
        addedCount += 1;
        remainingSelected.delete(task.id);
      } catch {
        failedTitles.push(task.title);
      }
    }

    setSelectedIds(remainingSelected);
    if (addedCount > 0) {
      setAddedFlash(`${addedCount}件の問題をまとめて追加しました。`);
      onAdded();
    }
    if (failedTitles.length > 0) {
      setError(`一部の問題の追加に失敗しました: ${failedTitles.join('、')}`);
    }
    setBulkAdding(false);
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
        tabIndex={-1}
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="問題バンクから追加"
        className="relative flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-mp-border bg-mp-surface p-4 shadow-xl"
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
              キーワード検索
            </label>
            <input
              id="bank-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="タイトル・問題文"
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
              list="bank-tags-datalist"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="カンマ区切り"
              className="w-full rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            />
            <datalist id="bank-tags-datalist">
              {availableTags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
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
          <div>
            <label className="mb-1 block text-xs text-mp-muted" htmlFor="bank-sort">
              並び替え
            </label>
            <select
              id="bank-sort"
              value={sort}
              onChange={(e) => {
                const next = e.target.value as TaskBankSort;
                setSort(next);
                void search(next);
              }}
              className="rounded border border-mp-border bg-mp-bg px-2 py-1.5 text-sm text-mp-fg"
            >
              {(Object.keys(SORT_LABEL) as TaskBankSort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
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

        {tasks && tasks.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5 text-mp-muted">
              <input
                type="checkbox"
                checked={selectedIds.size === tasks.length}
                onChange={toggleSelectAll}
              />
              すべて選択（{selectedIds.size} / {tasks.length} 件）
            </label>
            <button
              type="button"
              onClick={() => void handleBulkAdd()}
              disabled={selectedIds.size === 0 || bulkAdding || addingId !== null}
              className="rounded bg-mp-cyan px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {bulkAdding
                ? '追加中...'
                : `選択した ${selectedIds.size} 件をまとめて追加`}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-mp-border">
          {loading ? (
            <p className="p-4 text-sm text-mp-muted">検索中...</p>
          ) : !tasks || tasks.length === 0 ? (
            <p className="p-4 text-sm text-mp-muted">条件に一致する問題がありません。</p>
          ) : (
            <ul className="divide-y divide-mp-border">
              {tasks.map((t) => {
                const isExpanded = expandedIds.has(t.id);
                const detail = previewCache[t.id];
                const isPreviewLoading = previewLoading[t.id] ?? false;
                const rowPreviewError = previewError[t.id];
                const sampleCases = detail?.testCases.filter((tc) => tc.isSample) ?? [];
                return (
                  <li key={t.id} className="p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          aria-label={`${t.title}を選択`}
                          className="mt-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">{t.title}</p>
                          <p className="text-xs text-mp-muted">
                            {LANGUAGE_LABEL[t.language]} ・ {t.points}点 ・ テスト{t.testCaseCount}件 ・{' '}
                            {t.mine ? '自分' : t.ownerName}（{t.examTitle}）
                            {t.isPublic && (
                              <span className="ml-1 rounded bg-mp-cyan/10 px-1 text-mp-cyan">公開</span>
                            )}
                          </p>
                          {!isExpanded && t.statementPreview && (
                            <p className="mt-1 truncate text-xs text-mp-muted">
                              {t.statementPreview}
                            </p>
                          )}
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
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void togglePreview(t.id)}
                          aria-expanded={isExpanded}
                          className="rounded border border-mp-border bg-mp-bg px-2.5 py-1.5 text-xs font-bold hover:bg-mp-surface-hover"
                        >
                          {isExpanded ? 'プレビューを閉じる' : 'プレビュー'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAdd(t)}
                          disabled={addingId === t.id || bulkAdding}
                          className="rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover disabled:opacity-50"
                        >
                          {addingId === t.id ? '追加中...' : 'この試験に追加'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded border border-mp-border bg-mp-bg p-3 text-xs">
                        {isPreviewLoading ? (
                          <p className="text-mp-muted">プレビューを読み込み中...</p>
                        ) : rowPreviewError ? (
                          <p className="text-mp-red">{rowPreviewError}</p>
                        ) : detail ? (
                          <div className="space-y-3">
                            <div>
                              <p className="mb-1 font-bold text-mp-muted">問題文</p>
                              {detail.statementMarkdown.trim() ? (
                                <div className="markdown-body text-sm">
                                  <MarkdownBody>{detail.statementMarkdown}</MarkdownBody>
                                </div>
                              ) : (
                                <p className="text-mp-muted">（問題文は未入力です）</p>
                              )}
                            </div>

                            {sampleCases.length > 0 && (
                              <div>
                                <p className="mb-1 font-bold text-mp-muted">
                                  サンプルテストケース（{sampleCases.length}件）
                                </p>
                                <div className="space-y-2">
                                  {sampleCases.map((tc, idx) => (
                                    <div
                                      key={tc.id}
                                      className="grid gap-2 rounded border border-mp-border bg-mp-surface p-2 sm:grid-cols-2"
                                    >
                                      <div>
                                        <p className="mb-0.5 text-[11px] text-mp-muted">
                                          入力 {idx + 1}
                                        </p>
                                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs">
                                          {tc.input || '（空）'}
                                        </pre>
                                      </div>
                                      <div>
                                        <p className="mb-0.5 text-[11px] text-mp-muted">
                                          期待出力 {idx + 1}
                                        </p>
                                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs">
                                          {tc.expectedOutput || '（空）'}
                                        </pre>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {detail.starterCode && detail.starterCode.trim() !== '' && (
                              <div>
                                <p className="mb-1 font-bold text-mp-muted">初期テンプレート</p>
                                <pre className="max-h-36 overflow-auto whitespace-pre rounded border border-mp-border bg-mp-surface p-2 font-mono text-xs">
                                  {detail.starterCode}
                                </pre>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 border-t border-mp-border pt-3">
          <label className="inline-block cursor-pointer rounded text-sm font-bold text-mp-cyan hover:opacity-80 focus-within:outline-2 focus-within:outline-mp-cyan focus-within:outline-offset-2">
            {importing ? 'インポート中...' : 'JSONファイルからインポート'}
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImportFile(file);
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
