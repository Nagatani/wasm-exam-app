import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSignupStatus, logIn } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PasswordField } from '../components/PasswordField';

export function LoginPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  // Hide the signup link when the server has closed self-signup. Assume open
  // until told otherwise, so an unreachable server doesn't hide it.
  const [signupOpen, setSignupOpen] = useState(true);

  useEffect(() => {
    getSignupStatus()
      .then(({ signupOpen }) => setSignupOpen(signupOpen))
      .catch(() => {});
  }, []);

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
    <div className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-mp-border/60 bg-mp-surface/85 p-8 shadow-2xl backdrop-blur-sm"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-mp-cyan/15 text-xl font-bold text-mp-cyan">
            {'</>'}
          </div>
          <h1 className="text-xl font-bold text-mp-cyan">プログラミング演習システム</h1>
        </div>

        <label className="mb-1 block text-sm text-mp-muted" htmlFor="studentId">
          学籍番号
        </label>
        <input
          id="studentId"
          className="mb-4 w-full rounded-lg border border-mp-border bg-mp-bg px-3 py-2 text-mp-fg transition focus:border-mp-cyan focus:outline-none"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          autoComplete="username"
          required
        />

        <PasswordField
          id="password"
          label="パスワード"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-mp-cyan py-2.5 font-bold text-mp-btn-fg transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
        >
          {submitting ? 'ログイン中...' : 'ログイン'}
        </button>

        {signupOpen ? (
          <p className="mt-4 text-center text-sm text-mp-muted">
            アカウントをお持ちでない方は{' '}
            <Link to="/signup" className="font-semibold text-mp-cyan hover:underline">
              新規登録
            </Link>
          </p>
        ) : (
          <p className="mt-4 text-center text-xs text-mp-muted">
            アカウントやパスワードが分からない場合は、担当の教員に問い合わせてください。
          </p>
        )}
      </form>
    </div>
  );
}
