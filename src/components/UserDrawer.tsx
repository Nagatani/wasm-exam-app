import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logOut } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

const ROLE_LABEL: Record<'STUDENT' | 'TEACHER', string> = {
  STUDENT: '学生',
  TEACHER: '教師',
};

interface NavItem {
  to: string;
  label: string;
  // Exact match only — otherwise "/teacher" would highlight on every
  // /teacher/... page too.
  end?: boolean;
}

const NAV_ITEMS: Record<'STUDENT' | 'TEACHER', NavItem[]> = {
  TEACHER: [
    { to: '/teacher', label: 'ダッシュボード', end: true },
    { to: '/teacher/courses', label: 'クラス管理' },
    { to: '/teacher/admin', label: '管理者メニュー' },
  ],
  STUDENT: [{ to: '/student', label: 'ダッシュボード', end: true }],
};

const SETTINGS_ITEMS: NavItem[] = [
  { to: '/settings', label: '設定（AI機能など）' },
  { to: '/change-password', label: 'パスワードを変更' },
];

/**
 * App-wide hamburger menu: normally closed, a single ☰ button opens a
 * right-side drawer holding everything that isn't the current page's own
 * work — the signed-in user's info, role-based navigation (dashboard, クラス
 * 管理, 管理者メニュー), the quick theme toggle, links to the settings /
 * password pages, and logout. Pages render only this in their header instead
 * of their own nav/settings buttons (see AppHeader / BackHeader).
 *
 * Heavier settings (AI model opt-in/download/delete) live on SettingsPage,
 * not inline here, so the drawer stays a short navigation list.
 *
 * `beforeNavigate` lets a page with unsaved server-side state (the exam's
 * StudentTaskPage draft) persist it before any drawer navigation or logout;
 * returning false cancels the navigation.
 *
 * Renders nothing if there's no signed-in user (e.g. LoginPage/SignupPage,
 * which keep their own standalone `<ThemeToggle />`).
 */
export function UserDrawer({
  beforeNavigate,
}: {
  beforeNavigate?: () => Promise<boolean>;
} = {}) {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
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

  async function go(to: string) {
    setOpen(false);
    if (beforeNavigate && !(await beforeNavigate())) return;
    navigate(to);
  }

  async function handleLogout() {
    setOpen(false);
    if (beforeNavigate && !(await beforeNavigate())) return;
    await logOut();
    await refresh();
  }

  const tab = open ? 0 : -1;
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded px-3 py-2 text-sm ${
      isActive
        ? 'bg-mp-cyan/15 font-bold text-mp-cyan'
        : 'text-mp-fg hover:bg-mp-surface-hover'
    }`;

  function renderLinks(items: NavItem[]) {
    return (
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              tabIndex={tab}
              onClick={(e) => {
                e.preventDefault();
                void go(item.to);
              }}
              className={linkClass}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="メニュー"
        aria-label="メニューを開く"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-8 w-9 flex-col items-center justify-center gap-1 rounded border border-mp-border bg-mp-surface hover:bg-mp-surface-hover"
      >
        <span className="block h-0.5 w-4 rounded bg-mp-fg" />
        <span className="block h-0.5 w-4 rounded bg-mp-fg" />
        <span className="block h-0.5 w-4 rounded bg-mp-fg" />
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
          tabIndex={tab}
          onClick={() => setOpen(false)}
          className="absolute inset-0 bg-black/40"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="メニュー"
          className={`absolute top-0 right-0 flex h-full w-80 max-w-[85vw] flex-col overflow-y-auto border-l border-mp-border bg-mp-surface p-4 text-mp-fg shadow-xl transition-transform duration-200 ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-mp-muted">メニュー</h2>
            <button
              ref={closeButtonRef}
              type="button"
              tabIndex={tab}
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

          <nav aria-label="メインメニュー" className="mb-4">
            <p className="mb-1 px-1 text-xs font-bold text-mp-muted">ページ</p>
            {renderLinks(NAV_ITEMS[profile.role])}
          </nav>

          <div className="mb-4 border-t border-mp-border pt-4">
            <p className="mb-1 px-1 text-xs font-bold text-mp-muted">設定</p>
            <div className="mb-2 flex items-center justify-between px-3 py-1">
              <span className="text-sm">表示テーマ</span>
              <ThemeToggle />
            </div>
            {renderLinks(SETTINGS_ITEMS)}
          </div>

          <div className="mt-auto pt-4">
            <button
              type="button"
              tabIndex={tab}
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
