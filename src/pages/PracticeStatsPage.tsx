import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPracticeHistory, getPracticeStats } from '../api/exams';
import { ApiError } from '../api/client';
import type {
  PracticeHistory,
  PracticeStats,
  PracticeStudentRow,
  PracticeStudentTaskCell,
  SubmissionOverallStatus,
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

type RowFilter = 'all' | 'active' | 'inactive';

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ja-JP') : '-';
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mp-border bg-mp-surface p-3">
      <p className="text-xs text-mp-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

// One student × task cell: solved ✓ / tried-but-not-solved ✗ (with count) / untouched.
function CellButton({
  cell,
  selected,
  onClick,
}: {
  cell: PracticeStudentTaskCell;
  selected: boolean;
  onClick: () => void;
}) {
  if (cell.submissionCount === 0) {
    return <span className="text-mp-muted">-</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`提出 ${cell.submissionCount} 回 ・ 最高 ${cell.bestScore ?? 0} 点 ・ 最終 ${formatDateTime(cell.lastSubmittedAt)}`}
      className={`rounded px-1.5 py-0.5 text-xs font-bold ${
        cell.solved ? 'text-mp-green' : 'text-mp-red'
      } ${selected ? 'bg-mp-cyan/20 ring-1 ring-mp-cyan' : 'hover:bg-mp-surface-hover'}`}
    >
      {cell.solved ? '✓' : '✗'} {cell.submissionCount}回
    </button>
  );
}

function HistoryPanel({
  examId,
  student,
  taskId,
  onClose,
}: {
  examId: string;
  student: PracticeStudentRow;
  taskId: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<PracticeHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setHistory(null);
    setError(null);
    getPracticeHistory(examId, student.id, taskId)
      .then((h) => {
        setHistory(h);
        setOpenId(h.submissions[0]?.id ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '提出履歴の取得に失敗しました。'));
  }, [examId, student.id, taskId]);

  return (
    <section className="mt-4 rounded-lg border border-mp-cyan/60 bg-mp-surface p-4" aria-label="提出履歴">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">
          {student.studentNumber} {student.displayName} の提出履歴
          {history && `：${history.task.title}`}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="提出履歴を閉じる"
          className="rounded px-2 py-1 text-mp-muted hover:bg-mp-surface-hover hover:text-mp-fg"
        >
          ✕
        </button>
      </div>
      {error && <p className="text-sm text-mp-red">{error}</p>}
      {!history && !error && <p className="text-sm text-mp-muted">読み込み中...</p>}
      {history && (
        <ol className="space-y-2">
          {history.submissions.map((s, i) => (
            <li key={s.id} className="rounded border border-mp-border bg-mp-bg">
              <button
                type="button"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                aria-expanded={openId === s.id}
                className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-xs hover:bg-mp-surface-hover"
              >
                <span className="text-mp-muted">#{history.submissions.length - i}</span>
                <span className={`font-bold ${STATUS_COLOR[s.overallStatus]}`}>
                  {statusGlyph(s.overallStatus)} {s.overallStatus}
                </span>
                <span className="text-mp-muted">
                  {s.score} / {history.task.points} 点
                </span>
                <span className="text-mp-muted">{formatDateTime(s.submittedAt)}</span>
                <span className="ml-auto text-mp-muted">{openId === s.id ? '▼' : '▶'} コード</span>
              </button>
              {openId === s.id && (
                <pre className="max-h-72 overflow-auto border-t border-mp-border p-2 text-xs">
                  {s.code || '(空)'}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * 演習の状況 (/teacher/exams/:examId/practice-stats): the PRACTICE-mode
 * counterpart of ExamResultsPage. Practice has no grade (unlimited
 * resubmission), so this shows activity instead — per task how many students
 * tried / solved it, per student which tasks they solved and how many tries
 * it took, and each student's full submission history on click.
 */
export function PracticeStatsPage() {
  const { examId } = useParams<{ examId: string }>();
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [selected, setSelected] = useState<{ studentId: string; taskId: string } | null>(null);

  useEffect(() => {
    if (!examId) return;
    getPracticeStats(examId)
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : '演習の状況の取得に失敗しました。'));
  }, [examId]);

  const rows = useMemo(() => {
    if (!stats) return [];
    const q = query.trim().toLowerCase();
    return stats.students.filter((s) => {
      if (filter === 'active' && s.submissionCount === 0) return false;
      if (filter === 'inactive' && s.submissionCount > 0) return false;
      return !q || s.studentNumber.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q);
    });
  }, [stats, query, filter]);

  if (error) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
        <BackHeader to={`/teacher/exams/${examId}`} label="試験詳細に戻る" />
        <p className="text-mp-red">{error}</p>
      </div>
    );
  }
  if (!stats || !examId) return <PageSkeleton />;

  const activeCount = stats.students.filter((s) => s.submissionCount > 0).length;
  const totalSubmissions = stats.students.reduce((n, s) => n + s.submissionCount, 0);
  const selectedStudent = selected ? stats.students.find((s) => s.id === selected.studentId) : undefined;

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <BackHeader to={`/teacher/exams/${examId}`} label="試験詳細に戻る" />
      <h1 className="mb-4 text-xl font-bold text-mp-cyan">演習の状況: {stats.exam.title}</h1>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="取り組んだ生徒" value={`${activeCount} / ${stats.students.length}`} />
        <StatTile label="提出の総数" value={String(totalSubmissions)} />
        <StatTile label="問題数" value={String(stats.tasks.length)} />
        <StatTile
          label="全問正解した生徒"
          value={String(
            stats.tasks.length === 0 ? 0 : stats.students.filter((s) => s.solvedCount === stats.tasks.length).length,
          )}
        />
      </div>

      <section className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-3" aria-label="問題別の状況">
        <p className="mb-2 text-xs font-bold text-mp-muted">問題別（正解した生徒 / 取り組んだ生徒）</p>
        <ul className="space-y-1.5">
          {stats.tasks.map((t) => {
            const rate = t.submitterCount === 0 ? 0 : t.solvedCount / t.submitterCount;
            return (
              <li key={t.id} className="flex items-center gap-3 text-xs">
                <span className="w-48 shrink-0 truncate font-bold" title={t.title}>
                  {t.order + 1}. {t.title}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded bg-mp-bg">
                  <span className="block h-full bg-mp-green" style={{ width: `${Math.round(rate * 100)}%` }} />
                </span>
                <span className="w-44 shrink-0 text-right text-mp-muted">
                  {t.solvedCount} / {t.submitterCount} 人（提出 {t.submissionCount} 回）
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="学籍番号・氏名で検索"
          aria-label="学籍番号・氏名で検索"
          className="rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm"
        />
        <div className="flex overflow-hidden rounded border border-mp-border text-xs" role="group" aria-label="絞り込み">
          {(
            [
              ['all', 'すべて'],
              ['active', '取り組んだ'],
              ['inactive', '未着手'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 ${filter === key ? 'bg-mp-cyan font-bold text-mp-btn-fg' : 'bg-mp-surface hover:bg-mp-surface-hover'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-mp-muted">
          表示 {rows.length} / {stats.students.length} 人 ・ セルを押すと提出履歴（コード）を表示
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-mp-border">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-mp-surface text-mp-muted">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left">学籍番号</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">氏名</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">正解</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">提出</th>
              {stats.tasks.map((t) => (
                <th key={t.id} className="whitespace-nowrap px-3 py-2 text-left" title={t.title}>
                  {t.order + 1}. {t.title.length > 10 ? `${t.title.slice(0, 10)}…` : t.title}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-left">最終提出</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-mp-border even:bg-mp-surface/50">
                <td className="whitespace-nowrap px-3 py-2">{s.studentNumber}</td>
                <td className="whitespace-nowrap px-3 py-2">{s.displayName}</td>
                <td className="whitespace-nowrap px-3 py-2 font-bold">
                  {s.solvedCount} / {stats.tasks.length}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-mp-muted">{s.submissionCount}</td>
                {s.tasks.map((cell) => (
                  <td key={cell.taskId} className="whitespace-nowrap px-3 py-2">
                    <CellButton
                      cell={cell}
                      selected={selected?.studentId === s.id && selected.taskId === cell.taskId}
                      onClick={() => setSelected({ studentId: s.id, taskId: cell.taskId })}
                    />
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-mp-muted">{formatDateTime(s.lastSubmittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && selectedStudent && (
        <HistoryPanel
          examId={examId}
          student={selectedStudent}
          taskId={selected.taskId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
