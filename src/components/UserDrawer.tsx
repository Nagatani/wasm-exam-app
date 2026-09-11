import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { logOut } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

const ROLE_LABEL: Record<'STUDENT' | 'TEACHER', string> = {
  STUDENT: '学生',
  TEACHER: '教師',
};

/**
 * Consolidated user menu: normally closed, a single icon button opens a
 * right-side drawer with the signed-in user's info, the theme toggle
 * (relocated here from being a standalone button in every header), a link to
 * change password, and logout. Replaces the theme-toggle + logout button
 * cluster that used to be hand-copied across every page (see AppHeader /
 * BackHeader — this is what they render now instead of that pair).
 *
 * Renders nothing if there's no signed-in user (e.g. LoginPage/SignupPage,
 * which keep their own standalone `<ThemeToggle />` since there's no user
 * menu to show yet).
 */
export function UserDrawer() {
  const { profile, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    // Stop the page behind the drawer from scrolling while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!profile) return null;

  async function handleLogout() {
    setOpen(false);
    await logOut();
    await refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={profile.displayName}
        aria-label="ユーザーメニューを開く"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
      >
        ⚙️
      </button>

      {/* Always mounted (not conditionally rendered) so the open/close
          transition can actually animate instead of popping in and out. */}
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-50 transition-opacity duration-200 ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          type="button"
          aria-label="メニューを閉じる"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className="absolute inset-0 bg-black/40"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ユーザーメニュー"
          className={`absolute top-0 right-0 flex h-full w-80 max-w-[85vw] flex-col border-l border-mp-border bg-mp-surface p-4 shadow-xl transition-transform duration-200 ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-mp-muted">メニュー</h2>
            <button
              ref={closeButtonRef}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              aria-label="閉じる"
              className="rounded px-2 py-1 text-mp-muted hover:bg-mp-surface-hover hover:text-mp-fg"
            >
              ✕
            </button>
          </div>

          <div className="mb-4 flex items-center gap-3 rounded-lg border border-mp-border bg-mp-bg p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mp-cyan text-lg font-bold text-mp-btn-fg">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold text-mp-fg">{profile.displayName}</p>
              <p className="truncate text-xs text-mp-muted">
                {profile.studentNumber} ・ {ROLE_LABEL[profile.role]}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <p className="mb-1 text-xs font-bold text-mp-muted">表示テーマ</p>
            <ThemeToggle />
          </div>

          <Link
            to="/change-password"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="mb-2 rounded border border-mp-border bg-mp-bg px-3 py-2 text-sm hover:bg-mp-surface-hover"
          >
            パスワードを変更
          </Link>

          <div className="mt-auto pt-4">
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={handleLogout}
              className="w-full rounded border border-mp-border bg-mp-bg px-3 py-2 text-sm font-bold hover:bg-mp-surface-hover"
            >
              ログアウト
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
