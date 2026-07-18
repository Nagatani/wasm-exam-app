import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { downloadExamResultsCsv, getExamResults } from '../api/exams';
import { ApiError } from '../api/client';
import type { ExamResults, SubmissionOverallStatus } from '../types/exam';

const STATUS_COLOR: Record<SubmissionOverallStatus, string> = {
  AC: 'text-green-400',
  WA: 'text-red-400',
  CE: 'text-yellow-400',
  TLE: 'text-orange-400',
  MLE: 'text-orange-400',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP');
}

export function ExamResultsPage() {
  const { examId } = useParams<{ examId: string }>();
  const [results, setResults] = useState<ExamResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!examId) return;
    getExamResults(examId)
      .then(setResults)
      .catch((err) => setError(err instanceof ApiError ? err.message : '成績の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [examId]);

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

  if (loading) {
    return <div className="min-h-screen bg-gray-900 p-6 text-gray-400">読み込み中...</div>;
  }

  if (!results) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 text-red-400">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <Link
        to={`/teacher/exams/${examId}`}
        className="mb-4 inline-block text-sm text-teal-400 hover:underline"
      >
        ← 試験詳細に戻る
      </Link>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-teal-400">
          成績ダッシュボード: {results.exam.title}
        </h1>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
        >
          {downloading ? 'ダウンロード中...' : '📄 CSVダウンロード'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {results.students.length === 0 ? (
        <p className="text-gray-400">生徒が登録されていません。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-gray-800 text-gray-400">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 text-left">学籍番号</th>
                <th className="whitespace-nowrap px-3 py-2 text-left">氏名</th>
                {results.tasks.map((task) => (
                  <th key={task.id} className="whitespace-nowrap px-3 py-2 text-left">
                    {task.title}（{task.points}点）
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2 text-left">合計点</th>
                <th className="whitespace-nowrap px-3 py-2 text-left">最終提出日時</th>
              </tr>
            </thead>
            <tbody>
              {results.students.map((student) => (
                <tr key={student.id} className="border-t border-gray-700 even:bg-gray-800/50">
                  <td className="whitespace-nowrap px-3 py-2">{student.studentNumber}</td>
                  <td className="whitespace-nowrap px-3 py-2">{student.displayName}</td>
                  {student.results.map((cell) => (
                    <td key={cell.taskId} className="whitespace-nowrap px-3 py-2">
                      {cell.status ? (
                        <span className={`font-bold ${STATUS_COLOR[cell.status]}`}>
                          {cell.status}
                        </span>
                      ) : (
                        <span className="text-gray-500">未提出</span>
                      )}{' '}
                      <span className="text-gray-400">({cell.score})</span>
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 font-bold">{student.totalScore}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                    {formatDateTime(student.lastSubmittedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
