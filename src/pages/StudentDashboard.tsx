import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logOut } from '../api/auth';
import { getStudentExam, listStudentExams } from '../api/student';
import { ApiError } from '../api/client';
import type { StudentExamSummary } from '../types/student';

export function StudentDashboard() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    listStudentExams()
      .then(({ exams }) => setExams(exams))
      .catch((err) => setError(err instanceof ApiError ? err.message : '試験一覧の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, []);

  async function handleStart(examId: string) {
    setStarting(examId);
    setError(null);
    try {
      const { exam, submittedTaskIds } = await getStudentExam(examId);

      if (exam.tasks.length === 0) {
        setError('この試験にはまだ問題が登録されていません。');
        return;
      }

      const allSubmitted = exam.tasks.every((t) => submittedTaskIds.includes(t.id));
      if (allSubmitted) {
        navigate(`/student/exams/${examId}/finished`);
        return;
      }

      const nextTask =
        exam.tasks.find((t) => !submittedTaskIds.includes(t.id)) ?? exam.tasks[0];
      navigate(`/student/exams/${examId}/tasks/${nextTask.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '試験の開始に失敗しました。');
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-teal-400">生徒ダッシュボード</h1>
        <button
          onClick={() => logOut().then(refresh)}
          className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
        >
          ログアウト
        </button>
      </header>

      <p className="mb-4 text-gray-400">ようこそ、{profile?.studentNumber} さん。</p>

      <h2 className="mb-2 text-lg font-bold">受験可能な試験</h2>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-400">読み込み中...</p>
      ) : exams.length === 0 ? (
        <p className="text-gray-400">現在受験できる試験はありません。</p>
      ) : (
        <ul className="divide-y divide-gray-700 rounded-lg border border-gray-700 bg-gray-800">
          {exams.map((exam) => (
            <li key={exam.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-bold">{exam.title}</p>
                {exam.description && (
                  <p className="text-sm text-gray-400">{exam.description}</p>
                )}
                <p className="text-sm text-gray-400">
                  問題数: {exam.taskCount} ・ 制限時間: {exam.timeLimitMinutes}分
                </p>
              </div>
              <button
                onClick={() => handleStart(exam.id)}
                disabled={starting === exam.id}
                className="rounded bg-teal-500 px-4 py-2 font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
              >
                {starting === exam.id ? '読み込み中...' : '受験する'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
