import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUp } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

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
    <div className="flex min-h-screen items-center justify-center bg-mp-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-mp-border bg-mp-surface p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-mp-cyan">新規登録</h1>
          <ThemeToggle />
        </div>

        <label className="mb-1 block text-sm text-mp-muted" htmlFor="studentId">
          学籍番号
        </label>
        <input
          id="studentId"
          className="mb-4 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="mb-1 block text-sm text-mp-muted" htmlFor="password">
          パスワード
        </label>
        <input
          id="password"
          type="password"
          className="mb-4 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />

        <label
          className="mb-1 block text-sm text-mp-muted"
          htmlFor="passwordConfirm"
        >
          パスワード（確認）
        </label>
        <input
          id="passwordConfirm"
          type="password"
          className="mb-4 w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-mp-cyan py-2 font-bold text-mp-ink transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? '登録中...' : '登録する'}
        </button>

        <p className="mt-4 text-center text-sm text-mp-muted">
          既にアカウントをお持ちの方は{' '}
          <Link to="/login" className="font-semibold text-mp-cyan hover:underline">
            ログイン
          </Link>
        </p>
      </form>
    </div>
  );
}
