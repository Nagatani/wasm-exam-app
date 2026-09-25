import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSignupStatus, signUp } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/useAuth';
import { PasswordField } from '../components/PasswordField';

export function SignupPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [signupOpen, setSignupOpen] = useState(true);

  useEffect(() => {
    getSignupStatus()
      .then(({ signupOpen }) => setSignupOpen(signupOpen))
      .catch(() => {});
  }, []);

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
    <div className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-mp-border/60 bg-mp-surface/85 p-8 shadow-2xl backdrop-blur-sm"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-mp-cyan/15 text-xl font-bold text-mp-cyan">
            {'</>'}
          </div>
          <h1 className="text-xl font-bold text-mp-cyan">新規登録</h1>
        </div>

        {!signupOpen && (
          <p className="mb-4 rounded-lg border border-mp-yellow/50 bg-mp-yellow/10 p-3 text-sm text-mp-fg">
            新規登録は現在受け付けていません。アカウントの発行は担当の教員に依頼してください。
          </p>
        )}

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
          autoComplete="new-password"
          minLength={8}
          required
        />

        <PasswordField
          id="passwordConfirm"
          label="パスワード（確認）"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error && <p className="mb-4 text-sm text-mp-red">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !signupOpen}
          className="w-full rounded-lg bg-mp-cyan py-2.5 font-bold text-mp-btn-fg transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
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
