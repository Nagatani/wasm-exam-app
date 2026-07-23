import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getExamSubmissions, getStudentExam } from '../api/student';
import { ApiError } from '../api/client';
import type { StudentExamDetail, SubmissionSummary } from '../types/student';
import { ThemeToggle } from '../components/ThemeToggle';

const STATUS_LABEL: Record<SubmissionSummary['overallStatus'], string> = {
  AC: 'AC',
  WA: 'WA',
  CE: 'CE',
};

const STATUS_COLOR: Record<SubmissionSummary['overallStatus'], string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  CE: 'text-mp-yellow',
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
    return <div className="min-h-screen bg-mp-bg p-6 text-mp-muted">読み込み中...</div>;
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '試験が見つかりません。'}
      </div>
    );
  }

  const totalScore = submissions.reduce((sum, s) => sum + s.score, 0);
  const totalPoints = exam.tasks.reduce((sum, t) => sum + t.points, 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-mp-bg p-6 text-mp-fg">
      <div className="w-full max-w-lg rounded-lg border border-mp-border bg-mp-surface p-6">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-xl font-bold text-mp-cyan">🎉 試験終了</h1>
          <ThemeToggle />
        </div>
        <p className="mb-6 text-center text-mp-muted">{exam.title}</p>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-mp-border text-left text-mp-muted">
              <th className="py-2">問題</th>
              <th className="py-2">結果</th>
              <th className="py-2 text-right">得点</th>
            </tr>
          </thead>
          <tbody>
            {exam.tasks.map((task) => {
              const submission = submissions.find((s) => s.taskId === task.id);
              return (
                <tr key={task.id} className="border-b border-mp-border/50">
                  <td className="py-2">
                    {task.order + 1}. {task.title}
                  </td>
                  <td className={`py-2 font-bold ${submission ? STATUS_COLOR[submission.overallStatus] : 'text-mp-muted'}`}>
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
          className="block rounded bg-mp-cyan px-4 py-2 text-center font-bold text-mp-ink hover:opacity-90"
        >
          試験一覧に戻る
        </Link>
      </div>
    </div>
  );
}
