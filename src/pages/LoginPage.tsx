import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logIn } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await logIn(studentId, password);
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ログインに失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-6"
      >
        <h1 className="mb-6 text-center text-xl font-bold text-teal-400">
          C言語 プログラミング演習システム
        </h1>

        <label className="mb-1 block text-sm text-gray-400" htmlFor="studentId">
          学籍番号
        </label>
        <input
          id="studentId"
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="mb-1 block text-sm text-gray-400" htmlFor="password">
          パスワード
        </label>
        <input
          id="password"
          type="password"
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-teal-500 py-2 font-bold text-gray-900 transition hover:bg-teal-600 disabled:opacity-50"
        >
          {submitting ? 'ログイン中...' : 'ログイン'}
        </button>

        <p className="mt-4 text-center text-sm text-gray-400">
          アカウントをお持ちでない方は{' '}
          <Link to="/signup" className="text-teal-400 hover:underline">
            新規登録
          </Link>
        </p>
      </form>
    </div>
  );
}
