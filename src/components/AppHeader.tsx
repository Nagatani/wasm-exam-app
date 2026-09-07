import type { ReactNode } from 'react';
import { logOut } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

/**
 * Shared top bar for the full-width dashboard pages (student / teacher): page
 * title on the left, then any page-specific `actions`, the theme toggle, and a
 * logout button. Extracted so the toggle + logout cluster isn't hand-copied
 * (and drifting) across every dashboard.
 */
export function AppHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const { refresh } = useAuth();

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-mp-cyan">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <ThemeToggle />
        <button
          onClick={() => logOut().then(refresh)}
          className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
