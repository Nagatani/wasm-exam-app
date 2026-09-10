import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  deleteStudentExamResults,
  downloadExamResultsCsv,
  getExamResults,
  getSubmissionDetail,
  setTimeExtension,
} from '../api/exams';
import { ApiError } from '../api/client';
import type {
  ExamResults,
  StudentResultRow,
  SubmissionDetail,
  SubmissionOverallStatus,
  TaskResultColumn,
} from '../types/exam';
import { BackHeader } from '../components/BackHeader';
import { PageSkeleton } from '../components/Skeleton';
import { statusGlyph } from '../lib/status';

const STATUS_COLOR: Record<SubmissionOverallStatus, string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  CE: 'text-mp-yellow',
  TLE: 'text-mp-orange',
  MLE: 'text-mp-orange',
};

// Per-test-case status includes RE (not a SubmissionStatus value).
function statusColor(status: string): string {
  return status === 'RE' ? 'text-mp-yellow' : (STATUS_COLOR as Record<string, string>)[status] ?? 'text-mp-red';
}

type SortKey = 'studentNumber' | 'displayName' | 'totalScore' | 'elapsedSeconds' | 'lastSubmittedAt';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };
type RowFilter = 'all' | 'submitted' | 'not-submitted';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP');
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

// Sort key -> comparable value. Numbers/strings sort naturally; null always
// sinks to the bottom regardless of direction (handled by the caller).
function sortValue(key: SortKey, r: StudentResultRow): string | number | null {
  switch (key) {
    case 'studentNumber':
      return r.studentNumber;
    case 'displayName':
      return r.displayName;
    case 'totalScore':
      return r.totalScore;
    case 'elapsedSeconds':
      return r.elapsedSeconds;
    case 'lastSubmittedAt':
      return r.lastSubmittedAt ? Date.parse(r.lastSubmittedAt) : null;
  }
}

// Score/time/date columns are most useful highest-first; name columns A→Z.
function defaultDir(key: SortKey): 'asc' | 'desc' {
  return key === 'studentNumber' || key === 'displayName' ? 'asc' : 'desc';
}

export function ExamResultsPage() {
  const { examId } = useParams<{ examId: string }>();
  const [results, setResults] = useState<ExamResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [sort, setSort] = useState<SortState | null>(null);
  // Only show the full-page loading state on the very first fetch — a
  // post-revert refresh should update the table in place, not blank it.
  const hasLoadedOnceRef = useRef(false);

  const loadResults = useCallback(() => {
    if (!examId) return;
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    getExamResults(examId)
      .then((data) => {
        setResults(data);
        hasLoadedOnceRef.current = true;
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '成績の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [examId]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const stats = useMemo(() => {
    if (!results) return null;
    const all = results.students;
    const submitters = all.filter((s) => s.lastSubmittedAt !== null);
    const totalPoints = results.tasks.reduce((sum, t) => sum + t.points, 0);
    const avg = (rows: StudentResultRow[]) =>
      rows.length ? rows.reduce((sum, r) => sum + r.totalScore, 0) / rows.length : 0;
    const perTask = results.tasks.map((task) => {
      const cells = all
        .map((s) => s.results.find((r) => r.taskId === task.id))
        .filter((c): c is NonNullable<typeof c> => c != null);
      const submittedCount = cells.filter((c) => c.status !== null).length;
      const acCount = cells.filter((c) => c.status === 'AC').length;
      return { task, submittedCount, acCount };
    });
    return {
      totalStudents: all.length,
      submitterCount: submitters.length,
      totalPoints,
      avgAll: avg(all),
      avgSubmitters: avg(submitters),
      maxScore: all.reduce((m, r) => Math.max(m, r.totalScore), 0),
      perTask,
    };
  }, [results]);

  const visibleStudents = useMemo(() => {
    if (!results) return [];
    let rows = results.students;
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (s) =>
          s.studentNumber.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q),
      );
    }
    if (rowFilter === 'submitted') {
      rows = rows.filter((s) => s.lastSubmittedAt !== null);
    } else if (rowFilter === 'not-submitted') {
      rows = rows.filter((s) => s.lastSubmittedAt === null);
    }
    if (sort) {
      const { key, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const av = sortValue(key, a);
        const bv = sortValue(key, b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp =
          typeof av === 'string'
            ? av.localeCompare(bv as string, 'ja')
            : (av as number) - (bv as number);
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [results, query, rowFilter, sort]);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDir(key) },
    );
  }

  async function handleDownload() {
    if (!examId) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadExamResultsCsv(examId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'CSVのダウンロードに失敗しました。');
    } finally {
      setDownloading(false);
    }
  }

  function toggleExpanded(studentId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  async function handleRevert(studentId: string, displayName: string, studentNumber: string) {
    if (!examId) return;
    if (
      !confirm(
        `${displayName}（${studentNumber}）のこの試験の受験結果をすべて削除し、受験をなかったことにします。この操作は取り消せません。よろしいですか？`,
      )
    ) {
      return;
    }
    setRevertingId(studentId);
    setError(null);
    try {
      await deleteStudentExamResults(examId, studentId);
      loadResults();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '差し戻しに失敗しました。');
    } finally {
      setRevertingId(null);
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  if (!results) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  const filterActive = query.trim() !== '' || rowFilter !== 'all';

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <BackHeader to={`/teacher/exams/${examId}`} label="試験詳細に戻る" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-mp-cyan">
          成績ダッシュボード: {results.exam.title}
        </h1>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 rounded bg-mp-cyan px-4 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
        >
          {downloading ? 'ダウンロード中...' : '📄 CSVダウンロード'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

      {results.students.length === 0 ? (
        <p className="text-mp-muted">生徒が登録されていません。</p>
      ) : (
        <>
          {stats && (
            <div className="mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label="提出人数"
                  value={`${stats.submitterCount} / ${stats.totalStudents}`}
                />
                <StatTile
                  label="平均点（全体）"
                  value={`${stats.avgAll.toFixed(1)} / ${stats.totalPoints}`}
                />
                <StatTile
                  label="平均点（提出者）"
                  value={`${stats.avgSubmitters.toFixed(1)} / ${stats.totalPoints}`}
                />
                <StatTile label="最高点" value={`${stats.maxScore} / ${stats.totalPoints}`} />
              </div>

              <div className="rounded-lg border border-mp-border bg-mp-surface p-3">
                <p className="mb-2 text-xs font-bold text-mp-muted">問題別 正答率（AC / 提出）</p>
                <div className="space-y-2">
                  {stats.perTask.map(({ task, submittedCount, acCount }) => {
                    const rate = submittedCount ? (acCount / submittedCount) * 100 : 0;
                    return (
                      <div key={task.id} className="flex items-center gap-3 text-xs">
                        <span className="w-40 shrink-0 truncate" title={task.title}>
                          {task.order + 1}. {task.title}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded bg-mp-bg">
                          <div className="h-full bg-mp-green" style={{ width: `${rate}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-mp-muted">
                          {acCount}/{submittedCount}（{Math.round(rate)}%）
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="学籍番号・氏名で検索"
              className="w-56 rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm text-mp-fg"
            />
            <div className="flex overflow-hidden rounded border border-mp-border text-sm">
              {(
                [
                  ['all', 'すべて'],
                  ['submitted', '提出済み'],
                  ['not-submitted', '未提出'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRowFilter(value)}
                  className={`px-3 py-1.5 font-bold ${
                    rowFilter === value
                      ? 'bg-mp-cyan text-mp-btn-fg'
                      : 'bg-mp-surface text-mp-muted hover:bg-mp-surface-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-mp-muted">
              表示 {visibleStudents.length} / {results.students.length} 人
            </span>
          </div>

          {visibleStudents.length === 0 ? (
            <p className="text-mp-muted">
              {filterActive ? '条件に一致する生徒がいません。' : '生徒が登録されていません。'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-mp-border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-mp-surface text-mp-muted">
                  <tr>
                    <th className="w-8 px-3 py-2"></th>
                    <SortHeader label="学籍番号" sortKey="studentNumber" sort={sort} onSort={handleSort} />
                    <SortHeader label="氏名" sortKey="displayName" sort={sort} onSort={handleSort} />
                    <SortHeader label="合計点" sortKey="totalScore" sort={sort} onSort={handleSort} />
                    <th className="whitespace-nowrap px-3 py-2 text-left font-bold">受験</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-bold" title="時間延長（分）">
                      延長
                    </th>
                    <SortHeader label="所要時間" sortKey="elapsedSeconds" sort={sort} onSort={handleSort} />
                    <SortHeader
                      label="最終提出日時"
                      sortKey="lastSubmittedAt"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <th className="whitespace-nowrap px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((student) => (
                    <StudentResultRowGroup
                      key={student.id}
                      examId={examId!}
                      student={student}
                      tasks={results.tasks}
                      expanded={expandedIds.has(student.id)}
                      onToggle={() => toggleExpanded(student.id)}
                      onRevert={() =>
                        handleRevert(student.id, student.displayName, student.studentNumber)
                      }
                      reverting={revertingId === student.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mp-border bg-mp-surface p-3">
      <p className="text-xs text-mp-muted">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left">
      <button
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 font-bold hover:text-mp-fg"
        aria-label={`${label}で並べ替え`}
      >
        {label}
        <span className="text-xs" aria-hidden="true">
          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function TimeExtensionCell({
  examId,
  studentId,
  value,
}: {
  examId: string;
  studentId: string;
  value: number;
}) {
  const [text, setText] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);

  async function commit() {
    const n = Math.max(0, Math.min(600, Math.floor(Number(text) || 0)));
    setText(String(n));
    if (n === value) return;
    setSaving(true);
    try {
      await setTimeExtension(examId, studentId, n);
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={600}
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-14 rounded border border-mp-border bg-mp-bg px-1 py-0.5 text-xs text-mp-fg"
        title="時間延長（分）— 0で解除"
      />
      <span className="text-xs text-mp-muted">分{flash ? ' ✓' : ''}</span>
    </span>
  );
}

interface StudentResultRowGroupProps {
  examId: string;
  student: StudentResultRow;
  tasks: TaskResultColumn[];
  expanded: boolean;
  onToggle: () => void;
  onRevert: () => void;
  reverting: boolean;
}

function StudentResultRowGroup({
  examId,
  student,
  tasks,
  expanded,
  onToggle,
  onRevert,
  reverting,
}: StudentResultRowGroupProps) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadDetail() {
    if (detail || loadingDetail) return;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      setDetail(await getSubmissionDetail(examId, student.id));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : '提出内容の取得に失敗しました。');
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-mp-border even:bg-mp-surface/50 hover:bg-mp-surface-hover"
      >
        <td className="px-1 py-2 text-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            aria-label={expanded ? '設問別の詳細を閉じる' : '設問別の詳細を開く'}
            className="px-2 text-mp-muted hover:text-mp-fg"
          >
            {expanded ? '▼' : '▶'}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{student.studentNumber}</td>
        <td className="whitespace-nowrap px-3 py-2">{student.displayName}</td>
        <td className="whitespace-nowrap px-3 py-2 font-bold">{student.totalScore}</td>
        <td className="whitespace-nowrap px-3 py-2 text-mp-muted">
          {student.attemptCount > 0 ? `${student.attemptCount}回` : '-'}
        </td>
        <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <TimeExtensionCell
            examId={examId}
            studentId={student.id}
            value={student.extraMinutes}
          />
        </td>
        <td
          className="whitespace-nowrap px-3 py-2 text-mp-muted"
          title={student.startedAt ? `開始: ${formatDateTime(student.startedAt)}` : undefined}
        >
          {formatDuration(student.elapsedSeconds)}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-mp-muted">
          {formatDateTime(student.lastSubmittedAt)}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRevert();
            }}
            disabled={!student.lastSubmittedAt || reverting}
            title="この生徒の受験結果をすべて削除し、受験をなかったことにします。"
            className="rounded bg-mp-red px-3 py-1 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {reverting ? '削除中...' : '差し戻し'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-mp-border bg-mp-bg">
          <td colSpan={9} className="px-3 py-3">
            <table className="w-full min-w-max text-xs">
              <thead className="text-mp-muted">
                <tr>
                  <th className="whitespace-nowrap px-2 py-1 text-left">設問</th>
                  <th className="whitespace-nowrap px-2 py-1 text-left">結果</th>
                  <th className="whitespace-nowrap px-2 py-1 text-left">打鍵数</th>
                  <th className="whitespace-nowrap px-2 py-1 text-left">解答時間</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const cell = student.results.find((r) => r.taskId === task.id);
                  return (
                    <tr key={task.id} className="border-t border-mp-border/50">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {task.title}（{task.points}点）
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {cell?.status ? (
                          <span className={`font-bold ${STATUS_COLOR[cell.status]}`}>
                            {statusGlyph(cell.status)} {cell.status}
                          </span>
                        ) : (
                          <span className="text-mp-muted">未提出</span>
                        )}{' '}
                        <span className="text-mp-muted">({cell?.score ?? 0})</span>
                        {cell?.pasteCount !== null && cell?.pasteCount !== undefined && cell.pasteCount > 0 && (
                          <span
                            title={`打鍵数: ${cell.keystrokeCount} / 貼り付け回数: ${cell.pasteCount} / 貼り付け文字数: ${cell.pastedCharCount}`}
                            className="ml-1 rounded bg-mp-orange/20 px-1 text-xs font-bold text-mp-orange"
                          >
                            📋{cell.pasteCount}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-mp-muted">
                        {cell?.keystrokeCount ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-mp-muted">
                        {formatDuration(cell?.timeSpentSeconds ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {student.lastSubmittedAt && (
              <div className="mt-3">
                {!detail && (
                  <button
                    onClick={loadDetail}
                    disabled={loadingDetail}
                    className="rounded border border-mp-border bg-mp-surface px-3 py-1 text-xs font-bold hover:bg-mp-surface-hover disabled:opacity-50"
                  >
                    {loadingDetail ? '読み込み中...' : '提出コードと結果を表示'}
                  </button>
                )}
                {detailError && <p className="mt-1 text-xs text-mp-red">{detailError}</p>}
                {detail && <SubmissionDetailView detail={detail} />}
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function SubmissionDetailView({ detail }: { detail: SubmissionDetail }) {
  return (
    <div className="mt-2 space-y-4">
      {detail.attemptNumber !== null && (
        <p className="text-xs text-mp-muted">{detail.attemptNumber} 回目の受験の提出</p>
      )}
      {detail.tasks.map((t) => (
        <div key={t.taskId} className="rounded-lg border border-mp-border bg-mp-surface p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold">
              {t.order + 1}. {t.title}
            </span>
            <span className="text-mp-muted">{t.language}</span>
            {t.submitted ? (
              <span className={`font-bold ${t.overallStatus ? STATUS_COLOR[t.overallStatus] : ''}`}>
                {t.overallStatus ? `${statusGlyph(t.overallStatus)} ${t.overallStatus}` : ''}
              </span>
            ) : (
              <span className="text-mp-muted">未提出</span>
            )}
            <span className="text-mp-muted">
              {t.score} / {t.points} 点
            </span>
          </div>

          {t.submitted && t.code !== null && (
            <pre className="mb-2 max-h-64 overflow-auto rounded bg-mp-bg p-2 text-xs">
              {t.code || '(空)'}
            </pre>
          )}

          {t.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-xs">
                <thead className="text-mp-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">#</th>
                    <th className="px-2 py-1 text-left">入力</th>
                    <th className="px-2 py-1 text-left">期待</th>
                    <th className="px-2 py-1 text-left">実際</th>
                    <th className="px-2 py-1 text-left">判定</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {t.testCases.map((tc, i) => {
                    const r = t.results.find((x) => x.testCaseId === tc.id);
                    return (
                      <tr key={tc.id} className="border-t border-mp-border/50 align-top">
                        <td className="px-2 py-1">
                          {i + 1}
                          {tc.isSample ? '' : '*'}
                        </td>
                        <td className="max-w-[12rem] px-2 py-1">
                          <pre className="whitespace-pre-wrap break-words">{tc.input || '(なし)'}</pre>
                        </td>
                        <td className="max-w-[12rem] px-2 py-1">
                          <pre className="whitespace-pre-wrap break-words">
                            {tc.expectedOutput || '(空)'}
                          </pre>
                        </td>
                        <td className="max-w-[12rem] px-2 py-1">
                          <pre className="whitespace-pre-wrap break-words">
                            {r ? r.actualOutput || '(空)' : '-'}
                          </pre>
                        </td>
                        <td className="px-2 py-1">
                          {r ? (
                            <span className={`font-bold ${statusColor(r.status)}`}>
                              {statusGlyph(r.status)} {r.status}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-mp-muted">* は非公開テストケース</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
