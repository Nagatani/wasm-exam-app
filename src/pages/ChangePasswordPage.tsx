import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PasswordField } from '../components/PasswordField';
import { ThemeToggle } from '../components/ThemeToggle';

export function ChangePasswordPage() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const forced = profile?.mustChangePassword ?? false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('新しいパスワードが一致しません。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changePassword(current, next);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'パスワードの変更に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mp-bg p-6 text-mp-fg">
      <div className="w-full max-w-sm rounded-lg border border-mp-border bg-mp-surface p-6">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-mp-cyan">パスワードの変更</h1>
          <ThemeToggle />
        </div>
        {forced && (
          <p className="mb-4 rounded bg-mp-yellow/20 p-2 text-sm text-mp-yellow">
            初回ログインです。配布された初期パスワードを、自分だけが知るパスワードに変更してください。
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <PasswordField
            id="cur"
            label={forced ? '初期パスワード' : '現在のパスワード'}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            required
          />
          <PasswordField
            id="new"
            label="新しいパスワード（8文字以上）"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <PasswordField
            id="cfm"
            label="新しいパスワード（確認）"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={8}
            required
          />

          {error && <p className="mb-3 text-sm text-mp-red">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-mp-cyan px-4 py-2 font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '変更中...' : 'パスワードを変更'}
          </button>
        </form>
      </div>
    </div>
  );
}
