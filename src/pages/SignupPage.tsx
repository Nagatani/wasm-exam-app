import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUp } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export function SignupPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError('パスワードが一致しません。');
      return;
    }

    setSubmitting(true);
    try {
      await signUp(studentId, password);
      // role は常にサーバー側で "STUDENT" 固定として作成される。
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登録に失敗しました。');
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
          新規登録
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
          autoComplete="new-password"
          minLength={8}
          required
        />

        <label
          className="mb-1 block text-sm text-gray-400"
          htmlFor="passwordConfirm"
        >
          パスワード（確認）
        </label>
        <input
          id="passwordConfirm"
          type="password"
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-teal-500 py-2 font-bold text-gray-900 transition hover:bg-teal-600 disabled:opacity-50"
        >
          {submitting ? '登録中...' : '登録する'}
        </button>

        <p className="mt-4 text-center text-sm text-gray-400">
          既にアカウントをお持ちの方は{' '}
          <Link to="/login" className="text-teal-400 hover:underline">
            ログイン
          </Link>
        </p>
      </form>
    </div>
  );
}
