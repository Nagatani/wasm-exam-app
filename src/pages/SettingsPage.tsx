import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BackHeader } from '../components/BackHeader';
import { ThemeToggle } from '../components/ThemeToggle';

// Lazy: these (and @mlc-ai/web-llm underneath them) are several MB of JS that
// must never land in the shared main bundle — only this page pulls them in,
// and only the one matching the viewer's role.
const AiAssistSettings = lazy(() => import('../components/AiAssistSettings'));
const AiHintSettings = lazy(() => import('../components/AiHintSettings'));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-4">
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Per-user / per-browser settings, reached from the hamburger drawer
 * (UserDrawer). Holds the settings too bulky for the drawer itself — the AI
 * model opt-in/download/delete panels — next to the theme and a link to the
 * password page.
 */
export function SettingsPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  const home = profile.role === 'TEACHER' ? '/teacher' : '/student';

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <div className="mx-auto max-w-2xl">
        <BackHeader to={home} label="ダッシュボードに戻る" />
        <h1 className="mb-4 text-xl font-bold text-mp-cyan">設定</h1>

        <Section title="表示">
          <div className="flex items-center justify-between">
            <span className="text-sm">表示テーマ</span>
            <ThemeToggle />
          </div>
        </Section>

        <Section title="AI機能（このブラウザのみ）">
          <p className="mb-3 text-xs text-mp-muted">
            AI機能はブラウザごとのオプトインです。有効にしたブラウザにだけAIモデルがダウンロードされ、他の端末やアカウントには引き継がれません。
          </p>
          <Suspense fallback={<p className="text-xs text-mp-muted">読み込み中...</p>}>
            {profile.role === 'TEACHER' ? <AiAssistSettings /> : <AiHintSettings />}
          </Suspense>
        </Section>

        <Section title="アカウント">
          <p className="mb-2 text-sm">
            {profile.displayName}（{profile.studentNumber}）
          </p>
          <Link
            to="/change-password"
            className="inline-block rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
          >
            パスワードを変更
          </Link>
        </Section>
      </div>
    </div>
  );
}
