import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getExamSubmissions, getStudentExam } from '../api/student';
import { ApiError } from '../api/client';
import type { StudentExamDetail, SubmissionSummary } from '../types/student';

const STATUS_LABEL: Record<SubmissionSummary['overallStatus'], string> = {
  AC: 'AC',
  WA: 'WA',
  CE: 'CE',
};

const STATUS_COLOR: Record<SubmissionSummary['overallStatus'], string> = {
  AC: 'text-green-400',
  WA: 'text-red-400',
  CE: 'text-yellow-400',
};

export function StudentExamFinishedPage() {
  const { examId } = useParams<{ examId: string }>();
  const [exam, setExam] = useState<StudentExamDetail | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId) return;
    Promise.all([getStudentExam(examId), getExamSubmissions(examId)])
      .then(([{ exam }, { submissions }]) => {
        setExam(exam);
        setSubmissions(submissions);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '結果の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, [examId]);

  if (loading) {
    return <div className="min-h-screen bg-gray-900 p-6 text-gray-400">読み込み中...</div>;
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 text-red-400">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  const totalScore = submissions.reduce((sum, s) => sum + s.score, 0);
  const totalPoints = exam.tasks.reduce((sum, t) => sum + t.points, 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 p-6 text-white">
      <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h1 className="mb-1 text-center text-xl font-bold text-teal-400">🎉 試験終了</h1>
        <p className="mb-6 text-center text-gray-400">{exam.title}</p>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2">問題</th>
              <th className="py-2">結果</th>
              <th className="py-2 text-right">得点</th>
            </tr>
          </thead>
          <tbody>
            {exam.tasks.map((task) => {
              const submission = submissions.find((s) => s.taskId === task.id);
              return (
                <tr key={task.id} className="border-b border-gray-700/50">
                  <td className="py-2">
                    {task.order + 1}. {task.title}
                  </td>
                  <td className={`py-2 font-bold ${submission ? STATUS_COLOR[submission.overallStatus] : 'text-gray-500'}`}>
                    {submission ? STATUS_LABEL[submission.overallStatus] : '未提出'}
                  </td>
                  <td className="py-2 text-right">
                    {submission ? submission.score : 0} / {task.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mb-6 text-right text-lg font-bold">
          合計: {totalScore} / {totalPoints} 点
        </p>

        <Link
          to="/student"
          className="block rounded bg-teal-500 px-4 py-2 text-center font-bold text-gray-900 hover:bg-teal-600"
        >
          試験一覧に戻る
        </Link>
      </div>
    </div>
  );
}
